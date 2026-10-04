// Coverage: how much ground has actually been reached.
//
// The dashboard read "389 / 351 wards" — more ground covered than exists. Two
// causes, both worth pinning: it counted ward NAMES rather than wards, and it
// never checked a name against the INEC register, so anything typed or
// imported under a different spelling counted as coverage.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { coverageOf, scopeTargets, POLLING_UNIT_BENCHMARK } from './scope.js';
import { LGAS, WARDS, POLLING_UNITS } from './data/geo.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const TARGETS = { lgas: 33, wards: 351, polling_units: 6364 };

const real = (lga, ward) => ({
  lga, ward, polling_unit: POLLING_UNITS[lga][ward][0], promoters: 10,
});

test('coverage can never exceed the target', () => {
  // Every row in the register, plus a pile of rubbish. The rubbish must not
  // push the total past what exists.
  const places = [];
  for (const lga of LGAS) for (const ward of WARDS[lga]) places.push(real(lga, ward));
  for (let i = 0; i < 200; i++) {
    places.push({ lga: 'Akinyele', ward: 'MADE UP WARD ' + i, polling_unit: 'X' });
  }

  const c = coverageOf(places, TARGETS);
  assert.equal(c.wards, 351);
  assert.equal(c.wards_percent, 100);
  assert.equal(c.wards_remaining, 0);
  assert.ok(c.wards <= TARGETS.wards, 'coverage exceeded the thing being covered');
});

test('a ward is only a ward together with its LGA', () => {
  // Two ward names are shared between LGAs, and polling-unit names repeat far
  // more — 6,364 units under 6,263 distinct names. Counting names loses them.
  const names = new Map();
  for (const lga of LGAS) for (const ward of WARDS[lga]) {
    names.set(ward, (names.get(ward) || 0) + 1);
  }
  const shared = [...names.values()].filter((n) => n > 1).length;
  assert.ok(shared > 0, 'no shared ward names — has the register changed?');

  const both = [...names.entries()].find(([, n]) => n > 1)[0];
  const lgas = LGAS.filter((l) => WARDS[l].includes(both));
  const c = coverageOf(lgas.map((l) => real(l, both)), TARGETS);
  assert.equal(c.wards, 2, 'the same ward name in two LGAs is two wards');
});

test('a ward suffix resolves but an unsupported ward description is not coverage', () => {
  const c = coverageOf([
    real('Akinyele', 'IKEREKU'),
    { lga: 'Akinyele', ward: 'Ikereku Ward', polling_unit: 'somewhere' },
    { lga: 'Akinyele', ward: 'IKEREKU (MAIN)', polling_unit: 'somewhere' },
  ], TARGETS);

  assert.equal(c.wards, 1, 'only the real ward counts');
  assert.equal(c.unrecognised_wards, 1);
  assert.ok(c.unrecognised_examples.length, 'the bad values must be reported, not hidden');
});

test('an LGA that is not in the register is ignored entirely', () => {
  const c = coverageOf([{ lga: 'Lagos Island', ward: 'SOMEWHERE', polling_unit: 'X' }], TARGETS);
  assert.equal(c.lgas, 0);
  assert.equal(c.wards, 0);
});

test('a polling unit only counts inside a ward that counts', () => {
  const lga = 'Akinyele';
  const ward = WARDS[lga][0];
  const c = coverageOf([
    { lga, ward, polling_unit: POLLING_UNITS[lga][ward][0], promoters: 10 },
    { lga, ward, polling_unit: 'INVENTED UNIT' },
  ], TARGETS);
  assert.equal(c.units, 1);
  assert.equal(c.unrecognised_units, 1);
});

test('percentages and what is left agree with the counts', () => {
  const places = WARDS.Akinyele.slice(0, 6).map((w) => real('Akinyele', w));
  const c = coverageOf(places, { lgas: 1, wards: 12, polling_units: 100 });
  assert.equal(c.wards, 6);
  assert.equal(c.wards_percent, 50);
  assert.equal(c.wards_remaining, 6);
  assert.equal(c.wards + c.wards_remaining, 12);
});

test('nothing reached is zero, not a crash', () => {
  for (const empty of [[], null, undefined]) {
    const c = coverageOf(empty, TARGETS);
    assert.equal(c.wards, 0);
    assert.equal(c.wards_percent, 0);
    assert.equal(c.wards_remaining, 351);
  }
});

