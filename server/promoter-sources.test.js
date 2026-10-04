import test from 'node:test';
import assert from 'node:assert/strict';
import {promoterSourceTotals} from './promoter-sources.js';
test('promoter attribution separates candidate and stakeholder owners without counting any record twice',()=>{
  const result=promoterSourceTotals([{role:'candidate',office:'House of Assembly',n:'12'},{role:'candidate',office:' Stakeholder ',n:8},{role:'candidate',office:'Deputy Governor',n:3},{role:null,office:null,n:2},{role:'admin',office:'Stakeholder',n:1}]);
  assert.deepEqual(result,{candidates:15,stakeholders:8,other:3});
  assert.equal(Object.values(result).reduce((sum,n)=>sum+n,0),26);
});
