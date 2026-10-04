export function deliveryTitle(office) {
  const value = String(office || '').toLowerCase();
  if (value.includes('deputy')) return 'D.GOV';
  if (value.includes('governor')) return 'GOV';
  if (value.includes('stakeholder')) return 'STK';
  if (value.includes('assembly')) return 'HOA';
  if (value.includes('representative') || value === 'house of rep') return 'HOR';
  if (value.includes('senator')) return 'SEN';
  return office || 'Not set';
}
export function deliveryRow(row) {
  const expected = typeof row.nominees_target === 'number' ? row.nominees_target : null;
  const achieved = Number(row.nominees_achieved || 0);
  return {...row, title:deliveryTitle(row.office), achieved, expected,
    gap:expected === null ? null : expected-achieved,
    percentage:expected > 0 ? achieved / expected * 100 : null,
    pu_percentage:row.total_polling_units > 0 ? row.polling_units_covered / row.total_polling_units * 100 : null};
}
export function achievementBand(row) {
  const n=row.percentage;
  return n === null ? 'No numeric target' : n >= 100 ? '100% and above' : n >= 75 ? '75–99%' : n >= 50 ? '50–74%' : n >= 25 ? '25–49%' : 'Below 25%';
}
export function deliveryGroups(rows, group) {
  const grouped = new Map();
  for (const row of rows) {
    const label = group === 'constituency' ? row.constituency : group === 'percentage' ? achievementBand(row) : group === 'title' ? row.title : group === 'gap' ? row.gap === null ? 'No numeric target' : row.gap > 0 ? 'Target outstanding' : 'Target achieved' : 'All promoters';
    if (!grouped.has(label)) grouped.set(label,[]);
    grouped.get(label).push(row);
  }
  return [...grouped.entries()];
}
export function sortDelivery(rows,key,direction) {
  const field={voters:'no_of_voters',percentage:'percentage',coverage:'pu_percentage',gap:'gap',projects:'projects',name:'candidate_name'}[key];
  return [...rows].sort((a,b)=>{
    if (key==='name') return a.candidate_name.localeCompare(b.candidate_name)*(direction==='asc'?1:-1);
    const av=a[field],bv=b[field], valid=v=>typeof v==='number'&&Number.isFinite(v);
    if (!valid(av)||!valid(bv)) return valid(av)?-1:valid(bv)?1:a.candidate_name.localeCompare(b.candidate_name);
    return (av-bv)*(direction==='asc'?1:-1)||a.candidate_name.localeCompare(b.candidate_name);
  });
}
