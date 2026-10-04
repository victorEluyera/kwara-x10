import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyExistingMembers} from './live-member-verification.js';
test('empty selection does not change any records',async()=>{
  const result=await verifyExistingMembers({prepare(){throw Error('Unexpected query');}},[]);
  assert.equal(result.updated,0);
});
test('missing uploaded register prevents marking members as VIN not found',async()=>{
  const db={prepare(sql){assert.equal(sql,'SELECT vin FROM voter_roll LIMIT 1');return {get:async()=>null};}};
  await assert.rejects(verifyExistingMembers(db,[{id:1,pvc_no:'VIN'}]),/Upload a voter register/);
});
