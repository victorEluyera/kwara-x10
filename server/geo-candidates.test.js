// The link between a candidate's login and the area they can see is a plain
// string match: candidates.js scope_value -> a key in geo.js.
//
// When these drifted, 32 State Assembly candidates resolved to no LGAs and
// signed in to an empty dashboard, with nothing failing loudly to say so.
// These tests make that drift impossible to miss.

import test from 'node:test';
import assert from 'node:assert/strict';
import { LGAS, SENATORIAL, FEDERAL, STATE_CONST, WARDS } from './data/geo.js';
import { CANDIDATES } from './data/candidates.js';

const KEYS = { senatorial: SENATORIAL, federal: FEDERAL, state_const: STATE_CONST };

test('every candidate resolves to at least one LGA', () => {
  const broken = [];
  for (const c of CANDIDATES) {
    if (c.scope_type === 'state') continue;          // Governor: whole state
    const lgas = KEYS[c.scope_type]?.[c.scope_value];
    if (!lgas || !lgas.length) {
      broken.push(`${c.full_name} (${c.scope_type}: "${c.scope_value}")`);
    }
  }
  assert.deepEqual(broken, [], 'these candidates would see an empty dashboard');
});

test('every LGA named in a constituency actually exists', () => {
  const known = new Set(LGAS);
  const bad = [];
  for (const [group, name] of [[SENATORIAL, 'senatorial'], [FEDERAL, 'federal'],
                               [STATE_CONST, 'state']]) {
    for (const [constituency, lgas] of Object.entries(group)) {
      for (const lga of lgas) {
        if (!known.has(lga)) bad.push(`${name}: "${constituency}" -> unknown LGA "${lga}"`);
      }
    }
  }
  assert.deepEqual(bad, [], 'a misspelt LGA silently narrows a candidate to nothing');
});

test('the state constituencies cover all 16 LGAs', () => {
  const covered = new Set(Object.values(STATE_CONST).flat());
  const missing = LGAS.filter((lga) => !covered.has(lga));
  assert.deepEqual(missing, [], 'these LGAs belong to no state constituency');
  assert.equal(Object.keys(STATE_CONST).length, 24, 'Kwara has 24 assembly seats');
});

test('every LGA in a constituency has wards, so dropdowns are not empty', () => {
  const empty = [];
  for (const [constituency, lgas] of Object.entries(STATE_CONST)) {
    for (const lga of lgas) {
      if (!WARDS[lga] || !WARDS[lga].length) empty.push(`${constituency} -> ${lga}`);
    }
  }
  assert.deepEqual(empty, [], 'a ward dropdown would come up blank here');
});

test('the senatorial districts cover all 16 LGAs exactly once', () => {
  const all = Object.values(SENATORIAL).flat();
  assert.equal(all.length, LGAS.length);
  assert.equal(new Set(all).size, LGAS.length, 'an LGA is in two districts');
});

test('the federal constituencies cover all 16 LGAs exactly once', () => {
  const all = Object.values(FEDERAL).flat();
  assert.equal(all.length, LGAS.length);
  assert.equal(new Set(all).size, LGAS.length, 'an LGA is in two constituencies');
});
