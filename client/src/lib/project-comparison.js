export function compareProjects(rows, filters={}, order='ward_voters', direction='desc') {
  const q=String(filters.search||'').trim().toLowerCase();
  return rows.filter(r=>{
    if(q && ![r.candidate_name,r.project_name,r.need,r.lga,r.ward,r.community,r.requested_by].join(' ').toLowerCase().includes(q)) return false;
    if(filters.candidate && String(r.candidate_id)!==filters.candidate) return false;
    for(const [field,min,max] of [['estimated_cost','minCost','maxCost'],['ward_voters','minVoters','maxVoters']]) {
      if(filters[min]!=='' && filters[min]!=null && (r[field]==null || Number(r[field])<Number(filters[min]))) return false;
      if(filters[max]!=='' && filters[max]!=null && (r[field]==null || Number(r[field])>Number(filters[max]))) return false;
    }
    return true;
  }).sort((a,b)=>{
    if(a[order]==null) return b[order]==null?0:1;
    if(b[order]==null) return -1;
    const diff=['ward_voters','estimated_cost','quantity'].includes(order)?Number(a[order])-Number(b[order]):String(a[order]).localeCompare(String(b[order]));
    return (direction==='asc'?1:-1)*diff;
  });
}
export function projectComparisonTotals(rows) {
  const wards=new Map();
  for(const r of rows) if(r.ward_voters!=null) wards.set(r.ward_voter_key||JSON.stringify([r.lga,r.ward]),Number(r.ward_voters));
  return {voters:[...wards.values()].reduce((a,b)=>a+b,0),wards:wards.size,cost:rows.reduce((a,r)=>a+(Number(r.estimated_cost)||0),0)};
}