test('uploaded casing and spacing differences still reach the same real location', () => {
  const place = real('Akinyele', 'IKEREKU');
  const variant = { lga: 'AKINYELE', ward: ' ikereku ', polling_unit: place.polling_unit.toLowerCase().replace(/ /g, '  ') };
  const coverage = coverageOf([place, variant], TARGETS);
  assert.equal(coverage.units, 1);
  assert.equal(coverage.wards, 1);
  assert.equal(coverage.unrecognised_units, 0);
});

test('uploaded ward and unit numbers resolve through official INEC codes', () => {
  const c = coverageOf([
    { lga: 'Akinyele', ward: 'Ward 06', polling_unit: '002', promoters: 10 },
    { lga: 'Ibadan North-West', ward: 'Ward 09', polling_unit: 'Not specified' },
    { lga: 'Atiba', ward: 'WARD 09 ASHIPA 2 ATIBA', polling_unit: '7388' },
  ], TARGETS);
  assert.equal(c.wards, 1); // The other recognised wards have no valid PU allocation.
  assert.equal(c.units, 1);
  assert.equal(c.unrecognised_wards, 0);
});

test('ward code plus a real unit name reaches exactly that unit', () => {
  const place = real('Akinyele', 'AKINYELE/ISABIYI/IREPODUN');
  assert.equal(coverageOf([{ ...place, ward: 'Ward 06' }], TARGETS).units, 1);
});

test('a candidate is measured against their own ground', () => {
  // "2 of 351" tells a State Assembly candidate with six wards nothing.
  const targets = scopeTargets({ role: 'candidate', scope_type: 'state_const',
    scope_value: 'Akinyele I' });
  assert.equal(targets.wards, 6);
  assert.equal(targets.polling_unit_benchmark, POLLING_UNIT_BENCHMARK);
  assert.ok(targets.polling_units < POLLING_UNIT_BENCHMARK);

  const c = coverageOf([real('Akinyele', 'IKEREKU')], targets);
  assert.equal(c.wards_percent, 17);
  assert.equal(c.wards_remaining, 5);
});

test('statewide expected coverage uses the agreed 6,390 polling-unit target', () => {
  const targets = scopeTargets({ role: 'admin' });
  assert.equal(POLLING_UNIT_BENCHMARK, 6390);
  assert.equal(targets.polling_units, 6390);
});

test('the dashboard no longer counts ward names in SQL', () => {
  const src = fs.readFileSync(path.join(here, 'index.js'), 'utf8');

  // Counting names inside a GROUP BY is fine — grouped by LGA, a ward name is
  // already unique. It was the ungrouped total that was wrong.
  const ungrouped = [...src.matchAll(/'SELECT[\s\S]{0,600}?\)\.(?:get|all)\(/g)]
    .map((m) => m[0])
    .filter((query) => !/GROUP BY/.test(query))
    .filter((query) => /COUNT\(DISTINCT (?:ward|polling_unit)\)/.test(query));

  assert.deepEqual(ungrouped, [],
    'an ungrouped COUNT(DISTINCT ward) counts names, which is what produced 389 of 351');
  assert.match(src, /coverageOf\(places, scopeTargets\(req\.user\), req\.user\)/);
});

test('ordinary coverage remains independent of promoter saturation',()=>{
 const place=real('Akinyele',WARDS.Akinyele[0]);
 assert.equal(coverageOf([{...place,promoters:9}],TARGETS).units,1);
 const result=coverageOf([{...place,promoters:4},{...place,lga:place.lga.toUpperCase(),promoters:6}],TARGETS);
 assert.equal(result.units,1);assert.equal(result.wards,1);assert.equal(result.lgas,1);
});

test('PU saturation counts only units with at least ten promoters without affecting coverage',()=>{
 const first=real('Akinyele',WARDS.Akinyele[0]);
 const second={...first,polling_unit:POLLING_UNITS[first.lga][first.ward][1]};
 const targets={lgas:1,wards:1,polling_units:2};
 const result=coverageOf([{...first,promoters:25},{...second,promoters:6},{...first,polling_unit:'Not specified',promoters:100}],targets);
 assert.equal(result.saturation_completed,1);assert.equal(result.saturation_expected,2);
 assert.equal(result.saturation_remaining,1);assert.equal(result.saturation_percent,50);
 assert.equal(result.units,2);
 const full=coverageOf([{...first,promoters:25},{...second,promoters:10}],targets);
 assert.equal(full.saturation_percent,100);assert.equal(full.saturation_remaining,0);
 const empty=coverageOf([],targets);assert.equal(empty.saturation_completed,0);assert.equal(empty.saturation_remaining,2);
});
