import { parseCsv, readWorkbook } from './xlsx-read.js';
import { memberScope } from './scope.js';
import { canonicalLocation } from './data/geo.js';
import { validateLocationEdit } from './member-location-edit.js';

export const CONTACT_STATUSES = ['verified', 'unreachable', 'incorrect_details', 'declined', 'pending'];
const clean = value => String(value ?? '').trim();
const key = value => clean(value).toLowerCase().replace(/[^a-z0-9]/g, '');
export const CORRECTION_FIELDS = ['first_name','last_name','phone','title','designation','pvc_no','nin',
  'bank_name','account_name','account_number','lga','ward','polling_unit'];
export function readContactVerification(buffer, filename) {
  const table = /\.csv$/i.test(filename) ? parseCsv(buffer.toString('utf8'))
    : /\.xlsx$/i.test(filename) ? readWorkbook(buffer).rows() : null;
  if (!table?.length) throw new Error('Upload a CSV or XLSX with a header row.');
  const headers = table[0].map(key);
  const find = (...names) => headers.findIndex(header => names.includes(header));
  const columns = {id:find('id','memberid'),code:find('code','membercode'),
    status:find('contactverificationstatus','callstatus','contactstatus','verificationresult'),
    notes:find('contactverificationnotes','callnotes','notes'),caller:find('contactverifiedby','caller','agent'),
    date:find('contactverifiedat','calledat','calldatetime')};
  if (columns.id < 0 && columns.code < 0) throw new Error('Keep the member id or code column from the exported file.');
  if (columns.status < 0) throw new Error('Add a contact_verification_status column with the call result.');
  const correctionColumns=Object.fromEntries(CORRECTION_FIELDS.map(field=>{
    const aliases=field==='pvc_no'?['vin','pvcno']:field==='polling_unit'?['pollingunit','pu']: [key(field)];
    return [field,{corrected:find(...aliases.map(alias=>'corrected'+alias)),original:find(...aliases)}];
  }));
  const rows = table.slice(1).map((cells,index) => ({row:index+2,id:clean(cells[columns.id]),code:clean(cells[columns.code]),
    status:clean(cells[columns.status]).toLowerCase().replace(/[ -]+/g,'_'),notes:clean(cells[columns.notes]),
    caller:clean(cells[columns.caller]),called_at:clean(cells[columns.date]),
    corrections:Object.fromEntries(Object.entries(correctionColumns).map(([field,index])=>[field,
      clean(cells[index.corrected]) || clean(cells[index.original])]).filter(([,value])=>value && !['--','not recorded','not specified'].includes(value.toLowerCase())))})).filter(row => row.id || row.code || row.status);
  if (!rows.length || rows.length > 20000) throw new Error('Upload between 1 and 20,000 member results per file.');
  return rows;
}
export function matchContactRows(rows, members, user = {role:'admin'}) {
  const byId = new Map(members.map(member => [String(member.id),member]));
  const byCode = new Map(members.map(member => [member.code,member]));
  const seen = new Set();
  return rows.map(row => {
    const member = row.id ? byId.get(row.id) : byCode.get(row.code);
    let error = '';
    if (row.id && !/^[1-9]\d*$/.test(row.id)) error = 'Invalid member ID.';
    else if (!member) error = 'Member not found or outside your permitted records.';
    else if (row.code && row.code !== member.code) error = 'Member ID and code do not match.';
    else if (seen.has(member.id)) error = 'Member appears more than once in this file.';
    else if (!CONTACT_STATUSES.includes(row.status)) error = 'Use verified, unreachable, incorrect_details, declined or pending.';
    else if (row.notes.length > 2000 || row.caller.length > 200) error = 'Notes or caller name is too long.';
    else if (row.called_at && (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(row.called_at) || !Number.isFinite(Date.parse(row.called_at)))) error = 'Use an ISO call timestamp with timezone, for example 2026-10-03T10:30:00+01:00.';
    const corrections={},changes=[];
    let location_changed=false,vin_changed=false;
    if(!error)try{
      for(const field of CORRECTION_FIELDS){
        const value=clean(row.corrections?.[field]);
        if(value && value!==clean(member[field]))corrections[field]=value;
      }
      if(corrections.account_number && !/^\d{10}$/.test(corrections.account_number))throw new Error('Account number must be 10 digits. Format the spreadsheet cell as Text to retain a leading zero.');
      if(corrections.phone){
        const digits=corrections.phone.replace(/\D/g,'');
        if(!/^(0\d{10}|234\d{10})$/.test(digits))throw new Error('Enter a complete phone number starting with 0 or 234.');
        corrections.phone=digits.startsWith('234')?'0'+digits.slice(3):digits;
        if(corrections.phone===member.phone)delete corrections.phone;
      }
      if(Object.values(corrections).some(value=>value.length>500))throw new Error('A corrected member field is too long.');
      if(['lga','ward','polling_unit'].some(field=>corrections[field])){
        const target=validateLocationEdit(user,canonicalLocation({...member,...corrections}));
        for(const field of ['lga','ward','polling_unit']){
          if(target[field]!==member[field])corrections[field]=target[field];else delete corrections[field];
        }
        location_changed=['lga','ward','polling_unit'].some(field=>corrections[field]);
      }
      vin_changed=Boolean(corrections.pvc_no);
      for(const [field,value] of Object.entries(corrections))changes.push({field,before:member[field]??'',after:value});
    }catch(problem){error=problem.message;}
    if (member) seen.add(member.id);
    return {...row,corrections,changes,location_changed,vin_changed, member_id:member?.id, name:member ? member.first_name + ' ' + member.last_name : '', error};
  });
}
export async function contactVerificationImport(database, user, rows, commit = false) {
  return database.transaction(async tx => {
    const scope = memberScope(user,{alias:'m'});
    const members = [];
    for (let offset=0;offset<rows.length;offset+=500) {
      const batch=rows.slice(offset,offset+500);
      const ids=batch.map(row=>row.id).filter(id=>/^[1-9]\d*$/.test(id) && Number(id)<=2147483647);
      const codes=batch.map(row=>row.code).filter(Boolean);
      const matches=[];const params=[...scope.params];
      if(ids.length){matches.push('m.id IN ('+ids.map(()=>'?').join(',')+')');params.push(...ids);}
      if(codes.length){matches.push('m.code IN ('+codes.map(()=>'?').join(',')+')');params.push(...codes);}
      if(!matches.length)continue;
      members.push(...await tx.prepare('SELECT m.* FROM members m WHERE ('+scope.sql+') AND ('+matches.join(' OR ')+')'+(commit?' FOR UPDATE OF m':'')).all(...params));
    }
    const matched=matchContactRows(rows,members,user);
    const correctedPhones=matched.filter(row=>!row.error && row.corrections.phone);
    if(correctedPhones.length){
      const seenPhones=new Set();
      for(let offset=0;offset<correctedPhones.length;offset+=500){
        const batch=correctedPhones.slice(offset,offset+500);
        const existing=await tx.prepare('SELECT id,phone FROM members WHERE phone IN ('+batch.map(()=>'?').join(',')+')').all(...batch.map(row=>row.corrections.phone));
        for(const row of batch){
          if(seenPhones.has(row.corrections.phone)||existing.some(member=>member.phone===row.corrections.phone&&member.id!==row.member_id))row.error='Corrected phone number is already used by another member.';
          seenPhones.add(row.corrections.phone);
        }
      }
    }
    const errors=matched.filter(row=>row.error);
    if(commit && errors.length){
      const error=new Error('Fix the reported rows before saving. No members were updated.');
      error.contactImportError=true;throw error;
    }
    const importedAt=new Date().toISOString();
    if(commit)for(let offset=0;offset<matched.length;offset+=500){
      const batch=matched.slice(offset,offset+500).map(row=>({id:row.member_id,status:row.status,notes:row.notes,caller:row.caller,
        called_at:row.called_at ? new Date(row.called_at).toISOString() : null,
        corrections:row.corrections,location_changed:row.location_changed,vin_changed:row.vin_changed}));
      const personalUpdates=CORRECTION_FIELDS.map(field=>`${field}=COALESCE(r.corrections->>'${field}',m.${field})`).join(',');
      await tx.prepare(`UPDATE members m SET contact_verification_status=r.status, contact_verification_notes=r.notes,
        contact_verified_by=r.caller, contact_verified_at=r.called_at, contact_verification_uploaded_at=?, contact_verification_uploaded_by=?,
        ${personalUpdates},polling_unit_resolved=CASE WHEN r.location_changed THEN 1 ELSE m.polling_unit_resolved END,
        vin_verification_status=CASE WHEN r.location_changed OR r.vin_changed THEN 'not_checked' ELSE m.vin_verification_status END,
        vin_verification_json=CASE WHEN r.location_changed OR r.vin_changed THEN NULL ELSE m.vin_verification_json END
        FROM jsonb_to_recordset(?::jsonb) AS r(id integer,status text,notes text,caller text,called_at text,corrections jsonb,location_changed boolean,vin_changed boolean) WHERE m.id=r.id`)
        .run(importedAt,user.id,JSON.stringify(batch));
      if(batch.some(row=>row.location_changed))await tx.prepare(`UPDATE users u SET scope_value=m.lga||'|'||m.ward||'|'||m.polling_unit
        FROM members m WHERE u.member_id=m.id AND u.scope_type='polling_unit' AND m.id IN (`
        +batch.filter(row=>row.location_changed).map(()=>'?').join(',')+')').run(...batch.filter(row=>row.location_changed).map(row=>row.id));
    }
    return {total:rows.length,ready:matched.length-errors.length,errors,preview:matched.slice(0,100),updated:commit?matched.length:0,
      corrected:matched.filter(row=>!row.error&&row.changes.length).length};
  });
}
