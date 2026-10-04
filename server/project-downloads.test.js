import test from 'node:test';
import assert from 'node:assert/strict';
import {inflateRawSync} from 'node:zlib';
import {allCandidateTemplates,itemCostReviewCsv} from './project-downloads.js';
import {ITEMS} from './data/project-items.js';
function entries(buf) {
  const out = {}; let at=0;
  while(buf.readUInt32LE(at)===0x04034b50) {
    const len=buf.readUInt32LE(at+18), n=buf.readUInt16LE(at+26), extra=buf.readUInt16LE(at+28);
    const name=buf.toString('utf8',at+30,at+30+n), start=at+30+n+extra;
    out[name]=inflateRawSync(buf.subarray(start,start+len)); at=start+len;
  }
  return out;
}
test('same-name candidates have separate scoped templates; missing scopes are reported',()=>{
  const candidates=[{id:1,full_name:'Same name'},{id:2,full_name:'Same name'},{id:3,full_name:'No area'}];
  const archive=entries(allCandidateTemplates(candidates,c=>c.id===3?{lgas:[],wardsByLga:{}}:{lgas:['Akinyele'],wardsByLga:{Akinyele:[`Ward 0${c.id}`]}}));
  const names=Object.keys(archive).filter(n=>n.endsWith('.xlsx'));
  assert.equal(names.length,2); assert.notEqual(names[0],names[1]);
  assert.match(entries(archive[names[0]])['xl/worksheets/sheet2.xml'].toString(),/Ward 01/);
  assert.match(entries(archive[names[1]])['xl/worksheets/sheet2.xml'].toString(),/Ward 02/);
  assert.match(archive['README.txt'].toString(),/No area.*no assigned area/);
  assert.ok(archive['project-item-cost-review.csv']);
});
test('cost list includes every catalogue item and leaves confirmation blank',()=>{
  const csv=itemCostReviewCsv();
  assert.equal(csv.trim().split(/\r?\n/).length,ITEMS.length+1);
  assert.match(csv,/Confirmed unit cost/);
  assert.match(csv,/5000000/);
  for(const item of ITEMS) assert.ok(csv.includes(item.label.replaceAll('"','""')));
});
