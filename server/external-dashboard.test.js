import test from 'node:test';
import assert from 'node:assert/strict';
import {apiLocation,buildDashboardPayload,fieldWorkSummary,dashboardPayload,clearExternalDashboardCache} from './external-dashboard.js';
import {POLLING_UNITS} from './data/geo.js';
const lga=Object.keys(POLLING_UNITS)[0],ward=Object.keys(POLLING_UNITS[lga])[0],polling_unit='001';
const place={lga,ward,polling_unit};
test('official place identifiers resolve aliases and never invent unknown units',()=>{
  assert.match(apiLocation(place).polling_unit_code,/^30\/\d{2}\/\d{2}\/001$/);
  assert.equal(apiLocation({...place,polling_unit:'unknown unit'}).polling_unit_code,null);
});
test('snapshot matches receiving sanitizer, has uncapped complete projects and no member identifiers',()=>{
  const projects=Array.from({length:2101},(_,id)=>({id,title:'Solar street',project_name:'Solar street',budget:'1000',quantity:1,status:id===0?'completed':'request',...place}));
  const result=buildDashboardPayload([{...place,members:'10',verified:'2',pending:'8',unit_promoters:'7',grassroots:'3'}],projects,[],'2026-10-03T00:00:00Z');
  assert.equal(result.summary.totals.registered,10);assert.equal(result.summary.coverage.polling_units,1);
  assert.equal(result.projects.rows.length,2101);assert.equal(result.projects.total,2101);assert.equal(result.projects.truncated,false);
  assert.equal(result.projects.stages.submitted,2100);assert.equal(result.coverage.by_ward[0].estimated_cost,2101000);
  assert.doesNotMatch(JSON.stringify(result),/first_name|account_number|pvc_no|\bnin\b/);
});
test('field work aggregates actual option answers, location and dates, without exposing free text or inventing sentiment',()=>{
  const definition=[{id:'q1',label:'Main community problem',type:'select',options:['Water','Roads']},{id:'q2',label:'Any comments?',type:'text'}];
  const rows=[{...place,task_id:4,task_title:'Field work',questions_json:JSON.stringify(definition),
    answers_json:JSON.stringify({q1:'Water',q2:'Call John on 08012345678 about the borehole'}),responses:3,collected_at:'2026-10-02T23:30:00Z'}];
  const result=fieldWorkSummary(rows);
  assert.equal(result.responses,3);assert.equal(result.questions[0].answers[0].responses,3);
  assert.equal(result.by_location[0].questions[0].answers[0].value,'Water');
  assert.equal(result.responses_by_date[0].date,'2026-10-03');assert.equal(result.sentiment_available,false);
  assert.equal(result.issues_and_needs.find(topic=>topic.topic==='Water').responses,3);
  assert.equal(result.by_location[0].issues_and_needs[0].responses,3);
  assert.doesNotMatch(JSON.stringify(result),/John|08012345678/);
  const sentiment=fieldWorkSummary([{...rows[0],questions_json:JSON.stringify([{id:'s',label:'Community sentiment',options:['Positive','Negative','Neutral']}]),answers_json:'{"s":"Negative"}'}]);
  assert.equal(sentiment.sentiment.negative,3);assert.equal(sentiment.sentiment_available,true);
  assert.equal(sentiment.by_location[0].sentiment.negative,3);
});
test('dashboard queries explicitly exclude test flags and owners; concurrent refreshes share queries',async()=>{
  clearExternalDashboardCache();const queries=[];
  const database={prepare:sql=>{queries.push(sql);return {all:async()=>[],get:async()=>({last_updated_at:null})};}};
  await Promise.all([dashboardPayload(database),dashboardPayload(database)]);
  assert.equal(queries.length,8);
  for(const query of queries.slice(0,3)){assert.match(query,/is_test/);assert.match(query,/delete me/);}
  assert.doesNotMatch(queries[1],/LIMIT/);
  assert.match(queries[2],/collector.is_test/);
  clearExternalDashboardCache();
});
