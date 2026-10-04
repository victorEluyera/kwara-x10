import crypto from 'node:crypto';
import {parseCsv} from './xlsx-read.js';
import {memberScope} from './scope.js';
import {aggregateCache} from './aggregate-cache.js';
const privateIndex=aggregateCache();
export const clearPdpContactIndex=()=>privateIndex.clear();
const phone=value=>{
  let digits=String(value??'').replace(/\D/g,'');
  if(/^234\d{10}$/.test(digits))digits='0'+digits.slice(3);
  if(/^\d{10}$/.test(digits))digits='0'+digits;
  return /^0\d{10}$/.test(digits)?digits:null;
};
const name=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  .replace(/[^a-z\s]/g,' ').split(/\s+/).filter(Boolean).sort().join(' ');
export function pdpIdentity(nameValue,phoneValue,secret){
  const canonicalPhone=phone(phoneValue),canonicalName=name(nameValue);
  return canonicalPhone&&canonicalName?crypto.createHmac('sha256',secret).update(JSON.stringify([canonicalName,canonicalPhone])).digest('hex'):null;
}
export function readPdpContacts(buffer){
  const rows=parseCsv(buffer.toString('utf8'));
  const key=value=>String(value||'').toLowerCase().replace(/[^a-z]/g,'');
  const header=rows[0]?.map(key)||[];
  const phoneColumn=header.findIndex(value=>['phone','phonenumber','phoneno','mobile'].includes(value));
  const nameColumn=header.findIndex(value=>['name','fullname'].includes(value));
  const firstColumn=header.indexOf('firstname'),lastColumn=header.findIndex(value=>['lastname','surname'].includes(value));
  const hasHeader=phoneColumn>=0;
  if(hasHeader&&nameColumn<0&&(firstColumn<0||lastColumn<0))throw new Error('The PDP list needs name and phone columns.');
  const data=(hasHeader?rows.slice(1):rows).filter(row=>row.some(value=>String(value||'').trim()));
  if(!data.length||data.length>300000)throw new Error('Choose an PDP CSV containing 1 to 300,000 records.');
  if(!hasHeader&&data.some(row=>row.length!==9))throw new Error('For a different PDP file format, add name and phone headers.');
  return data.map(row=>({name:hasHeader?(nameColumn>=0?row[nameColumn]:row[firstColumn]+' '+row[lastColumn]):row[0],phone:row[hasHeader?phoneColumn:3]}));
}
export function countPdpPromoters(members,index){
  const matches=new Set();let matchedRecords=0,eligibleRecords=0;
  for(const member of members){
    const identity=pdpIdentity([member.first_name,member.last_name].filter(Boolean).join(' '),member.phone,index.secret);
    if(identity)eligibleRecords++;
    if(identity&&index.identities.has(identity)){matches.add(identity);matchedRecords++;}
  }
  return {loaded:true,matched_promoters:matches.size,matched_promoter_records:matchedRecords,
    promoter_records:members.length,matchable_promoter_records:eligibleRecords,
    method:'Exact normalised name and phone against the supplied PDP contact list; duplicate identities count once.',
    source_records:index.source_records,source_identities:index.identities.size,source_loaded_at:index.loaded_at,
    membership_basis:'Match to the supplied PDP list; not an independent party-membership verification.'};
}
export async function importPdpContacts(database,rows,userId){
  const result=await database.transaction(async tx=>{
    await tx.prepare('SELECT pg_advisory_xact_lock(107010) AS locked').get();
    const previous=await tx.prepare("SELECT secret FROM pdp_contact_match_metadata WHERE id=1 FOR UPDATE").get();
    const secret=previous?.secret||crypto.randomBytes(32).toString('base64url');
    const identities=[...new Set(rows.map(row=>pdpIdentity(row.name,row.phone,secret)).filter(Boolean))];
    if(!identities.length)throw new Error('No complete names and phone numbers were found in that PDP file.');
    await tx.prepare('DELETE FROM pdp_contact_match_index').run();
    for(let offset=0;offset<identities.length;offset+=5000){
      await tx.prepare('INSERT INTO pdp_contact_match_index(identity) SELECT value FROM jsonb_array_elements_text(?::jsonb) ON CONFLICT DO NOTHING')
        .run(JSON.stringify(identities.slice(offset,offset+5000)));
    }
    const loadedAt=new Date().toISOString();
    await tx.prepare(`INSERT INTO pdp_contact_match_metadata(id,secret,source_records,source_identities,loaded_at,loaded_by)
      VALUES(1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET secret=EXCLUDED.secret,source_records=EXCLUDED.source_records,
      source_identities=EXCLUDED.source_identities,loaded_at=EXCLUDED.loaded_at,loaded_by=EXCLUDED.loaded_by`)
      .run(secret,rows.length,identities.length,loadedAt,userId);
    return {source_records:rows.length,source_identities:identities.length,loaded_at:loadedAt};
  });
  clearPdpContactIndex();return result;
}
export async function pdpPromoterOverlap(database,user={role:'admin'},{excludeTest=false}={}){
  const index=await privateIndex.get(async()=>{
    const metadata=await database.prepare('SELECT secret,source_records,loaded_at FROM pdp_contact_match_metadata WHERE id=1').get();
    if(!metadata?.secret)return null;
    const rows=await database.prepare('SELECT identity FROM pdp_contact_match_index').all();
    return {...metadata,identities:new Set(rows.map(row=>row.identity))};
  });
  if(!index)return {loaded:false,matched_promoters:null,matched_promoter_records:null,method:'Load the PDP contact list to match names and phones.'};
  const scope=memberScope(user,{alias:'m'});
  const testFilter=excludeTest?` AND COALESCE(m.is_test,0)=0 AND COALESCE(u.is_test,0)=0
    AND (m.first_name||' '||m.last_name) !~* '(^[[:space:]]*test([[:space:]]|$)|\\(delete me\\))'
    AND COALESCE(u.full_name,'') !~* '(^[[:space:]]*test([[:space:]]|$)|\\(delete me\\))'`:'';
  const members=await database.prepare("SELECT m.first_name,m.last_name,m.phone FROM members m LEFT JOIN users u ON u.id=m.upline_user_id WHERE m.level IN ('mobiliser','unit_promoter') AND ("+scope.sql+')'+testFilter).all(...scope.params);
  return countPdpPromoters(members,index);
}
