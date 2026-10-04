// The community gazetteer, from GRID3. These tests are mostly about honesty:
// the file is generated from someone else's data, so what matters is that we
// know exactly how much of it is usable and never quietly hide the rest.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RAW, COMMUNITY_COUNT, communitiesIn, findCommunity, searchCommunities,
} from './data/communities.js';
import { LGAS, WARDS } from './data/geo.js';

test('every LGA is present', () => {
  assert.deepEqual(Object.keys(RAW).sort(), [...LGAS].sort());
});

test('every LGA has communities', () => {
  const empty = LGAS.filter((l) => !RAW[l].length);
  assert.deepEqual(empty, []);
});

test('the declared count matches the data', () => {
  const actual = Object.values(RAW).reduce((n, v) => n + v.length, 0);
  assert.equal(COMMUNITY_COUNT, actual);
});

test('every entry has a name and a point inside Kwara', () => {
  // A generous box around the state. A stray point would silently fling the
  // project map somewhere else entirely.
  const bad = [];
  for (const [lga, list] of Object.entries(RAW)) {
    for (const [name, , , lat, lng] of list) {
      if (!name || typeof name !== 'string') bad.push(`${lga}: empty name`);
      else if (!(lat > 6.9 && lat < 9.3 && lng > 2.5 && lng < 4.8)) {
        bad.push(`${lga} / ${name}: ${lat},${lng}`);
      }
    }
  }
  assert.deepEqual(bad.slice(0, 10), []);
});

test('a ward hint, when present, is a real ward of that LGA', () => {
  // The hint drives the sort order. A ward name that belongs to another LGA
  // would push the wrong communities to the top.
  const bad = [];
  for (const [lga, list] of Object.entries(RAW)) {
    for (const [name, ward] of list) {
      if (ward && !(WARDS[lga] || []).includes(ward)) bad.push(`${lga} / ${name}: ${ward}`);
    }
  }
  assert.deepEqual(bad.slice(0, 10), []);
});

test('names are unique within an LGA and ward', () => {
  const dupes = [];
  for (const [lga, list] of Object.entries(RAW)) {
    const seen = new Set();
    for (const [name, ward] of list) {
      const key = name.toUpperCase() + '|' + ward.toUpperCase();
      if (seen.has(key)) dupes.push(`${lga}: ${name} (${ward})`);
      seen.add(key);
    }
  }
  assert.deepEqual(dupes.slice(0, 10), []);
});

test('communities named in the real proposals are findable', () => {
  // Verbatim from the Akinyele, Iwajowa and Old Ifedapo submissions. If these
  // are missing, a candidate copying their own sheet hits a dead autocomplete.
  for (const [lga, name] of [
    ['Akinyele', 'Ikereku'],
    ['Akinyele', 'Yejuade'],
    ['Saki West', 'Mokola'],
    ['Saki West', 'Kooko'],
  ]) {
    assert.ok(findCommunity(lga, name), `${name} is missing from ${lga}`);
  }
});

test('a ward filter sorts, it does not hide', () => {
  // GRID3 and INEC do not share a ward set, so about a third of communities
  // carry no ward. Filtering them out would make real places untypeable --
  // they must still be offered, just after the ones we know are in the ward.
  const lga = 'Akinyele';
  const ward = RAW[lga].find((c) => c[1])?.[1];
  assert.ok(ward, 'expected at least one ward hint in Akinyele');

  const filtered = communitiesIn(lga, ward);
  assert.equal(filtered.length, RAW[lga].length, 'nothing may be dropped');
  assert.equal(filtered[0].ward, ward, 'the chosen ward comes first');

  const firstOther = filtered.findIndex((c) => c.ward !== ward);
  const lastMine = filtered.findLastIndex((c) => c.ward === ward);
  assert.ok(lastMine < firstOther, 'the ward block must not be interleaved');
});

test('an unknown LGA yields nothing rather than throwing', () => {
  assert.deepEqual(communitiesIn('Lagos Island'), []);
  assert.equal(findCommunity('Lagos Island', 'Ikereku'), null);
});

test('search matches a prefix before a substring', () => {
  const hits = searchCommunities('Akinyele', null, 'Iker', 5);
  assert.ok(hits.length);
  assert.ok(hits[0].name.toUpperCase().startsWith('IKER'), hits[0].name);
});

test('search finds an alternative name too', () => {
  // GRID3 records a second name for many settlements; people use both.
  let sample = null;
  for (const [lga, list] of Object.entries(RAW)) {
    const found = list.find((c) => c[2]);
    if (found) { sample = { lga, name: found[0], alt: found[2] }; break; }
  }
  assert.ok(sample, 'expected at least one alternative name in the gazetteer');
  assert.ok(searchCommunities(sample.lga, null, sample.alt, 20)
    .some((c) => c.name === sample.name), `searching "${sample.alt}" lost ${sample.name}`);
});

test('an empty search term returns the head of the list', () => {
  assert.equal(searchCommunities('Akinyele', null, '', 8).length, 8);
});
