import test from 'node:test';
import assert from 'node:assert/strict';
import {reassignPromoters} from './reassign-promoters.js';
import {POLLING_UNITS} from './data/geo.js';
const admin={id:1,role:'admin'},lga='Ori Ire',ward=Object.keys(POLLING_UNITS[lga])[0];
const location={lga,ward,polling_unit:POLLING_UNITS[lga][ward][0]};
const source={id:10,role:'candidate',office:'House of Assembly',status:'active',full_name:'Wrong owner',member_id:1000};
const target={id:20,role:'candidate',office:'House of Assembly',status:'active',full_name:'Right owner',member_id:2000};
function database({sourceAccount=source,targetAccount=target,owner=10,missing=false}={}){
 const writes=[];
 const tx={prepare(sql){return {async all(...params){
  if(sql.includes('FROM users'))return [sourceAccount,targetAccount];
  if(sql.includes('COUNT(*)'))return [{...location,n:2}];
  const requested=params.slice(1);
  return missing?[]:requested.map(id=>({id,...location,upline_user_id:owner}));
 },async run(...params){writes.push({sql,params});}};}};
 return {writes,transaction:fn=>fn(tx)};
}
const body={target_id:20,member_ids:[11],owners:{11:10}};
test('only selected promoters change owner and their location remains unchanged',async()=>{
 const db=database();const result=await reassignPromoters(db,admin,10,body);
 assert.equal(result.updated,1);assert.deepEqual(db.writes[0].params,[20,2000,0,11]);
 assert.ok(!db.writes[0].sql.includes('polling_unit ='));assert.ok(!db.writes[0].params.includes(12));
 assert.deepEqual(db.writes[1].params,[20,11]);assert.match(db.writes[1].sql,/upline_id =/);
});
test('bulk reassignment recalculates quota flags for the new owner',async()=>{
 const db=database();await reassignPromoters(db,admin,10,{...body,member_ids:[11,12],owners:{11:10,12:10}});
 assert.deepEqual(db.writes[0].params,[20,2000,0,11]);assert.deepEqual(db.writes[2].params,[20,2000,1,12]);
});
test('promoter account button can correct its linked member ownership',async()=>{
 const db=database({sourceAccount:{...source,role:'unit_promoter',member_id:11}});
 assert.equal((await reassignPromoters(db,admin,10,body)).updated,1);
});
test('changed owners, missing records, invalid destinations and self-links prevent all writes',async()=>{
 for(const options of [{owner:99},{missing:true},{targetAccount:{...target,role:'admin'}},{targetAccount:{...target,status:'suspended'}},{targetAccount:{...target,member_id:11}}]){
  const db=database(options);await assert.rejects(reassignPromoters(db,admin,10,body));assert.equal(db.writes.length,0);
 }
});
test('candidates cannot reassign and duplicate IDs are rejected',async()=>{
 await assert.rejects(reassignPromoters(database(),{id:10,role:'candidate'},10,body),e=>e.status===403);
 await assert.rejects(reassignPromoters(database(),admin,10,{...body,member_ids:[11,11]}));
});
