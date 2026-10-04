import {memberScope,scopedLgas,scopedWards} from './scope.js';
import {POLLING_UNITS} from './data/geo.js';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
export const locationFields=['lga','ward','polling_unit'];
export function matchingLocationClause(source) {
  return {sql:locationFields.map(k=>"LOWER(TRIM(COALESCE("+k+",''))) = LOWER(TRIM(?))").join(' AND '),params:locationFields.map(k=>String(source[k]??''))};
}
export function validateLocationEdit(user,target) {
  const result=Object.fromEntries(locationFields.map(k=>[k,String(target?.[k]||'').trim()]));
  if(!scopedLgas(user).includes(result.lga))fail('Choose an LGA in your area');
  if(!scopedWards(user,result.lga).includes(result.ward))fail('Choose a ward under the selected LGA');
  if(!(POLLING_UNITS[result.lga]?.[result.ward]||[]).includes(result.polling_unit))fail('Choose a polling unit under the selected ward');
  return result;
}
export async function locationEditPreview(db,user,id) {
  const scope=memberScope(user);
  const member=await db.prepare('SELECT id,code,first_name,last_name,lga,ward,polling_unit FROM members WHERE id = ? AND ('+scope.sql+')').get(id,...scope.params);
  if(!member)fail('Member not found in your area',404);
  const match=matchingLocationClause(member),where='('+scope.sql+') AND ('+match.sql+')',params=[...scope.params,...match.params];
  const total=await db.prepare('SELECT COUNT(*) total FROM members WHERE '+where).get(...params);
  const sample=await db.prepare('SELECT id,code,first_name,last_name,phone,lga,ward,polling_unit,upline_user_id,(SELECT full_name FROM users WHERE users.id = members.upline_user_id) candidate_name FROM members WHERE '+where+' ORDER BY id').all(...params);
  return {source:Object.fromEntries(locationFields.map(k=>[k,member[k]??''])),total:Number(total.total),sample};
}
export async function saveMemberLocation(db,user,id,body) {
  if(!['single','matching','selected'].includes(body.mode))fail('Choose one member or matching records');
  const target=validateLocationEdit(user,body.target),scope=memberScope(user);
  const selected=body.mode==='selected'?body.member_ids:null;
  if(selected&&(!Array.isArray(selected)||!selected.length||selected.length>20000||selected.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(selected).size!==selected.length))fail('Select between 1 and 20,000 distinct member records');
  if(body.mode==='selected'&&!selected)fail('Select the members to update');
  return db.transaction(async tx=>{
    const member=await tx.prepare('SELECT id,lga,ward,polling_unit FROM members WHERE id = ? AND ('+scope.sql+') FOR UPDATE').get(id,...scope.params);
    if(!member)fail('Member not found in your area',404);
    if(locationFields.some(k=>String(member[k]??'')!==String(body.source?.[k]??'')))fail('This location has changed. Reopen Edit location and review it again',409);
    const match=matchingLocationClause(member);
    const where=body.mode==='single'?'id = ? AND ('+scope.sql+')':'('+scope.sql+') AND ('+match.sql+')'+(selected?' AND id IN ('+selected.map(()=>'?').join(',')+')':'');
    const params=body.mode==='single'?[id,...scope.params]:[...scope.params,...match.params,...(selected||[])];
    const rows=await tx.prepare('SELECT id FROM members WHERE '+where+' ORDER BY id FOR UPDATE').all(...params);
    if(selected&&rows.length!==selected.length)fail('Some selected records have changed or are outside this location group. Reopen Edit location and review them',409);
    if(rows.length!==Number(body.expected_count))fail('The matching records have changed. Reopen Edit location and review the count',409);
    // IDs are locked first; corrections never spread to new records during the save.
    for(let offset=0;offset<rows.length;offset+=500){
      const ids=rows.slice(offset,offset+500).map(r=>r.id),marks=ids.map(()=>'?').join(',');
      await tx.prepare("UPDATE members SET lga = ?, ward = ?, polling_unit = ?, polling_unit_resolved = 1, vin_verification_status = 'not_checked', vin_verification_json = NULL WHERE id IN ("+marks+')').run(target.lga,target.ward,target.polling_unit,...ids);
      await tx.prepare("UPDATE users SET scope_value = ? WHERE scope_type = 'polling_unit' AND member_id IN ("+marks+')').run(locationFields.map(k=>target[k]).join('|'),...ids);
    }
    return {updated:rows.length,source:body.source,target,mode:body.mode};
  });
}
