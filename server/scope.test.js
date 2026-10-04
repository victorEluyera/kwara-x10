// memberScope decides which member rows a login can see. A mistake here is a
// data leak between candidates, not a cosmetic bug, so it is tested directly.

import test from 'node:test';
import assert from 'node:assert/strict';
import { locationInScope, memberScope, scopedLgas, scopedWards, isGovernor, coverageOf, scopeTargets } from './scope.js';
import { WARDS, SENATORIAL, STATE_CONST, POLLING_UNITS } from './data/geo.js';
import { wardsInStateConstituency } from './data/ward-constituencies.js';

const candidate = (scope_type, scope_value) =>
  ({ id: 7, role: 'candidate', scope_type, scope_value, member_id: null });

// Geography scoping belongs to coordinators now -- a promotion an admin grants
// deliberately -- rather than to every candidate holding a constituency.
const coordinator = (scope_type, scope_value) =>
  ({ id: 9, role: 'unit_promoter', member_id: 42, is_coordinator: 1, scope_type, scope_value });

test('an admin sees everyone', () => {
  const s = memberScope({ id: 1, role: 'admin', scope_type: 'state' });
  assert.equal(s.sql, '1=1');
  assert.deepEqual(s.params, []);
});

test('a plain unit promoter sees only people they added, never by geography', () => {
  const s = memberScope({ id: 9, role: 'unit_promoter', member_id: 42, is_coordinator: 0 });
  assert.match(s.sql, /upline_user_id/);
  assert.doesNotMatch(s.sql, /\blga\b/, 'must not widen to a whole LGA');
  assert.deepEqual(s.params, [42, 9, 42]);
});

test('a coordinator is scoped by geography, not ownership', () => {
  const s = memberScope({ id: 9, role: 'unit_promoter', member_id: 42,
                          is_coordinator: 1, scope_type: 'lga', scope_value: 'Akinyele' });
  assert.equal(s.sql, 'lga = ?');
  assert.deepEqual(s.params, ['Akinyele']);
});

test('a coordinator over a senatorial district is scoped to its LGAs', () => {
  const s = memberScope(coordinator('senatorial', 'Kwara Central'));
  const expected = SENATORIAL['Kwara Central'];
  assert.equal(s.params.length, expected.length);
  assert.deepEqual([...s.params].sort(), [...expected].sort());
  // The senatorial correction: Ibadan North belongs to Kwara South, not Central.
  assert.ok(!s.params.includes('Ibadan North'), 'Ibadan North is in Kwara South');
  assert.ok(s.params.includes('Oluyole'), 'Oluyole is in Kwara Central');
});

test('a coordinator over a state constituency is scoped by ward, not by LGA', () => {
  const s = memberScope(coordinator('state_const', 'Akinyele I'));
  assert.match(s.sql, /\(lga, ward\) IN/);
  assert.equal(s.params.length, 12, '6 wards, two params each');
});

test('coordinators for Akinyele I and Akinyele II do not overlap', () => {
  const a = memberScope(coordinator('state_const', 'Akinyele I'));
  const b = memberScope(coordinator('state_const', 'Akinyele II'));
  const wardsOf = (s) => s.params.filter((_, i) => i % 2 === 1);
  const overlap = wardsOf(a).filter((w) => wardsOf(b).includes(w));
  assert.deepEqual(overlap, [], 'the two halves of Akinyele must not overlap');
  assert.equal(wardsOf(a).length, 6);
  assert.equal(wardsOf(b).length, 6);
});

test('every state constituency produces a usable coordinator scope', () => {
  const broken = [];
  for (const name of Object.keys(STATE_CONST)) {
    const s = memberScope(coordinator('state_const', name));
    if (s.sql === '1=0' || !s.params.length) broken.push(name);
  }
  assert.deepEqual(broken, [], 'these candidates would see nothing');
});

test('an unknown constituency matches nothing rather than everything', () => {
  // Failing open here would hand a stranger the whole state.
  const s = memberScope(coordinator('state_const', 'Not A Real Constituency'));
  assert.equal(s.sql, '1=0');
  const f = memberScope(coordinator('federal', 'Nowhere'));
  assert.equal(f.sql, '1=0');
});

test('a coordinator with a malformed polling-unit scope matches nothing', () => {
  const s = memberScope({ id: 3, role: 'unit_promoter', member_id: 5, is_coordinator: 1,
                          scope_type: 'polling_unit', scope_value: 'incomplete' });
  assert.equal(s.sql, '1=0');
});

/* ------------------- a candidate sees their own work only ------------------- */

test('a candidate is scoped by what they built, not by their ward', () => {
  // Wards are shared: a Senator, a Rep and an Assembly candidate all cover the
  // same ground. Scoping by geography showed each of them the others' people.
  const s = memberScope(candidate('state_const', 'Akinyele I'));
  assert.match(s.sql, /upline_user_id/);
  assert.doesNotMatch(s.sql, /\(lga, ward\) IN/, 'a candidate must not see a whole ward');
  assert.ok(s.params.includes(7), 'scoped to this candidate');
});

test('the scope reaches the people their nominees registered', () => {
  // A candidate nominates Unit Promoters; those promoters register everyone
  // else. "What I built" has to mean the tree, not just the first level.
  const s = memberScope(candidate('senatorial', 'Kwara Central'));
  assert.match(s.sql, /SELECT downline\.id FROM users downline/);
  assert.match(s.sql, /mine\.upline_user_id = \?/);
});

