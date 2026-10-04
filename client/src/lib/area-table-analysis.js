const projectCount = row => Array.isArray(row.projects) ? row.projects.length : Number(row.projects || 0);
export function areaTableRows(rows, filters = {}, kind = 'ward') {
  const search=String(filters.search || '').trim().toLowerCase();
  const reached=row=>kind==='ward'?Number(row.units_reached || 0):Number(Boolean(row.reached));
  const expected=row=>kind==='ward'?Number(row.polling_units || 0):1;
  const coverage=row=>expected(row)>0?reached(row)/expected(row):0;
  const value=(row,key)=>key==='coverage'?coverage(row):key==='gap'?expected(row)-reached(row):key==='projects'?projectCount(row):row[key];
  return rows.filter(row=>{
    if(filters.lga && row.lga!==filters.lga) return false;
    if(filters.ward && row.ward!==filters.ward) return false;
    if(search && ![row.lga,row.ward,row.polling_unit,...(Array.isArray(row.projects)?row.projects.map(p=>p.title):[])].join(' ').toLowerCase().includes(search)) return false;
    const rate=coverage(row);
    if(filters.coverage==='none' && rate!==0) return false;
    if(filters.coverage==='partial' && !(rate>0 && rate<1)) return false;
    if(filters.coverage==='complete' && rate!==1) return false;
    if(filters.projects==='with' && projectCount(row)===0) return false;
    if(filters.projects==='without' && projectCount(row)>0) return false;
    return true;
  }).sort((a,b)=>{
    const key=filters.sort || (kind==='ward'?'ward':'polling_unit');
    const av=value(a,key),bv=value(b,key);
    if(av==null) return bv==null?0:1;
    if(bv==null) return -1;
    const diff=['voters','people','promoters','pdp','coverage','gap','projects'].includes(key)?Number(av)-Number(bv):String(av).localeCompare(String(bv),undefined,{numeric:true});
    return (filters.direction==='desc'?-1:1)*diff;
  });
}
