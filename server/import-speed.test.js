// The things that made adding a nominee slow.
//
// All three were invisible: nothing failed, nothing logged, the work just took
// far longer than it needed to. They are pinned here because each one is easy
// to reintroduce without noticing.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(here, f), 'utf8');

test('asking whether a register is loaded does not count 3.26 million rows', () => {
  // checkVoterRoll runs once per person added, and only ever compared the
  // count against zero. COUNT(*) over the whole register each time was the
  // single slowest thing in the path.
  const src = read('verify.js');
  const start = src.indexOf('export async function checkVoterRoll(');
  assert.ok(start > 0, 'checkVoterRoll has moved');
  const body = src.slice(start, src.indexOf('\n}', start));

  assert.ok(!/voterRollSize\(\)/.test(body),
    'checkVoterRoll is counting the register again — use voterRollLoaded()');
  assert.match(body, /voterRollLoaded\(\)/);
  assert.match(src, /SELECT 1 AS present FROM voter_roll LIMIT 1/);
});

test('the real count is cached, and both writers drop the cache', () => {
  const verify = read('verify.js');
  assert.match(verify, /let cachedSize = null/);
  assert.match(verify, /export const forgetVoterRollSize/);

  // Every path that changes the table has to invalidate it, or the admin page
  // shows a number that is quietly wrong.
  for (const [where, src] of [['loadVoterRoll', verify], ['clearVoterRoll', verify],
    ['the chunk endpoint', read('index.js')]]) {
    assert.match(src, /forgetVoterRollSize\(\)/, where + ' does not drop the cached count');
  }
});

test('a bulk import does not queue every row behind one lock', () => {
  // SELECT ... FOR UPDATE on the candidate's own user row meant every nominee
  // in an upload waited on the same lock. Four workers behind one lock is one
  // worker. The lock existed to make the quota decision atomic, and the quota
  // is no longer a refusal.
  const src = read('index.js');
  const start = src.indexOf('async function registerMemberRow(');
  assert.ok(start > 0, 'registerMemberRow has moved');
  // Comments stripped: the note explaining why the lock went names it.
  const body = src.slice(start, src.indexOf('\napp.', start))
    .split('\n').filter((line) => !/^\s*(\/\/|\*)/.test(line)).join('\n');
  assert.ok(!/FOR UPDATE/.test(body), 'the per-row owner lock is back');
});

test('the columns every added person is looked up by are indexed', () => {
  // findDuplicates scans phone, NIN, PVC and account number once per person.
  // An unindexed column there is a sequential scan of the whole members table.
  const schema = read('db.js');
  for (const index of ['idx_members_phone', 'idx_members_nin', 'idx_members_pvc',
    'idx_members_account', 'idx_members_surname_unit', 'idx_members_upline_unit']) {
    assert.match(schema, new RegExp(index), index + ' is missing');
  }
});

test('the worker count leaves the connection pool some headroom', () => {
  const src = read('index.js');
  const workers = /Number\(process\.env\.IMPORT_WORKERS\) \|\| (\d+)/.exec(src);
  assert.ok(workers, 'the import worker count has moved');
  const poolMax = Number(/PGPOOL_MAX \|\| (\d+)/.exec(read('db.js'))[1]);
  assert.ok(Number(workers[1]) < poolMax,
    'workers must not be able to take every connection in the pool');
});
