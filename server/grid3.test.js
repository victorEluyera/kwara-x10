import test from 'node:test';
import assert from 'node:assert/strict';
import {
  matchLga, matchWard, geometryContains, distanceToGeometry, centroidOf,
} from './grid3.js';
import { BSA_YV_MEMBERS } from './data/bsa-yv-members.js';
import { WARDS } from './data/geo.js';

const square = { type: 'Polygon', coordinates: [[[3.9, 7.4], [4.0, 7.4], [4.0, 7.5], [3.9, 7.5], [3.9, 7.4]]] };

test('GRID3 LGA spellings resolve to geo.js names', () => {
  assert.equal(matchLga('Ogbomoso North'), 'Ogbomosho North');
  assert.equal(matchLga('Ogbomoso South'), 'Ogbomosho South');
  assert.equal(matchLga('OGBOMOSHO SOUTH'), 'Ogbomosho South');
  assert.equal(matchLga('Oorelope'), 'Orelope');
  assert.equal(matchLga('Ona-Ara'), 'Ona Ara');
  assert.equal(matchLga('Ibadan North East'), 'Ibadan North-East');
  assert.equal(matchLga('Kano Municipal'), null);
});

test('GRID3 ward names match exactly, then by tokens with roman numerals folded', () => {
  assert.equal(matchWard('Akinyele', 'Ikereku'), 'IKEREKU');
  assert.equal(matchWard('Afijio', 'Fiditi 1'), 'FIDITI I');
  assert.equal(matchWard('Afijio', 'Somewhere Else Entirely'), null);
});

test('point in polygon and distance to the edge', () => {
  assert.equal(geometryContains(square, 7.45, 3.95), true);
  assert.equal(geometryContains(square, 7.45, 4.05), false);
  const d = distanceToGeometry(square, 7.45, 4.01);
  assert.ok(d > 1000 && d < 1200, 'about 1.1 km east of the edge, got ' + d);
  const c = centroidOf(square);
  assert.ok(Math.abs(c.lat - 7.45) < 1e-9 && Math.abs(c.lng - 3.95) < 1e-9);
});

test('every BSA-YV grassroot resolves to a real LGA and ward, with unique usernames', () => {
  const names = new Set();
  for (const m of BSA_YV_MEMBERS) {
    assert.ok(WARDS[m.lga]?.includes(m.ward), m.sn + ': ' + m.lga + ' / ' + m.ward);
    assert.ok(!names.has(m.username), 'duplicate username ' + m.username);
    names.add(m.username);
  }
  assert.equal(BSA_YV_MEMBERS.length, 2103);
});
