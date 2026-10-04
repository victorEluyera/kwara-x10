import test from 'node:test';
import assert from 'node:assert/strict';
import {compareProjects,projectComparisonTotals} from './project-comparison.js';
const rows=[{candidate_id:1,project_name:'Borehole',lga:'A',ward:'1',ward_voters:100,estimated_cost:500},{candidate_id:2,project_name:'Light',lga:'A',ward:'1',ward_voters:100,estimated_cost:200},{candidate_id:2,project_name:'Road',lga:'B',ward:'1',ward_voters:null,estimated_cost:null}];
test('filters combine and missing values stay last in both sort directions',()=>{
  assert.equal(compareProjects(rows,{candidate:'2',minCost:'100',maxVoters:'100'}).length,1);
  assert.equal(compareProjects(rows,{search:'borehole'})[0].candidate_id,1);
  for(const direction of ['asc','desc']) assert.equal(compareProjects(rows,{},'estimated_cost',direction).at(-1).project_name,'Road');
});
test('ward population is counted once and only matching costs are summed',()=>{
  assert.deepEqual(projectComparisonTotals(rows),{voters:100,wards:1,cost:700});
  assert.equal(projectComparisonTotals(compareProjects(rows,{candidate:'1'})).cost,500);
});
