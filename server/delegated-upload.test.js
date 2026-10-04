// Uploading a list on somebody else's behalf.
//
// The risk here is not that it fails — it is that it half-works: rows checked
// against the admin's scope (the whole state) but filed under a candidate, so
// a nominee from the wrong ward is accepted and quietly attributed. Everything
// below is about the list belonging to the candidate, not to whoever is at the
// keyboard.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, 'index.js'), 'utf8');

/** The body of a route, from its declaration to the next one. */
function route(signature) {
  const start = src.indexOf(signature);
  assert.ok(start > 0, 'route has moved or been renamed: ' + signature);
  const next = src.indexOf('\napp.', start + 1);
  return src.slice(start, next > 0 ? next : undefined);
}

test('only an admin may name somebody else as the owner', () => {
  const start = src.indexOf('async function listOwner(req)');
  assert.ok(start > 0, 'listOwner has moved');
  const body = src.slice(start, src.indexOf('\n}', start));

  assert.match(body, /candidate_id/, 'the owner comes from candidate_id');
  assert.match(body, /campaign_admin/);
  assert.match(body, /ADMIN_ROLES\.has/);
  assert.match(body, /role = 'candidate' AND status = 'active'/,
    'the named owner must be an active candidate, not any user id');
  // Without candidate_id a candidate is their own owner and nobody else is.
  assert.match(body, /isCandidateRole\(req\.user\.role\) \? req\.user : null/);
});

for (const [what, signature] of [
  ['nominee import', "app.post('/api/members/import'"],
  ['nominee template', "app.get('/api/members/template."],
  ['project import', "app.post('/api/projects/import'"],
  ['project template', "app.get('/api/projects/template."],
]) {
  test(`the ${what} asks whose list it is`, () => {
    const body = route(signature);
    assert.match(body, /(listOwner|nomineeOwner)\(req\)/, what + ' does not resolve an owner');
  });

  test(`the ${what} scopes to the owner, not the uploader`, () => {
    // scopedLgas(req.user) for an admin is the whole state. Checking a
    // candidate's rows against that would accept another constituency's wards.
    const body = route(signature);
    assert.ok(!/scopedLgas\(req\.user\)/.test(body),
      what + ' scopes to the caller — an admin would pass every ward in Kwara');
    assert.ok(!/scopedWards\(req\.user/.test(body), what + ' builds wards from the caller');
    assert.match(body, /scopedLgas\(owner\)/);
  });
}

test('imported projects are filed under the owner', () => {
  const body = route("app.post('/api/projects/import'");
  assert.match(body, /\)\.run\(owner\.id,/, 'projects must be attributed to the candidate');
  assert.ok(!/\)\.run\(req\.user\.id, p\.title/.test(body),
    'projects are being filed under whoever uploaded them');
});

test('the duplicate check runs against the owner\'s existing list', () => {
  // Checked against the admin's own projects, an admin uploading for three
  // candidates in a row would see no duplicates at all.
  const body = route("app.post('/api/projects/import'");
  assert.match(body, /FROM projects WHERE candidate_id = \?'\s*\)\.all\(owner\.id\)/);
});

test('imported nominees are filed under the owner', () => {
  const body = route("app.post('/api/members/import'");
  assert.match(body, /uplineUserId: owner\.id/);
  assert.match(body, /uplineMemberId: owner\.member_id/);
});

test('the audit says who uploaded it and who it was for', () => {
  // Two different people, and the difference is the whole point of the feature.
  for (const signature of ["app.post('/api/projects/import'", "app.post('/api/members/import'"]) {
    const body = route(signature);
    assert.match(body, /audit\(req\.user\.id, req\.user\.username/,
      'the audit must name the person who actually did it');
  }
  assert.match(route("app.post('/api/projects/import'"), /on_behalf_of/);
});

test('the nominee quota is counted against the owner', () => {
  const body = route("app.post('/api/members/import'");
  assert.match(body, /nominationQuota\(owner\.office\)/);
  assert.match(body, /WHERE upline_user_id = \?[\s\S]*?\.all\(owner\.id\)/);
});

test('the admin panel offers both lists and refuses to guess the owner', () => {
  const panel = fs.readFileSync(
    path.join(here, '..', 'client', 'src', 'components', 'UploadForCandidate.jsx'), 'utf8');
  assert.match(panel, /\/members\/import' \+ query/);
  assert.match(panel, /\/projects\/import' \+ query/);
  assert.match(panel, /candidate_id=/);
  // Both buttons disabled until somebody is chosen: uploading a list to the
  // wrong candidate is tedious to undo and easy to do.
  assert.equal((panel.match(/disabled=\{!chosen\}/g) || []).length, 2);
});
