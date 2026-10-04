// The project picklists are generated from the campaign's framework document.
// If the generator ever mis-parses that document, the picker quietly loses
// options rather than failing, so the shape is asserted here.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FRAMEWORK, SECTORS, SCALES, SCALE_IDS, PROJECT_STATUSES, STATUS_IDS,
  projectsFor, isFrameworkProject,
} from './data/project-framework.js';

test('the framework has 20 sectors at 3 scales with 6 projects each', () => {
  assert.equal(SECTORS.length, 20);
  assert.equal(SCALE_IDS.length, 3);
  const wrong = [];
  for (const sector of SECTORS) {
    for (const scale of SCALE_IDS) {
      const n = FRAMEWORK[sector]?.[scale]?.length;
      if (n !== 6) wrong.push(`${sector} / ${scale}: ${n}`);
    }
  }
  assert.deepEqual(wrong, [], 'every sector needs six projects at every scale');
});

test('360 distinct project options in total', () => {
  const all = SECTORS.flatMap((s) => SCALE_IDS.map((sc) => FRAMEWORK[s][sc]).flat());
  assert.equal(all.length, 360);
});

test('scale changes what the project actually is', () => {
  // This is why scale is chosen first rather than tacked on as a label.
  const wash = 'Water, Sanitation & Hygiene (WASH)';
  const small = projectsFor(wash, 'small');
  const large = projectsFor(wash, 'large');
  assert.notDeepEqual(small, large);
  assert.ok(small.some((p) => /repair/i.test(p)), 'small WASH is repairs');
  assert.ok(large.some((p) => /multi-community|network/i.test(p)), 'large WASH is networks');
});

test('no project text was mangled by the document parser', () => {
  // The document runs items together as "boreholes2. Handwashing"; a bad
  // split leaves stray numbering or an empty entry behind.
  const bad = [];
  for (const sector of SECTORS) {
    for (const scale of SCALE_IDS) {
      for (const p of FRAMEWORK[sector][scale]) {
        if (!p || p.length < 3) bad.push(`${sector}/${scale}: empty`);
        if (/^\d+\./.test(p)) bad.push(`${sector}/${scale}: "${p}" keeps its numbering`);
        if (/\d+\.\s/.test(p)) bad.push(`${sector}/${scale}: "${p}" holds two items`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test('projectsFor is safe with rubbish input', () => {
  assert.deepEqual(projectsFor('Nonsense', 'small'), []);
  assert.deepEqual(projectsFor(SECTORS[0], 'enormous'), []);
});

test('a custom project is recognised as not being from the framework', () => {
  const sector = SECTORS[0];
  const real = projectsFor(sector, 'small')[0];
  assert.ok(isFrameworkProject(sector, 'small', real));
  assert.ok(!isFrameworkProject(sector, 'small', 'A thing I made up'));
});

test('statuses start at promised, because a project is a promise first', () => {
  assert.equal(PROJECT_STATUSES[0].id, 'promised');
  assert.deepEqual(STATUS_IDS, ['promised', 'ongoing', 'completed']);
});

test('every scale carries the definition that tells them which to pick', () => {
  for (const s of SCALES) {
    assert.ok(s.label, 'scale needs a label');
    assert.ok(s.blurb && s.blurb.length > 20, s.id + ' needs its framework definition');
  }
});
