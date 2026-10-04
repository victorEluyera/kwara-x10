// The item catalogue exists so that a candidate holding a real proposal can
// find what it asks for. So the tests are the real proposals: the words in
// them must resolve to an item, or the catalogue has not done its job.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ITEMS, ITEMS_BY_ID, ITEMS_BY_SECTOR, UNITS, estimatedProjectCost, findItem,
  searchItems, unitCostForProject,
} from './data/project-items.js';
import { SECTORS, FRAMEWORK, SCALE_IDS } from './data/project-framework.js';

test('ids are unique', () => {
  const ids = ITEMS.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('labels are unique', () => {
  const labels = ITEMS.map((i) => i.label.toLowerCase());
  assert.equal(new Set(labels).size, labels.length);
});

test('every item reports under a real framework sector', () => {
  // Otherwise "projects by sector" silently drops it.
  const strays = ITEMS.filter((i) => !SECTORS.includes(i.sector))
    .map((i) => i.id + ' -> ' + i.sector);
  assert.deepEqual(strays, []);
});

test('every item counts in a known unit, or explicitly in none', () => {
  const bad = ITEMS.filter((i) => i.unit !== null && !UNITS.includes(i.unit))
    .map((i) => i.id + ' -> ' + i.unit);
  assert.deepEqual(bad, []);
});

test('ITEMS_BY_SECTOR accounts for every item exactly once', () => {
  const grouped = Object.values(ITEMS_BY_SECTOR).flat();
  assert.equal(grouped.length, ITEMS.length);
  assert.equal(new Set(grouped.map((i) => i.id)).size, ITEMS.length);
});

test('no alias is claimed by two different items', () => {
  // A shared alias makes search arbitrary: whichever item comes first wins.
  const owner = new Map();
  const clashes = [];
  for (const item of ITEMS) {
    for (const alias of item.aliases) {
      const key = alias.toLowerCase();
      if (owner.has(key)) clashes.push(`"${alias}": ${owner.get(key)} and ${item.id}`);
      else owner.set(key, item.id);
    }
  }
  assert.deepEqual(clashes, []);
});

test('an alias never collides with another item\'s label', () => {
  const labels = new Map(ITEMS.map((i) => [i.label.toLowerCase(), i.id]));
  const clashes = [];
  for (const item of ITEMS) {
    for (const alias of item.aliases) {
      const holder = labels.get(alias.toLowerCase());
      if (holder && holder !== item.id) clashes.push(`"${alias}": ${item.id} vs ${holder}`);
    }
  }
  assert.deepEqual(clashes, []);
});

// The point of the whole file. Left column is verbatim from the proposals
// submitted for Akinyele, Ibadan North West, Iwajowa and Old Ifedapo.
const FROM_THE_PROPOSALS = [
  ['Sewing machine', 'sewing_machine'],
  ['Solar Street Light', 'solar_street_light'],
  ['solar light', 'solar_street_light'],
  ['streetlight', 'solar_street_light'],
  ['Borehole', 'borehole'],
  ['Transformer', 'transformer'],
  ['transformer cables', 'transformer_repair'],
  ['Culvert', 'culvert'],
  ['Palliative', 'palliative_food'],
  ['food items', 'palliative_food'],
  ['motorcycle', 'motorcycle'],
  ['okada', 'motorcycle'],
  ['keke', 'tricycle'],
  ['fertilizer', 'fertiliser'],
  ['NPK', 'fertiliser'],
  ['concrete pole', 'electric_pole'],
  ['grading', 'road_grading'],
  ['rubbles', 'road_filling'],
  ['laterite', 'road_filling'],
  ['drainage', 'drainage'],
  ['special needs', 'disability_support'],
  ['grinder', 'grinding_machine'],
];

for (const [written, expected] of FROM_THE_PROPOSALS) {
  test(`a candidate typing "${written}" gets ${expected}`, () => {
    const hit = findItem(written) || searchItems(written, 1)[0];
    assert.ok(hit, `"${written}" matched nothing at all`);
    assert.equal(hit.id, expected);
  });
}

test('search puts the exact match first', () => {
  assert.equal(searchItems('transformer')[0].id, 'transformer');
  assert.equal(searchItems('borehole')[0].id, 'borehole');
});

test('search never offers the catch-all', () => {
  // "Something else" is a deliberate choice at the end of the list, not a
  // suggestion -- offering it as a match would bury the real item.
  assert.equal(searchItems('other').some((i) => i.id === 'other'), false);
  assert.ok(ITEMS_BY_ID.other, 'but it must still exist to be chosen directly');
});

test('fixed project prices calculate totals from quantity', () => {
  assert.equal(unitCostForProject({ item_id: 'solar_street_light' }), 500000);
  assert.equal(estimatedProjectCost({ item_id: 'solar_street_light', quantity: 8 }), 4000000);
  assert.equal(estimatedProjectCost({ project_name: 'Solar-powered boreholes', quantity: 2 }), 16000000);
  assert.equal(estimatedProjectCost({ item_id: 'borehole', quantity: 3 }), 15000000);
  assert.equal(estimatedProjectCost({ item_id: 'transformer', quantity: 2 }), 56000000);
  assert.equal(unitCostForProject({ project_name: 'Borehole repair' }), 1000000);
  assert.equal(estimatedProjectCost({ item_id: 'transformer', quantity: 2, budget: 1200000 }), 1200000);
});

test('an empty search returns the catalogue, not nothing', () => {
  assert.ok(searchItems('', 5).length === 5);
});

test('the framework has no headings bleeding into project names', () => {
  // Three entries were extracted from the .docx with the next heading stuck to
  // them -- "Community project inventoryB. MEDIUM / WARD-LGA PROJECTS" -- and
  // candidates saw that in the dropdown.
  const bad = [];
  for (const [sector, scales] of Object.entries(FRAMEWORK)) {
    for (const scale of SCALE_IDS) {
      for (const name of scales[scale]) {
        if (/[a-z][A-Z]/.test(name.replace(/GIS|WASH|PHC|SME|ICT/g, ''))) {
          bad.push(`${sector} / ${scale}: ${name}`);
        }
      }
    }
  }
  assert.deepEqual(bad, []);
});

test('85 supplied catalogue items have numeric approximate unit prices; custom requests stay unpriced',()=>{
 assert.equal(ITEMS.filter(item=>item.unit_cost!=null).length,85);
 assert.equal(ITEMS_BY_ID.sewing_machine.unit_cost,215000);
 assert.equal(estimatedProjectCost({project_name:'Sewing machine',quantity:4}),860000);
 assert.equal(estimatedProjectCost({item_id:'other',project_name:'Custom community request',quantity:3}),null);
 assert.equal(estimatedProjectCost({item_id:'other',quantity:3,budget:450000}),450000);
 assert.equal(estimatedProjectCost({item_id:'borehole',quantity:2,budget:0}),0);
});
