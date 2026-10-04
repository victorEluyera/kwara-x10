// The Sigar Vote endpoints: the parts that can be checked without a database.
//
// The brief asked for three things this system does not hold — INEC polling
// unit codes, dates of birth, and a progress percentage. Those come back as
// null with a reason. That is worth pinning: a null that quietly becomes an
// omitted key breaks a consumer silently.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CATEGORY_OF_SECTOR, CATEGORIES, STATUS_OF, STATUSES, NOT_AVAILABLE,
  parseNaira, since, registerSigarRoutes,
} from './external-sigar.js';
import { SECTORS } from './data/project-framework.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = () => fs.readFileSync(path.join(here, 'external-sigar.js'), 'utf8');
/** One function's body: from here to the next top-level export. */
const nextExport = (src, start) => {
  const at = src.indexOf(String.fromCharCode(10) + 'export ', start + 1);
  return at > 0 ? at : src.length;
};

test('every framework sector has a Sigar category', () => {
  const missing = SECTORS.filter((s) => !CATEGORY_OF_SECTOR[s]);
  assert.deepEqual(missing, [], 'these projects would silently become "other"');
});

test('the categories are the seven asked for, plus other', () => {
  assert.deepEqual([...CATEGORIES].sort(),
    ['education', 'empowerment', 'health', 'market', 'other', 'power', 'roads', 'water']);
});

test('our statuses map onto theirs, and submitted is not one of ours', () => {
  assert.deepEqual(STATUS_OF, { promised: 'not_started', ongoing: 'ongoing', completed: 'completed' });
  assert.ok(STATUSES.includes('submitted'), 'the vocabulary they use includes it');
  assert.ok(!Object.values(STATUS_OF).includes('submitted'),
    'nothing maps to submitted — every project here has been submitted by definition');
});

test('a naira figure is read out of the free text it was always stored as', () => {
  assert.equal(parseNaira('2500000'), 2500000);
  assert.equal(parseNaira('₦2.5m'), 2500000);
  assert.equal(parseNaira('about 900,000'), 900000);
  assert.equal(parseNaira('2 million naira'), 2000000);
  assert.equal(parseNaira('450k'), 450000);
});

test('text with no number in it gives null, never a guess', () => {
  for (const text of ['', null, undefined, 'to be confirmed', 'ask the chairman']) {
    assert.equal(parseNaira(text), null, JSON.stringify(text) + ' produced a number');
  }
});

test('since accepts an ISO timestamp and refuses anything else', () => {
  assert.equal(since({}), null);
  assert.equal(since({ since: '2026-09-01T00:00:00Z' }), '2026-09-01T00:00:00.000Z');
  assert.equal(since({ since: '2026-09-01' }), '2026-09-01T00:00:00.000Z');
});

test('an unparseable since is a 400, not a silent full export', () => {
  // A caller who believes they are getting a delta and is quietly handed
  // everything will build on that assumption for months.
  assert.throws(() => since({ since: 'last tuesday' }), /ISO timestamp/);
  try { since({ since: 'nonsense' }); } catch (e) { assert.equal(e.status, 400); }
});

test('every route is registered, and all of them through wrap', () => {
  const registered = [];
  const router = { get: (path, handler) => registered.push([path, handler]) };
  let wrapped = 0;
  registerSigarRoutes(router, (fn) => { wrapped++; return fn; });

  assert.deepEqual(registered.map((r) => r[0]),
    ['/areas', '/stakeholders', '/volunteers', '/projects', '/activity', '/all']);
  assert.equal(wrapped, registered.length, 'every handler must go through wrap');
  assert.ok(registered.every(([, h]) => typeof h === 'function'));
});

test('what cannot be answered says so, rather than going missing', () => {
  for (const key of ['polling_unit_code', 'date_of_birth', 'progress_percent']) {
    assert.ok(NOT_AVAILABLE[key], key + ' has no explanation');
    assert.ok(NOT_AVAILABLE[key].length > 20, key + ' explanation is too thin to act on');
  }
});

