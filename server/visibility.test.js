// Who can see whose work.
//
// The rule: a candidate sees the network they built and nothing else, even
// inside their own constituency. Wards are shared -- a Senator, a Rep and an
// Assembly candidate all cover the same ground -- so anything scoped by
// geography showed each of them the others' registrations. Only the admins
// (including the DG) and the Governor see across everyone.
//
// These are structural checks over index.js, because the failure they guard
// against is not a failed request: it is one candidate quietly reading
// another's list, which looks exactly like success.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { memberScope, isGovernor } from './scope.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, 'index.js'), 'utf8');

/** The body of a route, from its declaration to the next one. */
function route(signature) {
  const start = src.indexOf(signature);
  assert.ok(start > 0, 'route has moved or been renamed: ' + signature);
  const next = src.indexOf('\napp.', start + 1);
  return src.slice(start, next > 0 ? next : undefined);
}

test('a member fetched by an id from the URL is scope-checked', () => {
  // /api/network takes ?root=<member id>. Without the scope clause, any id
  // typed into the address bar returns that person's whole subtree -- which
  // is the neighbouring candidate's network, in full.
  const body = route("app.get('/api/network'");
  const lookup = /SELECT \* FROM members WHERE id = \?([^)]*)\)/.exec(body);
  assert.ok(lookup, 'the root lookup has moved');
  assert.match(lookup[0], /scope\.sql/, 'the root must be checked against the caller scope');
});

test('the network route returns every direct registration and descendant', () => {
  const body = route("app.get('/api/network'");
  assert.doesNotMatch(body, /LIMIT\s+500/i, 'direct registrations must not be capped');
  assert.match(body,
    /for \(const c of await childStmt\.all\(m\.id\)\) node\.children\.push\(await build\(c\)\)/,
    'each descendant must be included recursively');
  assert.doesNotMatch(body, /depth\s*<\s*3|node\.truncated/,
    'the network must not stop at a fixed depth');
});

test('the ward centre is averaged over the caller\'s own people', () => {
  // It is only a map centre, but it returns a count with it, and "how many has
  // the candidate next door registered here" is not theirs to know.
  const body = route("app.get('/api/geo/ward-centre'");
  assert.match(body, /memberScope\(req\.user\)/);
  assert.match(body, /AVG\(lat\)[\s\S]*?scope\.sql/);
});

test('statewide project totals are limited to project oversight users', () => {
  const body = route("app.get('/api/dashboard'");
  assert.match(body, /const projectOverview = canSeeAllProjects\(req\.user\) \?/);
  assert.match(body, /p\.polling_unit/);
  assert.match(body, /byStatus = \{ promised: 0, ongoing: 0, completed: 0 \}/);
  assert.match(body, /estimated_cost_total: estimatedCostTotal/);
  assert.match(body, /project_overview: projectOverview/);
});

test('duplicate data report requires admin and separates unique, duplicate, and rejected rows', () => {
  const body = route("app.get('/api/admin/member-data-quality'");
  assert.match(body, /authenticate, requireAdmin/);
  assert.match(body, /ROW_NUMBER\(\) OVER/);
  assert.match(body, /duplicate_total/);
  assert.match(body, /problem_total/);
  assert.match(body, /risk_score > 0/);
  assert.match(body, /unique_total: totalReceived - rejectedTotal - duplicateTotal/);
});

test('only administrators can update a project estimated cost', () => {
  const body = route("app.patch('/api/projects/:id'");
  assert.match(body, /if \(b\.budget !== undefined\)/);
  assert.match(body, /Only administrators can set project estimated costs/);
  assert.match(body, /Number\.isFinite\(cost\) \|\| cost < 0/);
});

test('upload-ready nominees are saved as verified', () => {
  const body = route("app.post('/api/members/import'");
  assert.match(body, /verifyWhenReady:\s*true/);
  assert.match(src, /verifyWhenReady\s*\?\s*'verified'\s*:/);
});

test('candidate manual nominee creation allows unmatched PVC and reports verified status', () => {
  const body = route("app.post('/api/members'");
  assert.match(body, /allowUnmatchedVoterRoll:[\s\S]*isCandidateRole\(req\.user\.role\)/);
  assert.match(body, /verifyWhenReady:[\s\S]*isCandidateRole\(req\.user\.role\)/);
  assert.match(src, /status: verifyWhenReady \? 'verified'/);
});

test('projects are visible to their own candidate, the admins and the Governor', () => {
  assert.match(src, /const canSeeAllProjects = \(user\) => canSeeCompliance\(user\);/);
  assert.match(src,
    /const canSeeCompliance = \(user\) =>\s*ADMIN_ROLES\.has\(normaliseRole\(user\.role\)\) \|\| isGovernor\(user\);/);
  // And everyone else is pinned to their own rows.
  assert.match(route("app.get('/api/projects'"), /where\.push\('p\.candidate_id = \?'\);/);
});

test('no route rewrites the scope SQL with a regular expression', () => {
  // The old alias fix patched the finished SQL. It cannot tell a subquery's
  // columns from the outer query's, and the candidate scope now has one.
  assert.doesNotMatch(src, /scope\.sql\.replace\(/,
    'pass { alias } to memberScope instead of patching its output');
});

/* ----------------------------- the rule itself ------------------------------ */

const candidate = (extra = {}) => ({
  id: 7, role: 'candidate', office: 'Senator', member_id: null,
  scope_type: 'senatorial', scope_value: 'Kwara Central', ...extra,
});

test('a candidate is never scoped by geography', () => {
  for (const [scope_type, scope_value] of [
    ['senatorial', 'Kwara Central'], ['federal', 'Akinyele/Lagelu'],
    ['state_const', 'Akinyele I'], ['lga', 'Akinyele'],
    ['ward', 'IKEREKU'], ['state', null],
  ]) {
    const sql = memberScope(candidate({ scope_type, scope_value })).sql;
    assert.doesNotMatch(sql, /\(lga, ward\) IN/, scope_type + ' leaked a ward list');
    assert.doesNotMatch(sql, /^lga IN/, scope_type + ' leaked an LGA list');
    assert.notEqual(sql, '1=1', scope_type + ' saw everybody');
    assert.match(sql, /upline_user_id/, scope_type + ' is not anchored to the candidate');
  }
});

test('only the Governor among candidates sees everyone', () => {
  assert.equal(memberScope(candidate({ office: 'Governor' })).sql, '1=1');
  for (const office of ['Senator', 'House of Representatives', 'House of Assembly',
    'Stakeholder', 'Deputy Governor']) {
    assert.notEqual(memberScope(candidate({ office })).sql, '1=1', office + ' saw everybody');
    assert.equal(isGovernor(candidate({ office })), false);
  }
});

test('the admins and the DG still see everyone', () => {
  for (const role of ['admin', 'superadmin', 'campaign_admin']) {
    assert.equal(memberScope({ id: 1, role, scope_type: 'state' }).sql, '1=1');
  }
});
