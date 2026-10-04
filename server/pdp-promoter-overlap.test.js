import test from 'node:test';
import assert from 'node:assert/strict';
import {pdpIdentity,readPdpContacts,countPdpPromoters,pdpPromoterOverlap,clearPdpContactIndex,importPdpContacts} from './pdp-promoter-overlap.js';
test('PDP matching requires both name and phone, preserving normalised Nigerian formats',()=>{
  assert.equal(pdpIdentity('ADE TEST','+234 803 123 4567','secret'),pdpIdentity('Test Ade','08031234567','secret'));
  assert.notEqual(pdpIdentity('Another Person','08031234567','secret'),pdpIdentity('Test Ade','08031234567','secret'));
  assert.equal(pdpIdentity('Ade','missing','secret'),null);
  assert.notEqual(pdpIdentity('Ade','08031234567','a'),pdpIdentity('Ade','08031234567','b'));
});
test('headerless source includes the first person and headed files map columns by name',()=>{
  const original=readPdpContacts(Buffer.from('Test Ade,M,1990,08031234567,001,Ward 1,Afijio,OTHER,connected\nSecond Person,F,1991,08031234568,001,Ward 1,Afijio,OTHER,connected'));
  assert.equal(original.length,2);assert.equal(original[0].name,'Test Ade');
  assert.deepEqual(readPdpContacts(Buffer.from('phone,name\n08031234567,Test Ade')),[{name:'Test Ade',phone:'08031234567'}]);
});
test('overlap deduplicates people, never counts an area total or an unmatched shared phone',()=>{
  const secret='test-only-secret';
  const result=countPdpPromoters([{first_name:'Test',last_name:'Ade',phone:'08031234567'},
    {first_name:'Ade',last_name:'Test',phone:'+2348031234567'},{first_name:'Other',last_name:'Name',phone:'08031234567'}],
    {secret,identities:new Set([pdpIdentity('Test Ade','08031234567',secret)]),source_records:10});
  assert.equal(result.matched_promoters,1);assert.equal(result.matched_promoter_records,2);
  assert.doesNotMatch(JSON.stringify(result),/08031234567|test-only-secret/);
});
test('missing private source is explicitly unavailable, not a false zero',async()=>{
  clearPdpContactIndex();
  const result=await pdpPromoterOverlap({prepare:()=>({get:async()=>undefined})});
  assert.equal(result.loaded,false);assert.equal(result.matched_promoters,null);
  clearPdpContactIndex();
});
test('PDP source import stores only private hashes, serialises replacement and leaves members untouched',async()=>{
  const calls=[];
  const database={transaction:async fn=>fn({prepare:sql=>({get:async()=>{calls.push({sql});return undefined;},run:async(...params)=>calls.push({sql,params})})})};
  const rows=[{name:'Ade Sample',phone:'08031234567'},{name:'Sample Ade',phone:'+2348031234567'}];
  const result=await importPdpContacts(database,rows,7);
  assert.equal(result.source_records,2);assert.equal(result.source_identities,1);
  assert.match(calls[0].sql,/pg_advisory_xact_lock/);
  const insert=calls.find(call=>call.sql.startsWith('INSERT INTO pdp_contact_match_index'));
  assert.match(JSON.parse(insert.params[0])[0],/^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(calls),/08031234567|Ade Sample|UPDATE members|DELETE FROM members/);
  assert.equal(Object.hasOwn(result,'secret'),false);
});
