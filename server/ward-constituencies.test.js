// The ward-to-constituency table is generated from the campaign office's
// master workbook and reconciled against the ward names already in geo.js.
// These tests guard that reconciliation: a ward that does not line up would
// silently drop a candidate's area, which is exactly the failure mode that
// left 32 assembly candidates with empty dashboards before.

import test from 'node:test';
import assert from 'node:assert/strict';
import { LGAS, WARDS, STATE_CONST, FEDERAL, SENATORIAL } from './data/geo.js';
import { WARD_CONSTITUENCY, constituenciesForWard, wardsInStateConstituency }
  from './data/ward-constituencies.js';

test('all 351 wards are mapped', () => {
  const total = Object.values(WARD_CONSTITUENCY)
    .reduce((a, wards) => a + Object.keys(wards).length, 0);
  assert.equal(total, 351);
});

test('every mapped ward exists in geo.js, under the same LGA', () => {
  const bad = [];
  for (const [lga, wards] of Object.entries(WARD_CONSTITUENCY)) {
    if (!LGAS.includes(lga)) { bad.push('unknown LGA: ' + lga); continue; }
    for (const ward of Object.keys(wards)) {
      if (!(WARDS[lga] || []).includes(ward)) bad.push(lga + ' / ' + ward);
    }
  }
  assert.deepEqual(bad, [], 'these wards do not exist in geo.js');
});

test('every geo.js ward has a mapping -- none left behind', () => {
  const missing = [];
  for (const lga of LGAS) {
    for (const ward of WARDS[lga] || []) {
      if (!WARD_CONSTITUENCY[lga]?.[ward]) missing.push(lga + ' / ' + ward);
    }
  }
  assert.deepEqual(missing, [], 'these wards would resolve to no constituency');
});

test('every constituency named is one the app knows', () => {
  const bad = [];
  for (const [lga, wards] of Object.entries(WARD_CONSTITUENCY)) {
    for (const [ward, m] of Object.entries(wards)) {
      const where = lga + ' / ' + ward + ': ';
      if (!STATE_CONST[m.state]) bad.push(where + 'state "' + m.state + '"');
      if (!FEDERAL[m.federal]) bad.push(where + 'federal "' + m.federal + '"');
      if (!SENATORIAL[m.senatorial]) bad.push(where + 'senatorial "' + m.senatorial + '"');
    }
  }
  assert.deepEqual(bad, [], 'a constituency label does not match geo.js');
});

test("a ward's constituencies agree with the LGA-level groupings", () => {
  // If a ward says it is in state constituency X, then X must list that
  // ward's LGA. Catches a row assigned to the wrong constituency entirely.
  const bad = [];
  for (const [lga, wards] of Object.entries(WARD_CONSTITUENCY)) {
    for (const [ward, m] of Object.entries(wards)) {
      if (!STATE_CONST[m.state].includes(lga)) {
        bad.push(lga + ' / ' + ward + ' -> state "' + m.state + '" excludes this LGA');
      }
      if (!FEDERAL[m.federal].includes(lga)) {
        bad.push(lga + ' / ' + ward + ' -> federal "' + m.federal + '" excludes this LGA');
      }
      if (!SENATORIAL[m.senatorial].includes(lga)) {
        bad.push(lga + ' / ' + ward + ' -> senatorial "' + m.senatorial + '" excludes this LGA');
      }
    }
  }
  assert.deepEqual(bad, [], 'ward and LGA groupings disagree');
});

test('the split LGAs really are split between two constituencies', () => {
  // This is the whole point of the exercise: Akinyele I and Akinyele II must
  // now resolve to different wards, not the same twelve.
  for (const lga of ['Akinyele', 'Ibadan North', 'Ibadan North-East',
                     'Ibadan South-East', 'Ibadan South-West']) {
    const seats = new Set(Object.values(WARD_CONSTITUENCY[lga]).map((m) => m.state));
    assert.equal(seats.size, 2, lga + ' should split across two constituencies');
  }
});

test('every state constituency owns at least one ward', () => {
  const empty = Object.keys(STATE_CONST).filter((sc) => wardsInStateConstituency(sc).length === 0);
  assert.deepEqual(empty, [], 'these constituencies would show nothing');
});

test('the 32 state constituencies partition all 351 wards exactly once', () => {
  const counted = Object.keys(STATE_CONST)
    .reduce((a, sc) => a + wardsInStateConstituency(sc).length, 0);
  assert.equal(counted, 351, 'wards are double-counted or missing');
});

test('constituenciesForWard resolves a known ward and rejects an unknown one', () => {
  const found = constituenciesForWard('Afijio', WARDS.Afijio[0]);
  assert.ok(found, 'a real ward should resolve');
  assert.equal(found.state, 'Afijio');
  assert.equal(found.senatorial, 'Kwara Central');
  assert.equal(constituenciesForWard('Afijio', 'NOT A REAL WARD'), null);
  assert.equal(constituenciesForWard('Nowhere', 'X'), null);
});