test('two candidates over the same ward produce different scopes', () => {
  const senator = { ...candidate('senatorial', 'Kwara Central'), id: 7 };
  const assembly = { ...candidate('state_const', 'Akinyele I'), id: 8 };
  const a = memberScope(senator);
  const b = memberScope(assembly);
  assert.equal(a.sql, b.sql, 'the shape is the same');
  assert.notDeepEqual(a.params, b.params, 'but they are anchored to different people');
  assert.ok(!b.params.includes(7), "the assembly candidate is not scoped to the senator's id");
});

test('the Governor still sees the whole state', () => {
  const gov = { ...candidate('state', null), office: 'Governor' };
  assert.equal(isGovernor(gov), true);
  assert.equal(memberScope(gov).sql, '1=1');
});

test('a non-Governor candidate with a statewide scope is still limited', () => {
  // Failing open here would hand one candidate every registration in Kwara.
  const wide = { ...candidate('state', null), office: 'Senator' };
  assert.equal(isGovernor(wide), false);
  assert.notEqual(memberScope(wide).sql, '1=1');
});

/* ----------------------------- the alias option ----------------------------- */

test('every column is qualified when an alias is given', () => {
  // The old approach patched the finished SQL with a regex, which cannot tell
  // the subquery's columns from the outer query's.
  for (const user of [candidate('state_const', 'Akinyele I'),
    coordinator('state_const', 'Akinyele I'),
    coordinator('lga', 'Akinyele'),
    coordinator('senatorial', 'Kwara Central'),
    { id: 9, role: 'unit_promoter', member_id: 42, is_coordinator: 0 }]) {
    const plain = memberScope(user).sql;
    const aliased = memberScope(user, { alias: 'm' }).sql;
    for (const column of ['lga', 'ward', 'polling_unit', 'upline_user_id', 'upline_member_id']) {
      if (!new RegExp('(^|[^.\\w])' + column).test(plain)) continue;
      assert.ok(!new RegExp('(^|[^.\\w.])' + column + '\\b').test(
        aliased.replace(/m\.\w+/g, '')), column + ' was left unqualified for ' + user.role);
    }
  }
});

test('aliasing leaves the subquery\'s own tables alone', () => {
  const aliased = memberScope(candidate('state_const', 'Akinyele I'), { alias: 'm' }).sql;
  assert.match(aliased, /FROM users downline/, 'the subquery must keep its own tables');
  assert.match(aliased, /mine\.upline_user_id/, "the subquery's own alias must survive");
  assert.doesNotMatch(aliased, /m\.downline|m\.mine/, 'the alias must not leak into the subquery');
});

test('the params line up with the placeholders', () => {
  for (const user of [candidate('state_const', 'Akinyele I'),
    coordinator('lga', 'Akinyele'),
    coordinator('state_const', 'Akinyele I'),
    { id: 9, role: 'unit_promoter', member_id: 42, is_coordinator: 0 }]) {
    const s = memberScope(user);
    assert.equal((s.sql.match(/\?/g) || []).length, s.params.length,
      'placeholder count differs from params for ' + user.role);
  }
});

test('scopedWards narrows a split LGA but leaves whole LGAs alone', () => {
  const split = scopedWards(candidate('state_const', 'Akinyele I'), 'Akinyele');
  assert.equal(split.length, 6, 'only this half of Akinyele');
  assert.equal(WARDS.Akinyele.length, 12, 'the LGA itself still has twelve');

  const whole = scopedWards(candidate('state_const', 'Afijio'), 'Afijio');
  assert.deepEqual(whole.sort(), [...WARDS.Afijio].sort(), 'unsplit LGA is unchanged');

  const senator = scopedWards(candidate('senatorial', 'Kwara Central'), 'Akinyele');
  assert.equal(senator.length, 12, 'a senator sees the whole LGA');
});

test('scopedLgas gives a state assembly candidate their own LGAs', () => {
  assert.deepEqual(scopedLgas(candidate('state_const', 'Irepo/Olorunsogo')).sort(),
    ['Irepo', 'Olorunsogo']);
  assert.deepEqual(scopedLgas(candidate('state_const', 'Akinyele II')), ['Akinyele']);
});

test('a state assembly candidate can register only in their own constituency wards', () => {
  const first = candidate('state_const', 'Akinyele I');
  assert.equal(locationInScope(first, { lga: 'Akinyele', ward: 'IKEREKU' }), true);
  assert.equal(locationInScope(first, { lga: 'Akinyele', ward: 'IROKO' }), false);
  assert.equal(locationInScope(first, { lga: 'Atiba', ward: 'AREMO' }), false);
});

test('the ward params really are that constituency\'s wards', () => {
  const s = memberScope(coordinator('state_const', 'Saki/Atisbo'));
  const expected = wardsInStateConstituency('Saki/Atisbo');
  const pairs = [];
  for (let i = 0; i < s.params.length; i += 2) pairs.push(s.params[i] + '|' + s.params[i + 1]);
  assert.deepEqual(pairs.sort(), expected.map((w) => w.lga + '|' + w.ward).sort());
});

test('candidate coverage excludes recognised wards and units outside the constituency',()=>{
  const user=candidate('state_const','Akinyele I');
  const inside=scopedWards(user,'Akinyele')[0];
  const outside=WARDS.Akinyele.find(w=>!scopedWards(user,'Akinyele').includes(w));
  const locations=[inside,outside].map(ward=>({lga:'Akinyele',ward,polling_unit:POLLING_UNITS.Akinyele[ward][0],promoters:10}));
  const coverage=coverageOf(locations,scopeTargets(user),user);
  assert.equal(coverage.wards,1); assert.equal(coverage.units,1);
  assert.equal(coverage.wards_remaining,scopeTargets(user).wards-1);
});
