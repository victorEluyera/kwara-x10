import test from 'node:test';
import assert from 'node:assert/strict';
import {areaTableRows} from './area-table-analysis.js';
const wards=[{lga:'A',ward:'Ward 1',units_reached:2,polling_units:2,voters:100,projects:0},{lga:'A',ward:'Ward 2',units_reached:1,polling_units:4,voters:300,projects:2},{lga:'B',ward:'Ward 3',units_reached:0,polling_units:3,voters:null,projects:0}];
test('ward coverage uses proportions and filtering combines correctly',()=>{
  assert.deepEqual(areaTableRows(wards,{sort:'coverage',direction:'desc'}).map(r=>r.ward),['Ward 1','Ward 2','Ward 3']);
  assert.equal(areaTableRows(wards,{lga:'A',coverage:'partial',projects:'with',search:'ward 2'}).length,1);
  assert.equal(areaTableRows(wards,{sort:'gap',direction:'desc'})[0].ward,'Ward 2');
  for(const direction of ['asc','desc']) assert.equal(areaTableRows(wards,{sort:'voters',direction}).at(-1).ward,'Ward 3');
});
test('polling-unit filters include all matching rows before pagination and sort project arrays by count',()=>{
  const units=Array.from({length:70},(_,i)=>({lga:'A',ward:'Ward 1',polling_unit:String(i),reached:i%2===0,voters:i,projects:i===0?[{title:'Borehole'}]:[]}));
  assert.equal(areaTableRows(units,{ward:'Ward 1'},'unit').length,70);
  const reached=areaTableRows(units,{coverage:'complete',sort:'voters',direction:'desc'},'unit');
  assert.equal(reached.length,35);assert.equal(reached[0].voters,68);
  assert.equal(areaTableRows(units,{search:'borehole',projects:'with'},'unit').length,1);
});
