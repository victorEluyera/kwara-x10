import test from 'node:test';
import assert from 'node:assert/strict';
import {pdpIndex,createPdpCounts,attachPdpCounts,candidatePdpCount,pdpCount} from './pdp-counts.js';
import {POLLING_UNITS} from './data/geo.js';
const lga='Asa',ward='AFON',polling_unit=POLLING_UNITS[lga][ward][0];
test('missing Kwara PDP source is unavailable and contains no inherited Oyo counts',()=>{
 const data=pdpIndex();assert.equal(data.loaded,false);assert.equal(data.total,0);assert.equal(data.lgas.size,0);
 assert.equal(pdpCount({lga,ward,polling_unit}),null);
 assert.equal(candidatePdpCount({scope_type:'state'}),null);
});
test('supplied counts reconcile without assigning unknown polling units',()=>{
 const data=createPdpCounts([{lga,ward,polling_unit,count:3},{lga:'ASA',ward,polling_unit,count:2},{lga,ward,polling_unit:'Unknown location',count:4}]);
 assert.equal(data.total,9);assert.equal(data.lgas.get(lga),9);assert.equal(data.wardAllocated,9);assert.equal(data.unitAllocated,5);assert.equal(data.unmapped[0].count,4);
});
test('reports preserve registration counts and explicitly mark unloaded PDP counts',()=>{
 const report={summary:{people:3,units_reached:1},units:[{lga,ward,polling_unit,promoters:3}],wards:[{lga,ward}],lgas:[{lga}]};
 attachPdpCounts(report);assert.deepEqual(report.summary,{people:3,units_reached:1});assert.equal(report.units[0].promoters,3);
 assert.equal(report.units[0].pdp_people,null);assert.equal(report.pdp_source.loaded,false);assert.equal(report.pdp_source.total,null);
});
