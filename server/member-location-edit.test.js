import test from 'node:test';
import assert from 'node:assert/strict';
import {saveMemberLocation,validateLocationEdit,matchingLocationClause} from './member-location-edit.js';
import {POLLING_UNITS} from './data/geo.js';
const user={id:1,role:'admin',scope_type:'state'};
const lga='Ori Ire',ward=Object.keys(POLLING_UNITS[lga])[0];
const target={lga,ward,polling_unit:POLLING_UNITS[lga][ward][0]};
const source={lga,ward:'Ward typo',polling_unit:'School typo'};
function database(){
  const writes=[];
  const tx={prepare(sql){return {
    async get(){return {id:11,...source};},
    async all(...params){if(sql.includes(' AND id IN ('))return params.slice(3).filter(id=>[11,12].includes(id)).map(id=>({id}));return sql.includes('WHERE id = ?')?[{id:11}]:[{id:11},{id:12}];},
    async run(...params){writes.push({sql,params});return {};},
  };}};
  return {writes,transaction:fn=>fn(tx)};
}
test('ward and PU selections must belong to the chosen official parent',()=>{
  assert.deepEqual(validateLocationEdit(user,target),target);
  assert.throws(()=>validateLocationEdit(user,{...target,ward:'Invented ward'}),/ward under/);
  assert.throws(()=>validateLocationEdit(user,{...target,polling_unit:'001'}),/polling unit under/);
  assert.throws(()=>validateLocationEdit({...user,role:'coordinator',scope_type:'lga',scope_value:'Lagelu'},target),/LGA in your area/);
});
test('bulk spelling comparison includes LGA and ward and binds submitted values',()=>{
  const clause=matchingLocationClause({...source,polling_unit:"SCHOOL ' 1"});
  assert.match(clause.sql,/COALESCE\(lga/);assert.match(clause.sql,/COALESCE\(ward/);
  assert.equal(clause.params[2],"SCHOOL ' 1");assert.ok(!clause.sql.includes("SCHOOL"));
});
test('matching corrections update locked IDs and reset stale VIN matching without changing owners',async()=>{
  const db=database();const result=await saveMemberLocation(db,user,11,{mode:'matching',source,target,expected_count:2});
  assert.equal(result.updated,2);assert.equal(db.writes.length,2);
  assert.deepEqual(db.writes[0].params,[target.lga,target.ward,target.polling_unit,11,12]);
  assert.match(db.writes[0].sql,/vin_verification_status = 'not_checked'/);
  assert.match(db.writes[0].sql,/polling_unit_resolved = 1/);
  assert.ok(!db.writes[0].sql.includes('upline_user_id'));
  assert.match(db.writes[1].sql,/scope_type = 'polling_unit'/);
});
test('stale location or matching count prevents all writes',async()=>{
  for(const body of [{mode:'matching',source:{...source,ward:'Old'},target,expected_count:2},{mode:'matching',source,target,expected_count:1}]){
    const db=database();await assert.rejects(saveMemberLocation(db,user,11,body),e=>e.status===409);assert.equal(db.writes.length,0);
  }
});

test('single correction updates just the selected member',async()=>{
 const db=database();const result=await saveMemberLocation(db,user,11,{mode:'single',source,target,expected_count:1});
 assert.equal(result.updated,1);assert.deepEqual(db.writes[0].params,[target.lga,target.ward,target.polling_unit,11]);
});

test('selected correction leaves deselected members untouched even when anchor is deselected',async()=>{
 const db=database();const result=await saveMemberLocation(db,user,11,{mode:'selected',source,target,member_ids:[12],expected_count:1});
 assert.equal(result.updated,1);assert.deepEqual(db.writes[0].params,[target.lga,target.ward,target.polling_unit,12]);
});
test('empty, duplicate, invalid or changed selected records are rejected before writes',async()=>{
 for(const ids of [[],[12,12],['12'],[0],[99],[12,99]]){
  const db=database();await assert.rejects(saveMemberLocation(db,user,11,{mode:'selected',source,target,member_ids:ids,expected_count:ids.length}));assert.equal(db.writes.length,0);
 }
});
