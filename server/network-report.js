import {canonicalLocation,hasPollingUnit,WARDS} from './data/geo.js';
const vin=value=>String(value||'').replace(/\s/g,'').toUpperCase();
const name=row=>[row.first_name,row.last_name].join(' ').trim().replace(/\s+/g,' ').toLowerCase();
const participant=row=>['mobiliser','grassroot','grassroots'].includes(row.level);
export function duplicateMergeReason(rows) {
  if(rows.length<2) return 'Select at least two records';
  const first=rows[0], identifier=vin(first.pvc_no);
  if(!identifier || !rows.every(r=>vin(r.pvc_no)===identifier)) return 'VINs must match';
  if(!rows.every(r=>participant(r)&&r.level===first.level)) return 'Member levels must match';
  if(!rows.every(r=>name(r)===name(first))) return 'Names differ; correct or review these records first';
  if(!rows.every(r=>r.upline_user_id===first.upline_user_id && r.upline_member_id===first.upline_member_id)) return 'Registration owners or uplines differ; administrator review required';
  const place=canonicalLocation(first);
  if(!rows.every(r=>JSON.stringify(canonicalLocation(r))===JSON.stringify(place))) return 'Locations differ; correct or review these records first';
  const nins=new Set(rows.map(r=>String(r.nin||'').replace(/\D/g,'')).filter(Boolean));
  if(nins.size>1) return 'Identity details conflict; administrator review required';
  if(rows.some(r=>rows.some(other=>other.id===r.upline_member_id))) return 'Records are linked as parent and child; administrator review required';
  return null;
}
export function networkReport(members,users,user,baseline,rootId=null) {
  const byId=new Map(members.map(m=>[m.id,m]));
  const loginMembers=new Map(users.map(u=>[u.id,u.member_id]));
  const parents=new Map(members.map(m=>[m.id,byId.has(m.upline_member_id)?m.upline_member_id:byId.has(loginMembers.get(m.upline_user_id))?loginMembers.get(m.upline_user_id):null]));
  const children=new Map();
  for(const m of members) {const parent=parents.get(m.id);if(parent && parent!==m.id){if(!children.has(parent))children.set(parent,[]);children.get(parent).push(m);}}
  let selected=members;
  if(rootId){const ids=new Set(),stack=[rootId];while(stack.length){const id=stack.pop();if(ids.has(id))continue;ids.add(id);for(const c of children.get(id)||[])stack.push(c.id);}selected=members.filter(m=>ids.has(m.id));}
  const groups=new Map(),phoneGroups=new Map();
  for(const m of selected.filter(participant)) {
    const key=vin(m.pvc_no);if(key){if(!groups.has(key))groups.set(key,[]);groups.get(key).push(m);}
    let phone=String(m.phone||'').replace(/\D/g,'');if(phone.startsWith('234'))phone='0'+phone.slice(3);
    if(phone.length===10)phone='0'+phone;
    if(phone.length>=10){if(!phoneGroups.has(phone))phoneGroups.set(phone,[]);phoneGroups.get(phone).push(m.id);}
  }
  const duplicateGroups=[...groups.values()].filter(rows=>rows.length>1).map(rows=>({id:Math.min(...rows.map(r=>r.id)),member_ids:rows.map(r=>r.id),reason:duplicateMergeReason(rows),can_merge:!duplicateMergeReason(rows)}));
  const duplicates=new Map(duplicateGroups.flatMap(g=>g.member_ids.map(id=>[id,g.id])));
  const sharedPhones=new Set([...phoneGroups.values()].filter(ids=>ids.length>1).flat());
  const statuses={missing_vin:'Missing VIN',vin_not_found:'VIN not found in voter register',location_mismatch:'VIN location differs',needs_review:'VIN/location needs review',not_checked:'Voter verification not checked'};
  const canMerge=['admin','superadmin'].includes(user.role)||user.role==='candidate';
  return {baseline,can_merge:canMerge,duplicate_groups:duplicateGroups,rows:selected.map(m=>{
    const place=canonicalLocation(m),issues=[];
    if(participant(m)){
      if(!vin(m.pvc_no))issues.push('Missing VIN');
      else if(statuses[m.vin_verification_status||'not_checked'])issues.push(statuses[m.vin_verification_status||'not_checked']);
      if(!(WARDS[place.lga]||[]).includes(place.ward))issues.push('Ward not recognised');
      if(!hasPollingUnit(place))issues.push('Polling unit not recognised');
      if(duplicates.has(m.id))issues.push('Duplicate VIN');
      if(sharedPhones.has(m.id))issues.push('Shared phone number: review');
    }
    let verification={};try{verification=JSON.parse(m.vin_verification_json||'{}');}catch{}
    const direct=children.get(m.id)||[];
    return {id:m.id,code:m.code,name:[m.first_name,m.last_name].join(' '),phone:m.phone,pvc_no:m.pvc_no,level:m.level,
      lga:m.lga,ward:m.ward,polling_unit:m.polling_unit,upline_id:parents.get(m.id),upline:byId.has(parents.get(m.id))?[byId.get(parents.get(m.id)).first_name,byId.get(parents.get(m.id)).last_name].join(' '):'Top of network',
      total_downline:direct.length,verified_downline:direct.filter(c=>c.vin_verification_status==='verified').length,
      issues,verification_reason:verification.reason||'',registered_location:verification.registered?canonicalLocation(verification.registered):null,duplicate_group:duplicates.get(m.id)||null,created_at:m.created_at,vin_verification_status:m.vin_verification_status||'not_checked'};
  })};
}
