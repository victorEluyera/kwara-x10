import test from 'node:test';
import assert from 'node:assert/strict';
import { memberIssueRow, ISSUE_COLUMNS, memberExportFilters } from './member-issues.js';
import { verifyMemberLocation } from './member-vin-verification.js';
import { coverageOf, scopeTargets } from './scope.js';
import { POLLING_UNITS } from './data/geo.js';
const member={id:1,code:'ABC',first_name:'A',last_name:'B',phone:'08000000000',pvc_no:'VIN',upline_user_id:20,owner_name:'Candidate',owner_username:'candidate',lga:'Akinyele',ward:'IKEREKU',polling_unit:'002',nin:'private',account_number:'private'};
test('correction export identifies owner, issue and requested correction without bank or NIN details',()=>{
  const row=memberIssueRow({...member,vin_verification_status:'vin_not_found'});
  assert.equal(row.candidate_id,20);assert.equal(row.vin,'VIN');assert.match(row.action_required,/PVC/);
  assert.equal(row.corrected_vin,'');assert.equal(row.nin,undefined);assert.equal(row.account_number,undefined);
  assert.ok(!ISSUE_COLUMNS.includes('nin'));assert.ok(!ISSUE_COLUMNS.includes('account_number'));
});
test('assigned mismatches preserve original polling unit and ask for confirmation',()=>{
  const real={...member,polling_unit:POLLING_UNITS.Akinyele.IKEREKU[0]};
  const v=verifyMemberLocation(member,[real]);
  const row=memberIssueRow({...real,vin_verification_status:v.status,vin_verification_json:JSON.stringify(v)});
  assert.equal(row.submitted_polling_unit,'002');assert.equal(row.registered_polling_unit,real.polling_unit);
  assert.equal(row.polling_unit_corrected,'Yes');assert.match(row.action_required,/Confirm/);
  const coverage=coverageOf([real,real],scopeTargets({scope_type:'state'}));
  assert.equal(coverage.units,1,'Assigned real polling units count once on the dashboard');
});
test('candidate and issue filters are parameterised and export every matching row',()=>{
  const f=memberExportFilters({issues:'1',upline_user_id:'20',lga:'Akinyele',q:"O'Name",limit:100,offset:100});
  assert.ok(f.where.includes('m.upline_user_id = ?'));
  assert.ok(f.params.includes('20'));assert.ok(f.params.includes("%O'Name%"));
  assert.match(f.where.join(' AND '),/needs_review/);assert.ok(!f.where.join('').includes('LIMIT'));
  assert.ok(!f.where.join('').includes("O'Name"));
});
test('duplicate VIN review exports the specific reason and has no fabricated register location',()=>{
  const row=memberIssueRow({...member,vin_verification_status:'needs_review',vin_verification_json:JSON.stringify({reason:'VIN occurs on multiple nominee records'})});
  assert.match(row.action_required,/multiple nominee/);assert.equal(row.polling_unit_corrected,'No');
});
