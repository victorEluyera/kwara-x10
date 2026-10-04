import test from 'node:test';
import assert from 'node:assert/strict';
import {networkRows,networkExport} from './network-analysis.js';
const rows=[{id:1,name:'A',level:'mobiliser',lga:'A',ward:'1',upline_id:7,total_downline:0,verified_downline:0,issues:[]},{id:2,name:'B',level:'mobiliser',lga:'A',ward:'1',upline_id:8,total_downline:12,verified_downline:4,issues:['Missing VIN'],duplicate_group:2}];
test('downline sorting and issue/upline filters combine correctly',()=>{
  assert.equal(networkRows(rows,{direction:'desc'})[0].id,2);
  assert.equal(networkRows(rows,{issues:'issues',downline:'target',upline:'8'}).length,1);
  assert.equal(networkRows(rows,{issues:'clean',downline:'none'})[0].id,1);
  assert.equal(networkRows(rows,{issues:'duplicates'})[0].id,2);
});
test('correction exports retain issues and a response column',()=>{
  const exported=networkExport(rows.filter(r=>r.issues.length));
  assert.equal(exported.length,1);assert.equal(exported[0].Issues,'Missing VIN');
  assert.equal(exported[0]['Correction / response'],'');
});
