import test from 'node:test';
import assert from 'node:assert/strict';
import {networkReport,duplicateMergeReason} from './network-report.js';
import {POLLING_UNITS} from './data/geo.js';
const lga='Akinyele',ward=Object.keys(POLLING_UNITS[lga])[0],polling_unit=POLLING_UNITS[lga][ward][0];
const member=(id,extra={})=>({id,code:'M'+id,first_name:'A',last_name:'Person',phone:'08012345678',pvc_no:'VIN1',level:'mobiliser',upline_user_id:7,upline_member_id:null,lga,ward,polling_unit,vin_verification_status:'verified',...extra});
const user={id:7,role:'candidate'};
test('direct downline is computed once for both member and login links without duplicate rows',()=>{
  const result=networkReport([member(1),member(2,{pvc_no:'VIN2',upline_member_id:1,level:'grassroot'}),member(3,{pvc_no:'VIN3',upline_user_id:80,level:'grassroot',vin_verification_status:'missing_vin'})],[{id:80,member_id:1}],user,10);
  assert.equal(result.rows.length,3); assert.equal(result.rows[0].total_downline,2);assert.equal(result.rows[0].verified_downline,1);
  assert.equal(networkReport([member(1),member(2,{upline_member_id:1})],[],user,10,2).rows.length,1);
});
test('duplicate VINs are reviewable; shared phones alone never permit removal',()=>{
  const result=networkReport([member(1),member(2),member(3,{pvc_no:'OTHER'})],[],user,10);
  assert.equal(result.duplicate_groups.length,1);assert.equal(result.duplicate_groups[0].can_merge,true);
  assert.ok(result.rows[2].issues.includes('Shared phone number: review'));assert.equal(result.rows[2].duplicate_group,null);
  assert.match(duplicateMergeReason([member(1),member(2,{last_name:'Different'})]),/Names differ/);
  assert.match(duplicateMergeReason([member(1),member(2,{upline_user_id:8})]),/owners/);
  assert.match(duplicateMergeReason([member(1,{nin:'111'}),member(2,{nin:'222'})]),/Identity/);
});
test('candidate records do not get VIN flags and correction details contain no bank or NIN fields',()=>{
  const result=networkReport([member(1,{level:'candidate',pvc_no:null,polling_unit:'Unknown',nin:'secret',account_number:'secret'}),member(2,{vin_verification_status:'location_mismatch',vin_verification_json:JSON.stringify({registered:{lga,ward,polling_unit},reason:'Location differs'})})],[],user,10);
  assert.deepEqual(result.rows[0].issues,[]);assert.equal(result.rows[1].registered_location.polling_unit,polling_unit);
  assert.ok(!JSON.stringify(result).includes('secret'));
});
