import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deleteAccount} from './delete-account.js';
const target={id:7,full_name:'Candidate A',office:'HOA',scope_value:'Area A',username:'candidate-a'};
function fakeDb(failAt=null) {
  const committed=[], attempts=[];
  return {committed,attempts,transaction:async fn=>{
    const pending=[];
    const tx={prepare:sql=>({get:async(...args)=>{attempts.push({sql,args});return {id:7};},run:async(...args)=>{
      attempts.push({sql,args}); if(sql.includes(failAt || '\0')) throw new Error('database failure');
      pending.push({sql,args}); return {changes:1};
    }})};
    await fn(tx); committed.push(...pending);
  }};
}
test('every user foreign key is detached before deleting the account',async()=>{
  const db=fakeDb(); await deleteAccount(db,target,'2026-10-01');
  const schema=readFileSync(new URL('./db.js',import.meta.url),'utf8');
  let table=''; const references=[];
  for(const line of schema.split('\n')) {
    const match=line.match(/CREATE TABLE IF NOT EXISTS (\w+)/);if(match)table=match[1];
    if(line.includes('REFERENCES users(id)')) references.push([table,line.trim().split(/\s+/)[0]]);
  }
  for(const [table,column] of references) assert.ok(db.committed.slice(0,-1).some(q=>q.sql.includes(table)&&q.sql.includes(column)),`${table}.${column} must be handled`);
  assert.equal(db.committed.at(-1).sql,'DELETE FROM users WHERE id = ?');
  assert.match(db.attempts[0].sql,/FOR UPDATE/);
});
test('projects and reports retain attribution; member reviewers are cleared independently',async()=>{
  const db=fakeDb(); await deleteAccount(db,target,'2026-10-01');
  for(const table of ['projects','disparity_reports']) {
    const q=db.committed.find(q=>q.sql.startsWith(`UPDATE ${table} SET former_candidate_name`));
    assert.deepEqual(q.args,['Candidate A','HOA','Area A','candidate-a',7]);
    assert.ok(!db.committed.some(q=>q.sql.startsWith(`DELETE FROM ${table}`)));
  }
  assert.ok(db.committed.some(q=>q.sql==='UPDATE members SET reviewed_by = NULL WHERE reviewed_by = ?'));
  assert.ok(db.committed.every(q=>!q.sql.startsWith('DELETE FROM members')));
  assert.ok(db.committed.some(q=>q.sql.includes('revoked_at = COALESCE')));
});
test('a failure leaves the account and earlier changes uncommitted',async()=>{
  const db=fakeDb('UPDATE api_keys');
  await assert.rejects(deleteAccount(db,target,'2026-10-01'),/database failure/);
  assert.equal(db.committed.length,0);
  assert.ok(!db.attempts.some(q=>q.sql==='DELETE FROM users WHERE id = ?'));
});
