import test from 'node:test';
import assert from 'node:assert/strict';
import {LGAS,WARDS,POLLING_UNITS,TOTAL_WARDS,TOTAL_POLLING_UNITS,INEC_DIRECTORY,canonicalLocation,SENATORIAL,FEDERAL,STATE_CONST} from './data/geo.js';
import {WARD_CONSTITUENCY,wardsInStateConstituency} from './data/ward-constituencies.js';
import {scopeTargets,scopedWards} from './scope.js';
import {RAW,COMMUNITY_COUNT} from './data/communities.js';
import {referenceVoterCounts} from './reference-voter-counts.js';
import {CANDIDATES} from './data/candidates.js';
import {BSA_YV_MEMBERS} from './data/bsa-yv-members.js';
test('official Kwara directory reconciles every ward and polling unit',()=>{
 assert.equal(LGAS.length,16);assert.equal(TOTAL_WARDS,193);assert.equal(TOTAL_POLLING_UNITS,2887);
 assert.equal(INEC_DIRECTORY.records.length,2887);
 const codes=new Set();
 for(const r of INEC_DIRECTORY.records){
  const code=`23/${r.lga_code}/${r.ward_code}/${r.unit_code}`;
  assert.ok(!codes.has(code));codes.add(code);
  const p=canonicalLocation({lga:r.lga,ward:r.ward,polling_unit:code});
  assert.ok(POLLING_UNITS[p.lga][p.ward].includes(p.polling_unit));
 }
});
test('senatorial and federal scopes partition all Kwara LGAs exactly once',()=>{
 for(const group of [SENATORIAL,FEDERAL])assert.deepEqual(Object.values(group).flat().sort(),LGAS);
 assert.equal(Object.keys(STATE_CONST).length,24);
 assert.equal(Object.keys(SENATORIAL).length,3);assert.equal(Object.keys(FEDERAL).length,6);
});
test('unverified split Assembly wards remain inaccessible instead of sharing a whole LGA',()=>{
 assert.equal(wardsInStateConstituency('Afon').length,0);
 assert.deepEqual(scopedWards({role:'candidate',scope_type:'state_const',scope_value:'Afon'},'Asa'),[]);
 assert.equal(wardsInStateConstituency('Ilorin East').length,WARDS['Ilorin East'].length);
 for(const [lga,wards] of Object.entries(WARD_CONSTITUENCY))for(const m of Object.values(wards))assert.ok(m.code.startsWith('23/'));
});
test('coverage targets use the Kwara directory',()=>{
 const targets=scopeTargets({role:'superadmin',scope_type:'state'});
 assert.equal(targets.wards,193);assert.equal(targets.polling_units,2887);
});
test('Kwara communities contain no other-state LGAs; private rosters and voter counts start empty',()=>{
 assert.equal(COMMUNITY_COUNT,5222);
 assert.equal(Object.values(RAW).reduce((n,rows)=>n+rows.length,0),5222);
 assert.ok(Object.keys(RAW).every(lga=>LGAS.includes(lga)));
 assert.deepEqual(CANDIDATES,[]);assert.deepEqual(BSA_YV_MEMBERS,[]);assert.deepEqual(referenceVoterCounts(),[]);
});
