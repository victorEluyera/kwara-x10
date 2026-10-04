import test from 'node:test';
import assert from 'node:assert/strict';
import {deliveryTitle,deliveryRow,sortDelivery,deliveryGroups} from './promoter-delivery.js';
test('delivery uses expected minus achieved and preserves surplus and unlimited targets',()=>{
  const r=deliveryRow({nominees_target:200,nominees_achieved:250,total_polling_units:50,polling_units_covered:25});
  assert.equal(r.gap,-50);assert.equal(r.percentage,125);assert.equal(r.pu_percentage,50);
  assert.equal(deliveryRow({nominees_target:'Unlimited',nominees_achieved:20}).percentage,null);
  assert.equal(deliveryRow({nominees_target:0,nominees_achieved:0}).percentage,null);
  assert.deepEqual(['House of Assembly','House of Representatives','Governor','Deputy Governor','Stakeholder','Senator'].map(deliveryTitle),['HOA','HOR','GOV','D.GOV','STK','SEN']);
});
test('sorting and grouping use numeric coverage, keep unknowns last and do not lose candidates',()=>{
  const rows=[deliveryRow({candidate_name:'A',constituency:'One',nominees_target:100,nominees_achieved:50,no_of_voters:20,total_polling_units:10,polling_units_covered:8}),deliveryRow({candidate_name:'B',constituency:'One',nominees_target:100,nominees_achieved:25,no_of_voters:100,total_polling_units:100,polling_units_covered:20}),deliveryRow({candidate_name:'C',constituency:'Two',nominees_target:'Unlimited',no_of_voters:'Not loaded'})];
  assert.equal(sortDelivery(rows,'voters','desc')[0].candidate_name,'B');
  assert.equal(sortDelivery(rows,'coverage','desc')[0].candidate_name,'A');
  assert.equal(sortDelivery(rows,'percentage','asc')[2].candidate_name,'C');
  assert.equal(deliveryGroups(rows,'constituency')[0][1].length,2);
  assert.equal(deliveryGroups(rows,'percentage').length,3);
});
