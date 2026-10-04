import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWard, canonicalLocation, WARDS } from './data/geo.js';
import { uniqueSpellingMatch, editDistance } from './location-spelling.js';
import { verifyMemberLocation } from './member-vin-verification.js';
import { memberIssueRow } from './member-issues.js';

test('Kwara ward numbers, codes and names resolve within the specified LGA',()=>{
  for(const value of ['Ward 12','WARD 012','012','12','Afon ward','AFON','23/01/012']) assert.equal(resolveWard('Asa',value),'AFON');
  assert.equal(resolveWard('Asa','YOWERE/SOSOKI WARD ONE'),'YOWERE/SOSOKI');
});
test('Kwara spelling corrections do not cross LGAs or contradict ward numbers',()=>{
  assert.equal(resolveWard('Asa','AFOON ward'),'AFOON ward');
  assert.equal(resolveWard('Baruten','AFON ward'),'AFON ward');
  assert.equal(resolveWard('Asa','AFON WARD 2'),'AFON WARD 2');
  assert.equal(resolveWard('Asa','999'),'999');
});
test('ambiguous spelling and numeric identifiers are never guessed',()=>{
  assert.equal(uniqueSpellingMatch('AKETA',[{value:'one',aliases:['AKATA']},{value:'two',aliases:['AKITA']}]),null);
  assert.equal(uniqueSpellingMatch('School II',[{value:'one',aliases:['School I']}]),null);
  assert.equal(uniqueSpellingMatch('Street 2 Village',[{value:'one',aliases:['Street 3 Village']}]),null);
  assert.equal(editDistance('AKTAA','AKATA'),1);
});
test('polling-unit corrections remain inside the resolved Kwara ward',()=>{
  assert.equal(canonicalLocation({lga:'Asa',ward:'12',polling_unit:'AFON AREA CORT'}).polling_unit,'AFON AREA COURT');
  assert.equal(canonicalLocation({lga:'Asa',ward:'1',polling_unit:'AFON AREA CORT'}).polling_unit,'AFON AREA CORT');
});
test('a corrected ward cannot invent a VIN or polling-unit assignment',()=>{
  const raw={lga:'Asa',ward:'Afon ward',polling_unit:'Not specified',pvc_no:''};
  const v=verifyMemberLocation(raw,[]);
  assert.equal(v.status,'missing_vin');assert.equal(v.assignment.ward,'AFON');
  assert.equal(v.assignment_source,'submitted_official_ward');assert.equal(v.assignment.polling_unit,'Not specified');
  const issue=memberIssueRow({...raw,...v.assignment,vin_verification_status:v.status,vin_verification_json:JSON.stringify(v)});
  assert.equal(issue.polling_unit_corrected,'No');
  assert.ok(WARDS.Asa.includes(v.assignment.ward));
});
