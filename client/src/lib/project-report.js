export const PROJECT_REPORT_TYPES = ['Solar street', 'Borehole', 'Solar water pump', 'Road grading', 'Transformer', 'Market grants/SME Empowerment', 'Others - Bridge', 'Others'];
export function projectType(project) {
  const text = `${project.project_name || ''} ${project.title || ''}`.toLowerCase();
  if (/street.*light/.test(text)) return PROJECT_REPORT_TYPES[0];
  if (/solar.*(water|pump)|(water|pump).*solar/.test(text)) return PROJECT_REPORT_TYPES[2];
  if (/borehole/.test(text)) return PROJECT_REPORT_TYPES[1];
  if (/grad/.test(text) && /road/.test(text)) return PROJECT_REPORT_TYPES[3];
  if (/transformer/.test(text)) return PROJECT_REPORT_TYPES[4];
  if (/grant|sme|empowerment/.test(text)) return PROJECT_REPORT_TYPES[5];
  if (/bridge/.test(text)) return PROJECT_REPORT_TYPES[6];
  return PROJECT_REPORT_TYPES[7];
}
export function groupProjectLocations(projects) {
  const grouped = new Map();
  for (const p of projects) {
    const location = {lga:p.lga || 'Not recorded',ward:p.ward || 'Not recorded',polling_unit:p.polling_unit || 'Not recorded',project_type:projectType(p)};
    const key = JSON.stringify(Object.values(location));
    if (!grouped.has(key)) grouped.set(key,{...location,count:0});
    const quantity = p.quantity == null ? 1 : Number(p.quantity);
    grouped.get(key).count += Number.isFinite(quantity) && quantity >= 0 ? quantity : 0;
  }
  return [...grouped.values()].sort((a,b) => [a.lga,a.ward,a.polling_unit,a.project_type].join('|').localeCompare([b.lga,b.ward,b.polling_unit,b.project_type].join('|')));
}
