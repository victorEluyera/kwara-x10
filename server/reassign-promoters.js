import {isCandidateRole,isUnitPromoterRole,ADMIN_ROLES,normaliseRole} from './auth.js';
import {nominationQuota,unitKey} from './nominations.js';
import {canonicalLocation} from './data/geo.js';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
function groupFor(account) {
  if(isCandidateRole(account.role))return {sql:"level = 'mobiliser' AND upline_user_id = ?",params:[account.id]};
  if(isUnitPromoterRole(account.role)&&account.member_id)return {sql:"level = 'mobiliser' AND id = ?",params:[account.member_id]};
  fail('Choose a candidate, stakeholder or linked promoter account');
}
export async function promoterReassignmentPreview(db,accountId) {
  const account=await db.prepare('SELECT id,role,full_name,member_id FROM users WHERE id = ?').get(accountId);
  if(!account)fail('Account not found',404);
  const group=groupFor(account);
  const rows=await db.prepare('SELECT id,code,first_name,last_name,phone,lga,ward,polling_unit,upline_user_id FROM members WHERE '+group.sql+' ORDER BY first_name,last_name,id').all(...group.params);
  return {account,rows};
}
export async function reassignPromoters(db,admin,accountId,body) {
  if(!ADMIN_ROLES.has(normaliseRole(admin.role)))fail('Administrator access required',403);
  const ids=body.member_ids,targetId=body.target_id;
  if(!Array.isArray(ids)||!ids.length||ids.length>20000||ids.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(ids).size!==ids.length)fail('Select between 1 and 20,000 distinct promoters');
  if(!Number.isSafeInteger(targetId)||targetId<1)fail('Choose the rightful candidate or stakeholder');
  return db.transaction(async tx=>{
    // Lock account IDs in a stable order, including opposite-direction transfers.
    const accounts=await tx.prepare('SELECT id,role,office,status,full_name,member_id FROM users WHERE id IN (?,?) ORDER BY id FOR UPDATE').all(accountId,targetId);
    const source=accounts.find(a=>Number(a.id)===Number(accountId)),target=accounts.find(a=>Number(a.id)===targetId);
    if(!source)fail('Source account no longer exists',404);
    if(!target||!isCandidateRole(target.role)||target.status!=='active')fail('Choose an active candidate or stakeholder account');
    const group=groupFor(source),marks=ids.map(()=>'?').join(',');
    const rows=await tx.prepare('SELECT id,lga,ward,polling_unit,upline_user_id FROM members WHERE ('+group.sql+') AND id IN ('+marks+') ORDER BY id FOR UPDATE').all(...group.params,...ids);
    if(rows.length!==ids.length)fail('Some promoters no longer belong to this account. Reopen the list and review them',409);
    if(!body.owners||rows.some(r=>String(r.upline_user_id??'')!==String(body.owners[r.id]??'')))fail('A selected promoter has changed owner. Reopen the list and review it',409);
    if(rows.some(r=>Number(r.upline_user_id)===targetId))fail('Some selected promoters already belong to this candidate');
    if(target.member_id&&ids.includes(Number(target.member_id)))fail('The destination account is linked to a selected promoter. Correct that account link first',409);
    const quota=nominationQuota(target.office),counts=new Map();
    if(quota!=null){
      const existing=await tx.prepare("SELECT lga,ward,polling_unit,COUNT(*) n FROM members WHERE level='mobiliser' AND upline_user_id = ? GROUP BY lga,ward,polling_unit").all(targetId);
      for(const row of existing){const key=unitKey(canonicalLocation(row));counts.set(key,(counts.get(key)||0)+Number(row.n));}
    }
    const buckets=[[],[]];
    for(const row of rows){const key=unitKey(canonicalLocation(row)),count=counts.get(key)||0;const over=quota!=null&&count>=quota?1:0;buckets[over].push(row.id);counts.set(key,count+1);}
    for(let over=0;over<2;over++)for(let at=0;at<buckets[over].length;at+=500){
      const batch=buckets[over].slice(at,at+500),placeholders=batch.map(()=>'?').join(',');
      await tx.prepare('UPDATE members SET upline_user_id = ?, upline_member_id = ?, over_quota = ? WHERE id IN ('+placeholders+')').run(targetId,target.member_id||null,over,...batch);
      await tx.prepare("UPDATE users SET upline_id = ? WHERE member_id IN ("+placeholders+") AND role IN ('mobiliser','unit_promoter','unit promoter')").run(targetId,...batch);
    }
    return {updated:rows.length,source_account_id:accountId,target_id:targetId,target_name:target.full_name,member_ids:ids};
  });
}
