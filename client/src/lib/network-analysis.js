export function networkRows(rows,filters={}) {
  const term=String(filters.search||'').trim().toLowerCase();
  return rows.filter(r=>{
    if(term && ![r.name,r.code,r.phone,r.pvc_no,r.upline,r.lga,r.ward,r.polling_unit].join(' ').toLowerCase().includes(term))return false;
    for(const key of ['level','lga','ward'])if(filters[key]&&r[key]!==filters[key])return false;
    if(filters.upline&&String(r.upline_id||'root')!==filters.upline)return false;
    if(filters.downline==='none'&&r.total_downline!==0)return false;
    if(filters.downline==='some'&&r.total_downline===0)return false;
    if(filters.downline==='below'&&r.total_downline>=10)return false;
    if(filters.downline==='target'&&r.total_downline<10)return false;
    if(filters.issues==='issues'&&!r.issues.length)return false;
    if(filters.issues==='clean'&&r.issues.length)return false;
    if(filters.issues==='duplicates'&&!r.duplicate_group)return false;
    if(filters.issues&&!['issues','clean','duplicates'].includes(filters.issues)&&!r.issues.includes(filters.issues))return false;
    return true;
  }).sort((a,b)=>{
    const key=filters.sort||'total_downline';
    const diff=['total_downline','verified_downline'].includes(key)?Number(a[key])-Number(b[key]):String(a[key]||'').localeCompare(String(b[key]||''),undefined,{numeric:true});
    return (filters.direction==='asc'?1:-1)*diff||a.id-b.id;
  });
}
export function networkExport(rows) {
  return rows.map(r=>({'Code':r.code,'Name':r.name,'Phone':r.phone,'VIN':r.pvc_no,'Level':r.level,'Reports to':r.upline,'LGA':r.lga,'Ward':r.ward,'Polling unit':r.polling_unit,'Direct downline':r.total_downline,'VIN/location matched downline':r.verified_downline,'Issues':r.issues.join('; '),'Verification detail':r.verification_reason,'Registered LGA':r.registered_location?.lga,'Registered ward':r.registered_location?.ward,'Registered polling unit':r.registered_location?.polling_unit,'Correction / response':''}));
}
