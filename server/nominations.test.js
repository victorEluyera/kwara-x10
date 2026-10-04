import test from 'node:test';
import assert from 'node:assert/strict';
import { nominationQuota, nominationUnits, nominationSummary, validateNomination } from './nominations.js';
const senator = { id: 1, role: 'candidate', office: 'Senator', scope_type: 'senatorial', scope_value: 'Kwara Central' };
const units = nominationUnits(senator);
const nominee = (unit) => ({ ...unit, status: 'pending' });
test('legislative allocations sum to ten per polling unit', () => {
  assert.equal(nominationQuota('Senator'), 4);
  assert.equal(nominationQuota('House of Representatives'), 3);
  assert.equal(nominationQuota('House of Assembly'), 3);
  assert.equal(nominationQuota('State Assembly'), 3);
});
test('four nominees only complete one polling unit, not the constituency', () => {
  const summary = nominationSummary(senator, Array.from({ length: 4 }, () => nominee(units[0])));
  assert.equal(summary.quota, units.length * 4);
  assert.equal(summary.completed_polling_units, 1);
  assert.equal(summary.complete, false);
  assert.equal(summary.remaining, (units.length - 1) * 4);
});
test('legacy over-allocation cannot mask missing nominees in other units', () => {
  const rows = Array.from({ length: units.length * 4 }, () => nominee(units[0]));
  const summary = nominationSummary(senator, rows);
  assert.equal(summary.complete, false);
  assert.equal(summary.remaining, (units.length - 1) * 4);
});
test('retired approval labels do not exclude registered nominees from allocation', () => {
  const summary = nominationSummary(senator, [{ ...units[0], status: 'rejected' }, { lga: 'Not specified', status: 'pending' }]);
  assert.equal(summary.count, 1);
  assert.equal(summary.unallocated, 1);
  assert.equal(summary.total_count, 2);
  assert.equal(summary.remaining, units.length * 4 - 1);
});

test('unallocated nominees stay recorded separately from valid PU allocations', () => {
  const summary = nominationSummary(senator, [
    { lga: 'Not specified', ward: 'Not specified', polling_unit: 'Not specified', status: 'verified' },
    { ...units[0], polling_unit: 'Unmatched uploaded location', status: 'pending' },
    { ...units[0], status: 'rejected' },
  ]);
  assert.equal(summary.total_count, 3);
  assert.equal(summary.count, 1);
  assert.equal(summary.unallocated, 2);
  assert.equal(summary.remaining, units.length * 4 - 1);
});

test('legacy upload casing and spacing count toward the correct candidate allocation', () => {
  const summary = nominationSummary(senator, [{ ...units[0], lga: units[0].lga.toUpperCase(),
    ward: ' ' + units[0].ward.toLowerCase() + ' ',
    polling_unit: units[0].polling_unit.toLowerCase().replace(/ /g, '  '), status: 'verified' }]);
  assert.equal(summary.total_count, 1);
  assert.equal(summary.count, 1);
  assert.equal(summary.unallocated, 0);
});
test('a unit past its allowance is flagged, not refused', async () => {
  // The register has to reflect who is actually on the ground. A fifth nominee
  // in a unit that allows four is recorded and marked, because a number the
  // campaign can see beats a person left off the books -- or entered under the
  // neighbouring unit to get around the block.
  const tx = { prepare: () => ({ get: async (...args) => ({ n: args[3] === units[0].polling_unit ? 4 : 0 }) }) };
  const full = await validateNomination(tx, senator, units[0]);
  assert.equal(full.over_quota, true);
  assert.equal(full.ok, true);
  assert.equal(full.error, undefined, 'going past the allowance must not be an error');
  assert.match(full.warning, /4 of the 4/);

  const other = units.find(u => u.polling_unit !== units[0].polling_unit);
  assert.equal(await validateNomination(tx, senator, other), null);
});
test('legislative nominees require a real polling unit in the assigned constituency', async () => {
  const tx = { prepare: () => { throw new Error('invalid location must fail before counting'); } };
  assert.equal((await validateNomination(tx, senator, { ...units[0], polling_unit: '' })).status, 400);
  const south = nominationUnits({ ...senator, scope_value: 'Kwara South' })[0];
  assert.equal((await validateNomination(tx, senator, south)).status, 400);
});
test('stakeholders and deputy governor have separate unlimited ward or polling-unit allocations', async () => {
  for (const office of ['Stakeholder', 'Deputy Governor']) {
    const user = { ...senator, office, scope_type: 'state', scope_value: null };
    const summary = nominationSummary(user, Array.from({ length: 50 }, () => nominee(units[0])));
    assert.equal(summary.unlimited, true);
    assert.equal(summary.quota, null);
    assert.equal(summary.count, 50);
    const tx = { prepare: () => { throw new Error('unlimited allocation must not count or cap'); } };
    assert.equal(await validateNomination(tx, user, units[0]), null);
    assert.equal(await validateNomination(tx, user, { ...units[0], polling_unit: 'Not specified' }), null);
  }
});
test('assembly polling units stay within the assigned wards', () => {
  const user = { ...senator, office: 'House of Assembly', scope_type: 'state_const', scope_value: 'Akinyele I' };
  const mine = nominationUnits(user);
  const neighbour = new Set(nominationUnits({ ...user, scope_value: 'Akinyele II' }).map(u => u.ward));
  assert.ok(mine.length > 0);
  assert.ok(mine.every(u => !neighbour.has(u.ward)));
});

test('a complete allocation requires every polling unit to be filled', () => {
  const rows = units.flatMap(u => Array.from({ length: 4 }, () => nominee(u)));
  const summary = nominationSummary(senator, rows);
  assert.equal(summary.complete, true);
  assert.equal(summary.remaining, 0);
});
test('Rep and Assembly fourth nominees are flagged, and reviews exclude the current record', async () => {
  for (const office of ['House of Representatives', 'House of Assembly']) {
    const user = { ...senator, office };
    const tx = { prepare: () => ({ get: async (...args) => {
      assert.equal(args[0], user.id);
      assert.equal(args[4], 123, 'a review must not count the record being reviewed');
      return { n: 3 };
    } }) };
    const verdict = await validateNomination(tx, user, units[0], 123);
    assert.equal(verdict.over_quota, true);
    assert.equal(verdict.error, undefined);
  }
});

test('an invalid location is still a hard refusal', async () => {
  // Only the allowance softened. Somebody else's ward stays out of bounds.
  const tx = { prepare: () => { throw new Error('must fail before counting'); } };
  const verdict = await validateNomination(tx, senator, { ...units[0], polling_unit: '' });
  assert.equal(verdict.status, 400);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.over_quota, undefined);
});

test('the summary counts how many nominees are over the allowance', () => {
  const rows = [
    { ...nominee(units[0]), over_quota: 0 },
    { ...nominee(units[0]), over_quota: 1 },
    { ...nominee(units[0]), over_quota: 1, status: 'rejected' },
  ];
  assert.equal(nominationSummary(senator, rows).over_quota, 2, 'retired approval labels do not hide over-allocation');
});
