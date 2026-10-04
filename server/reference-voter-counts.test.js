import test from 'node:test';
import assert from 'node:assert/strict';
import {referenceVoterCounts,wardVoterCounts,withReferenceVoters} from './reference-voter-counts.js';
import {areaReport} from './area-report.js';
import {nominationUnits} from './nominations.js';
test('all 3,276,307 supplied voters remain in the location counts without personal fields',()=>{
 const rows=referenceVoterCounts();assert.equal(rows.reduce((sum,r)=>sum+r.voters,0),3276307);
 for(const row of rows)assert.deepEqual(Object.keys(row).sort(),['lga','polling_unit','voters','ward']);
 assert.equal([...wardVoterCounts(rows).values()].reduce((sum,n)=>sum+n,0),3276307);
});
test('database aggregates take precedence; empty databases use supplied reference totals',()=>{
 const live=[{lga:'Akinyele',ward:'IKEREKU',voters:15}];
 assert.equal(withReferenceVoters(live),live);assert.equal(withReferenceVoters([]),referenceVoterCounts());
});
test('the fast statewide report contains LGA and ward voter numbers on its first response',()=>{
 const report=areaReport({units:nominationUnits({role:'admin',scope_type:'state'}),voters:referenceVoterCounts(),voterRollLoaded:true});
 assert.equal(report.summary.voters,3276307);assert.equal(report.lgas.length,33);
 assert.ok(report.lgas.every(r=>typeof r.voters==='number'));
 assert.ok(report.wards.every(r=>typeof r.voters==='number'));
 assert.ok(report.units.every(r=>typeof r.voters==='number'));
});