test('nothing sensitive is selected anywhere in the module', () => {
  // The brief said no NIN, BVN, bank details or ID photographs. The simplest
  // way to keep that true is for the columns never to appear.
  const src = source();
  const selects = src.split('\n').filter((l) => /SELECT|prepare\(/.test(l)).join(' ');
  for (const column of ['nin', 'bvn', 'account_number', 'bank_name', 'pvc_no', 'account_name']) {
    assert.ok(!new RegExp('\b' + column + '\b').test(selects),
      column + ' is being read by the external API');
  }
});

/* ------------------- aggregates only, as the client asked -------------------- */

test('/all carries no person-level data at all', async () => {
  // The consuming side asked for aggregate figures only and filters person
  // fields out on arrival. Sending names and phone numbers it is going to
  // discard would be an exposure that buys nothing.
  const src = source();
  const start = src.indexOf('export async function allPayload');
  assert.ok(start > 0, 'allPayload has moved');
  const body = src.slice(start, src.indexOf('\n}', start));

  assert.ok(!/volunteersPayload/.test(body),
    '/all must not include the volunteer rows — they carry names and phone numbers');
  assert.match(body, /aggregates_only: true/);
});

test('the volunteer rows are still reachable, but only on request', () => {
  const registered = [];
  registerSigarRoutes({ get: (p) => registered.push(p) }, (fn) => fn);
  assert.ok(registered.includes('/volunteers'),
    'matching individuals against PDP membership still needs this endpoint');
  assert.ok(registered.includes('/stakeholders'));
});

test('areas can be grouped by senatorial district', async () => {
  const { areasPayload } = await import('./external-sigar.js');
  assert.equal(typeof areasPayload, 'function');
  // The three districts are whole LGAs, so a district roll-up is always
  // possible without a second pass over the members table.
  const { SENATORIAL } = await import('./data/geo.js');
  assert.deepEqual(Object.keys(SENATORIAL).sort(), ['Kwara Central', 'Kwara North', 'Kwara South']);
});

test('every LGA belongs to exactly one senatorial district', () => {
  // A district roll-up that double-counts an LGA would inflate the totals.
  const src = source();
  assert.match(src, /DISTRICT_OF_LGA/);
});

test('a level the caller invents is refused, and the message lists the real ones', async () => {
  const { areasPayload } = await import('./external-sigar.js');
  await assert.rejects(() => areasPayload({ level: 'street' }),
    /senatorial, lga, ward or polling_unit/);
});

test('project coordinates are not read from the database at all', () => {
  // Not wanted, so not selected. The safest field is the one never fetched.
  const src = source();
  const start = src.indexOf('export async function projectsPayload');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  assert.ok(!/project_sites/.test(body), 'project sites are still being queried');
  assert.ok(!/lat:/.test(body) && !/lng:/.test(body), 'coordinates are still being sent');
  assert.match(src, /coordinates: 'Deliberately not sent/);
});

test('a paged response says whether it is the whole list', () => {
  // "Include a way to tell whether the project list is complete or truncated."
  const src = source();
  assert.match(src, /complete: offset === 0 && rows\.length === total/);
  assert.match(src, /truncated: offset \+ rows\.length < total/);
  // The area roll-ups are never paged, and say so.
  assert.ok((src.match(/complete: true/g) || []).length >= 2);
});

test('the stakeholder summary counts people without naming any', () => {
  const src = source();
  const start = src.indexOf('export async function stakeholdersPayload');
  const body = src.slice(start, src.indexOf('\n}\n', start));

  for (const column of ['full_name', 'username', 'phone', 'first_name', 'last_name']) {
    assert.ok(!new RegExp('\b' + column + '\b').test(body),
      'the stakeholder summary reads ' + column + ' — it must be counts only');
  }
  assert.match(body, /COUNT\(\*\)/);
  assert.match(body, /verified/);
});
