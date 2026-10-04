import test from 'node:test';
import assert from 'node:assert/strict';
import {nomineeVerificationSummary} from './nominee-verification-summary.js';
test('verification categories cover every nominee without approval status affecting counts',()=>{
  const rows=['verified','not_checked','missing_vin','vin_not_found','location_mismatch','needs_review'].map(vin_verification_status=>({pvc_no:'VIN',vin_verification_status,status:'pending'}));
  rows.push({pvc_no:'',vin_verification_status:'not_checked',status:'rejected'});
  const summary=nomineeVerificationSummary(rows);
  assert.equal(summary.total,7);assert.equal(summary.missing_vin,2);
  assert.equal(summary.verified+summary.not_checked+summary.needs_correction,summary.total);
});
test('full-register counts are independent of the latest 500 displayed records',()=>{
  const rows=Array.from({length:3124},(_,i)=>({pvc_no:'VIN'+i,vin_verification_status:i<1000?'verified':'not_checked'}));
  const summary=nomineeVerificationSummary(rows);
  assert.equal(summary.total,3124);assert.equal(summary.verified,1000);assert.equal(summary.not_checked,2124);
});
