import test from 'node:test';
import assert from 'node:assert/strict';
import {readContactVerification,matchContactRows,contactVerificationImport} from './contact-verification.js';
import {POLLING_UNITS} from './data/geo.js';
const member={id:1,code:'M001',first_name:'Test',last_name:'Member'};
const input=(text)=>readContactVerification(Buffer.from(text),'calls.csv');
test('reads old member exports with added call-result columns, preserving codes and multiline notes',()=>{
  const rows=input('id,code,contact_verification_status,contact_verification_notes\r\n1,M001,Verified,"Confirmed,\nby phone"');
  assert.equal(rows[0].status,'verified');assert.equal(rows[0].notes,'Confirmed,\nby phone');
  assert.equal(matchContactRows(rows,[member])[0].error,'');
});
test('rejects wrong identities, duplicate members, unsupported results and timestamps without timezone',()=>{
  assert.match(matchContactRows([{id:'1',code:'WRONG',status:'verified',notes:'',caller:'',called_at:''}],[member])[0].error,/do not match/);
  const row={id:'1',code:'M001',status:'verified',notes:'',caller:'',called_at:''};
  assert.match(matchContactRows([row,row],[member])[1].error,/more than once/);
  assert.match(matchContactRows([{...row,status:'yes'}],[member])[0].error,/Use verified/);
  assert.match(matchContactRows([{...row,called_at:'2026-10-03 10:30'}],[member])[0].error,/timezone/);
  assert.match(matchContactRows([row],[])[0].error,/not found/);
  assert.throws(()=>input('phone,result\n08000000000,verified'),/id or code/);
});
test('preview does not write; result-only imports preserve personal details and invalid imports do not write',async()=>{
  const writes=[];
  const db={transaction:async fn=>fn({prepare:sql=>({all:async()=>[member],run:async(...params)=>{writes.push({sql,params});}})})};
  const rows=input('id,contact_verification_status,contact_verified_by\n1,verified,Agent');
  assert.equal((await contactVerificationImport(db,{id:7,role:'admin'},rows)).ready,1);
  assert.equal(writes.length,0);
  assert.equal((await contactVerificationImport(db,{id:7,role:'admin'},rows,true)).updated,1);
  assert.equal(writes.length,1);
  assert.match(writes[0].sql,/contact_verification_uploaded_by/);
  assert.doesNotMatch(writes[0].sql,/upline_user_id\s*=/);
  const saved=JSON.parse(writes[0].params[2]);assert.equal(saved[0].called_at,null);
  assert.deepEqual(saved[0].corrections,{});assert.equal(saved[0].location_changed,false);
  await assert.rejects(()=>contactVerificationImport(db,{id:7,role:'admin'},[{...rows[0],status:'invalid'}],true),/No members were updated/);
  assert.equal(writes.length,1);
});
test('corrected account columns take priority, retain zeroes and blank fields do not erase data',()=>{
  const rows=input('id,contact_verification_status,account_number,corrected_account_number,bank_name\n1,verified,1234567890,0012345678,');
  const result=matchContactRows(rows,[{...member,account_number:'1234567890',bank_name:'Existing bank'}])[0];
  assert.equal(result.error,'');assert.deepEqual(result.corrections,{account_number:'0012345678'});
  assert.equal(result.changes[0].before,'1234567890');assert.equal(result.vin_changed,false);
  assert.match(matchContactRows(input('id,contact_verification_status,account_number\n1,verified,12345678'),[member])[0].error,/10 digits/);
});
test('location corrections resolve unit variants within real wards, invalid units block the import',async()=>{
  const lga=Object.keys(POLLING_UNITS)[0],ward=Object.keys(POLLING_UNITS[lga])[0],unit=POLLING_UNITS[lga][ward][0];
  const original={...member,lga,ward,polling_unit:'Not specified',pvc_no:'VIN-A'};
  const rows=input('id,contact_verification_status,corrected_polling_unit,corrected_vin\n1,verified,001,VIN-B');
  const matched=matchContactRows(rows,[original])[0];
  assert.equal(matched.error,'');assert.equal(matched.corrections.polling_unit,unit);
  assert.equal(matched.location_changed,true);assert.equal(matched.vin_changed,true);
  assert.ok(matchContactRows([{...rows[0],corrections:{polling_unit:'NOT A REAL UNIT'}}],[original])[0].error);
  const writes=[];
  const database={transaction:async fn=>fn({prepare:sql=>({all:async()=>[original],run:async(...params)=>writes.push({sql,params})})})};
  const result=await contactVerificationImport(database,{id:7,role:'admin'},rows,true);
  assert.equal(result.corrected,1);assert.equal(writes.length,2);
  assert.match(writes[0].sql,/vin_verification_status=CASE WHEN r.location_changed OR r.vin_changed THEN 'not_checked'/);
  assert.match(writes[1].sql,/UPDATE users.*scope_value/);
});
