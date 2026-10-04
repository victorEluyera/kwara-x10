// Official INEC ward codes. Unverified split Assembly seats remain null.
import fs from 'node:fs';
import { SENATORIAL, FEDERAL, STATE_CONST } from './kwara-constituencies.js';
const directory=JSON.parse(fs.readFileSync(new URL('./inec-kwara-polling-units.json', import.meta.url),'utf8'));
const clean=v=>v.toUpperCase().replace(/[^A-Z0-9]/g,'');
const names=[...new Set(Object.values(SENATORIAL).flat())];
export const WARD_CONSTITUENCY={};
for(const r of directory.records){
 const lga=names.find(n=>clean(n)===clean(r.lga));
 if(!lga)throw Error('Unknown Kwara LGA: '+r.lga);
 const senate=Object.entries(SENATORIAL).find(([,ls])=>ls.includes(lga))[0];
 const federal=Object.entries(FEDERAL).find(([,ls])=>ls.includes(lga))[0];
 const seats=Object.entries(STATE_CONST).filter(([,ls])=>ls.includes(lga));
 (WARD_CONSTITUENCY[lga]||={})[r.ward]={code:'23/'+r.lga_code+'/'+r.ward_code,senatorial:senate,federal,state:seats.length===1?seats[0][0]:null};
}
/** The state constituency a ward belongs to, or null if unknown. */
export function constituenciesForWard(lga, ward) {
  return WARD_CONSTITUENCY[lga]?.[ward] || null;
}

/** Every [lga, ward] pair belonging to a state constituency. */
export function wardsInStateConstituency(name) {
  const found = [];
  for (const [lga, wards] of Object.entries(WARD_CONSTITUENCY)) {
    for (const [ward, meta] of Object.entries(wards)) {
      if (meta.state === name) found.push({ lga, ward });
    }
  }
  return found;
}
