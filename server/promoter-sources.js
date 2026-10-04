import {isCandidateRole} from './auth.js';
export function promoterSourceTotals(rows) {
  const result={candidates:0,stakeholders:0,other:0};
  for(const row of rows){
    const office=String(row.office||'').trim().toLowerCase();
    const key=!isCandidateRole(row.role)?'other':['stakeholder','stk'].includes(office)?'stakeholders':'candidates';
    result[key]+=Number(row.n||0);
  }
  return result;
}
