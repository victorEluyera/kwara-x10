import { zip, toCsv } from './xlsx.js';
import { buildProjectTemplate, templateFilename } from './project-template.js';
import { ITEMS } from './data/project-items.js';

export function itemCostReviewCsv() {
  return toCsv([
    ['Project category','Item','Unit','Current estimated unit cost (NGN)','Confirmed unit cost (NGN)','Specification / size','Cost includes delivery / installation?','Confirmed by','Confirmation date','Notes'],
    ...ITEMS.map(item => [item.sector,item.label,item.unit || '',item.unit_cost ?? '','','','','','','']),
  ]);
}

export function allCandidateTemplates(candidates, scope) {
  const entries = [], notes = [
    'Each Excel file belongs to the candidate identified in its filename and Instructions sheet.',
    'Return each completed file separately and select that candidate when uploading.',
    'Item estimates are not confirmed quotations. Complete project-item-cost-review.csv to confirm specifications and unit prices.',
    '',
  ];
  for (const candidate of candidates) {
    const {lgas,wardsByLga} = scope(candidate);
    const who = candidate.full_name || candidate.username;
    if (!lgas.length) { notes.push(`No template: ${who} (ID ${candidate.id}) has no assigned area.`); continue; }
    entries.push({name:`candidate-${candidate.id}-${templateFilename(who)}`,data:buildProjectTemplate({lgas,wardsByLga,who})});
  }
  notes.push(`Templates included: ${entries.length} of ${candidates.length} candidates.`);
  entries.push({name:'README.txt',data:notes.join('\r\n')});
  entries.push({name:'project-item-cost-review.csv',data:itemCostReviewCsv()});
  return zip(entries);
}
