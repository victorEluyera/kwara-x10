import fs from 'node:fs';
import path from 'node:path';
import { parseCsv } from './xlsx-read.js';
import { eachCsvRow } from './csv-stream.js';
import { eachRow, listSheets } from './xlsx-stream.js';
import { canonicalLocation, hasPollingUnit } from './data/geo.js';
import { vinKey, placeKey, verifyMemberLocation } from './member-vin-verification.js';

const [nomineeFile, outputDir, ...sources] = process.argv.slice(2);
if (!sources.length) throw Error('Usage: node server/verify-nominee-files.js NOMINEES.csv OUTPUT_DIR REGISTER.csv [REGISTER.xlsx ...]');
const rows = parseCsv(fs.readFileSync(nomineeFile, 'utf8'));
const headers = rows.shift();
const members = rows.filter(r => r.some(Boolean)).map(r => Object.fromEntries(headers.map((h,i) => [h,r[i] || ''])));
const wanted = new Map(), frequencies = new Map(), cache = new Map();
for (const m of members) { const k=vinKey(m.pvc_no); if(k) { wanted.set(k,new Map()); frequencies.set(k,(frequencies.get(k)||0)+1); } }
const totals = [];
for (const source of sources) {
  let index, count=0;
  const visit = (row, number) => {
    if(number===1) { index=Object.fromEntries(row.map((h,i)=>[String(h).trim().toLowerCase(),i])); return; }
    if(index['voter id number']===undefined) return;
    const vin=vinKey(row[index['voter id number']]); if(!vin) return;
    count++;
    const matches=wanted.get(vin);
    if(matches) {
      const raw={lga:row[index.lga],ward:row[index.ward],polling_unit:row[index['polling unit']]};
      const key=placeKey(raw); if(!cache.has(key))cache.set(key,canonicalLocation(raw));
      const loc=cache.get(key); matches.set(placeKey(loc),loc);
    }
  };
  if(/\.csv$/i.test(source)) await eachCsvRow(source,visit);
  else for(const sheet of await listSheets(source)) { await eachRow(source,sheet,visit); console.log(JSON.stringify({source:path.basename(source),sheet:sheet.name,scanned:count})); }
  totals.push({source:path.basename(source),rows:count});
  if (!count) throw Error('No voter rows found in ' + path.basename(source) + '; check the register headings');
  console.log(JSON.stringify(totals.at(-1)));
}
const updates=[], statuses={};
const output=members.map(m=>{
  const k=vinKey(m.pvc_no), v=verifyMemberLocation(m,[...(wanted.get(k)?.values()||[])],frequencies.get(k)>1);
  statuses[v.status]=(statuses[v.status]||0)+1;
  updates.push({id:m.id,code:m.code,upline_user_id:m.upline_user_id,pvc_no:m.pvc_no,original:{lga:m.lga,ward:m.ward,polling_unit:m.polling_unit},verification:v});
  return {...m,...(v.assignment||{}),original_lga:m.lga,original_ward:m.ward,original_polling_unit:m.polling_unit,vin_verification_status:v.status,registered_lga:v.registered?.lga||'',registered_ward:v.registered?.ward||'',registered_polling_unit:v.registered?.polling_unit||'',location_differences:v.differences.join('; '),verification_note:v.reason||'',polling_unit_assigned:hasPollingUnit(v.assignment || m)};
});
const columns=[...headers,'original_lga','original_ward','original_polling_unit','vin_verification_status','registered_lga','registered_ward','registered_polling_unit','location_differences','verification_note','polling_unit_assigned'];
const cell=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
fs.mkdirSync(outputDir,{recursive:true});
fs.copyFileSync(nomineeFile,path.join(outputDir,'original-nominees.csv'));
fs.writeFileSync(path.join(outputDir,'all-nominees-with-verification.csv'),'\uFEFF'+[columns.map(cell).join(','),...output.map(r=>columns.map(c=>cell(r[c])).join(','))].join('\r\n')+'\r\n');
fs.writeFileSync(path.join(outputDir,'member-verification-updates.json'),JSON.stringify({version:1,sources:totals,updates}));
const summary={members:members.length,sources:totals,statuses,assigned_real_polling_units:output.filter(r=>r.polling_unit_assigned).length,retained_all:true,live_database_changed:false};
fs.writeFileSync(path.join(outputDir,'summary.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary));
