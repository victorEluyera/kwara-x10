import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { verifyMemberLocation } from './member-vin-verification.js';
import { POLLING_UNITS } from './data/geo.js';
import { eachCsvRow } from './csv-stream.js';
import { validateVerificationReport, applyMemberVerificationReport } from './apply-member-verification.js';
import { buildWorkbook, zip } from './xlsx.js';
import { unzip } from './xlsx-read.js';
import { readUpload, mapHeader } from './nominee-import.js';
const place={lga:'Akinyele',ward:'IKEREKU',polling_unit:POLLING_UNITS.Akinyele.IKEREKU[0]};
const member={...place,pvc_no:'ABC123',first_name:'Different',last_name:'Name'};
test('VIN and complete location verify independently of name and ward formatting',()=>{
  assert.equal(verifyMemberLocation({...member,ward:'Ward 01'},[{...place,last_name:'Other'}]).status,'verified');
});
test('ward mismatch is reported even when polling-unit labels match',()=>{
  const r=verifyMemberLocation({...member,ward:'Ward 02'},[place]);
  assert.equal(r.status,'location_mismatch');assert.ok(r.differences.includes('ward'));assert.deepEqual(r.assignment,place);
});
test('missing, unfound, conflicting and duplicate VINs keep directory mapping separate from identity matching',()=>{
  assert.equal(verifyMemberLocation({...member,pvc_no:''},[place]).status,'missing_vin');
  assert.equal(verifyMemberLocation(member,[]).status,'vin_not_found');
  assert.equal(verifyMemberLocation(member,[place,{...place,polling_unit:POLLING_UNITS.Akinyele.IKEREKU[1]}]).assignment_source,'submitted_official_directory');
  assert.equal(verifyMemberLocation(member,[place],true).status,'needs_review');
  assert.equal(verifyMemberLocation(member,[{...place,polling_unit:'999'}]).status,'needs_review');
});
test('CSV streaming preserves quoted multiline values and escaped quotes',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'kwara-vin-'));const file=path.join(dir,'input.csv');
  try { fs.writeFileSync(file,'\uFEFFa,b\r\n"line\nnext","say ""hello"""\r\nlast,field');const rows=[];await eachCsvRow(file,r=>rows.push(r));assert.deepEqual(rows,[['a','b'],['line\nnext','say "hello"'],['last','field']]); }
  finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('verification report rejects repeated identifiers and stale owner records',async()=>{
  const row={id:'1',code:'ABC',upline_user_id:'20',pvc_no:'ABC123',original:place,verification:verifyMemberLocation(member,[place])};
  assert.throws(()=>validateVerificationReport({version:1,updates:[row,row]}));
  const db={transaction:fn=>fn({prepare:()=>({all:async()=>[{id:1,code:'ABC',upline_user_id:21,pvc_no:'ABC123',...place}]})})};
  await assert.rejects(applyMemberVerificationReport(db,{version:1,updates:[row]}),/changed since the export/);
});
test('template preamble and Voters VIN heading are accepted',()=>{
  const buffer=buildWorkbook([{name:'Sheet1',rows:[['Candidate Name:'],['Constituency:'],['SN','First name','Surname','LGA','Ward','Polling Unit','Voters VIN']]}]);
  const rows=readUpload(buffer,'template.xlsx').rows;
  assert.equal(rows[0][0],'SN');assert.equal(mapHeader(rows[0]).index.pvc_no,6);
  const files=unzip(buffer);
  const prefixed=zip(Object.entries(files).map(([name,data])=>({name,data:name.endsWith('.xml') ? data.toString('utf8').replace(/(<\/?)(workbook|sheets|sheet|worksheet|sheetData|row|c|is|t|v)(?=[\s/>])/g,'$1x:$2') : data})));
  const alternate=readUpload(prefixed,'prefixed.xlsx').rows;
  assert.deepEqual(alternate,rows);
});

test('applying assignments updates existing IDs and linked account scope without insertion or deletion',async()=>{
  const original={...place,polling_unit:'002'};
  const row={id:'1',code:'ABC',upline_user_id:'20',pvc_no:'ABC123',original,verification:verifyMemberLocation({...original,pvc_no:'ABC123'},[place])};
  const writes=[];
  const tx={prepare:sql=>({all:async()=>[{id:1,code:'ABC',upline_user_id:20,pvc_no:'ABC123',...original}],run:async(...args)=>{writes.push({sql,args});return{changes:1};}})};
  const result=await applyMemberVerificationReport({transaction:fn=>fn(tx)},{version:1,updates:[row],sources:[]});
  assert.deepEqual(result,{ok:true,updated:1,assigned:1});
  assert.equal(writes.length,2);assert.ok(writes.every(w=>! /INSERT|DELETE/.test(w.sql)));
  const changed=JSON.parse(writes[0].args[0])[0];
  assert.equal(changed.id,1);assert.equal(changed.polling_unit,place.polling_unit);
  assert.deepEqual(JSON.parse(changed.detail).submitted,original);
  assert.match(writes[1].sql,/scope_value/);
});
