import test from 'node:test';
import assert from 'node:assert/strict';
import { canTarget, taskAppliesTo, userArea, areasOverlap, taskArea } from './task-scope.js';

const senator = { role: 'candidate', scope_type: 'senatorial', scope_value: 'Kwara North' };
const assembly = { role: 'candidate', scope_type: 'state_const', scope_value: 'Akinyele I' };
const admin = { role: 'admin', scope_type: 'state' };

test('candidates can only target inside their jurisdiction', () => {
  assert.equal(canTarget(senator, 'senatorial', 'Kwara North'), true);
  assert.equal(canTarget(senator, 'lga', 'Iseyin'), true);
  assert.equal(canTarget(senator, 'lga', 'Egbeda'), false);
  assert.equal(canTarget(senator, 'state', null), false);
  assert.equal(canTarget(senator, 'senatorial', 'Kwara South'), false);
  assert.equal(canTarget(assembly, 'ward', 'Akinyele|IKEREKU'), true);
  assert.equal(canTarget(assembly, 'ward', 'Akinyele|IROKO'), false); // Akinyele II
  assert.equal(canTarget(assembly, 'lga', 'Akinyele'), false); // half of it is not theirs
  assert.equal(canTarget(admin, 'state', null), true);
});

test('constituency tasks reach members in the constituency only', () => {
  const t = { target_scope_type: 'state_const', target_scope_value: 'Akinyele I' };
  assert.equal(taskAppliesTo(t, 'Akinyele', 'IKEREKU'), true);
  assert.equal(taskAppliesTo(t, 'Akinyele', 'IROKO'), false);
  assert.equal(taskAppliesTo({ target_scope_type: 'ward', target_scope_value: 'IKEREKU' },
    'Akinyele', 'IKEREKU'), true);
  assert.equal(taskAppliesTo({ target_scope_type: 'state' }, 'Egbeda', 'X'), true);
});

test('field users see tasks covering their ward', () => {
  const field = userArea({ role: 'grassroot', scope_type: 'polling_unit', scope_value: 'Akinyele|IKEREKU|Unit 001' });
  assert.equal(areasOverlap(taskArea('state_const', 'Akinyele I'), field), true);
  assert.equal(areasOverlap(taskArea('state_const', 'Akinyele II'), field), false);
  assert.equal(areasOverlap(taskArea('senatorial', 'Kwara Central'), field), true);
});
