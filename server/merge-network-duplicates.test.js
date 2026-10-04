import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeNetworkDuplicates} from './merge-network-duplicates.js';
const member=id=>({id,first_name:'Same',last_name:'Person',level:'mobiliser',pvc_no:'VIN',upline_user_id:7,upline_member_id:null,lga:'Akinyele',ward:'Ward 01',polling_unit:'001'});
function dbMock({rows=[member(1),member(2)],outside=null,overlap=null,accounts=[]}={}) {
  const writes=[];
  return {writes,transaction:async fn=>fn({prepare:sql=>({
    all:async()=>sql.startsWith('SELECT * FROM members')?rows:accounts,
    get:async()=>sql.startsWith('SELECT id FROM members')?outside:overlap,
    run:async(...args)=>{writes.push({sql,args});return {changes:1};},
  })})};
}
const user={id:7,role:'candidate',member_id:null};
test('foreign-scope or conflicting records cannot be deleted',async()=>{
  for(const options of [{rows:[member(1)]},{rows:[member(1),{...member(2),last_name:'Different'}]},{outside:{id:90}},{overlap:{task_id:3}},{accounts:[{id:3,role:'candidate'}]}]){
    const db=dbMock(options);await assert.rejects(mergeNetworkDuplicates(db,user,[1,2],1));assert.equal(db.writes.length,0);
  }
});
test('merge retains the selected record and moves all member references before deletion',async()=>{
  const db=dbMock();await mergeNetworkDuplicates(db,user,[1,2],1);
  assert.deepEqual(db.writes.map(w=>w.sql.split(' ')[1]),['members','users','submissions','points_ledger','FROM']);
  for(const write of db.writes.slice(0,-1)) assert.deepEqual(write.args,[1,2]);
  assert.deepEqual(db.writes.at(-1).args,[2]);assert.match(db.writes.at(-1).sql,/DELETE FROM members/);
});
