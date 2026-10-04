import test from 'node:test';
import assert from 'node:assert/strict';
import {groupProjectLocations} from './project-report.js';
test('project quantities group by full location and type, retaining separate units and missing locations',()=>{
  const p={lga:'Akinyele',ward:'Ward 1',polling_unit:'001',project_name:'Solar street light'};
  const rows=groupProjectLocations([{...p,quantity:4},{...p,quantity:6},{...p,polling_unit:'002',quantity:2},{...p,project_name:'Borehole',quantity:3},{...p,polling_unit:null,quantity:1}]);
  assert.equal(rows.length,4);
  assert.equal(rows.find(r=>r.polling_unit==='001'&&r.project_type==='Solar street').count,10);
  assert.equal(rows.find(r=>r.polling_unit==='002').count,2);
  assert.equal(rows.find(r=>r.project_type==='Borehole').count,3);
  assert.equal(rows.find(r=>r.polling_unit==='Not recorded').count,1);
});
