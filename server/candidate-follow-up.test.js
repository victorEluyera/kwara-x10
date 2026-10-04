import {pdpCount,candidatePdpCount} from './pdp-counts.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateFollowUp } from './candidate-follow-up.js';
import { nominationUnits } from './nominations.js';

test('follow-up reports include candidate contact, target, coverage and unit gaps without voter identities', () => {
  const c = { id: 9, role: 'candidate', full_name: 'Test Candidate', username: 'test', phone: '123', office: 'House of Assembly', scope_type: 'lga', scope_value: 'Akinyele' };
  const unit = nominationUnits(c)[0];
  const members = [{ ...unit, level: 'mobiliser', upline_user_id: 9 }, { ...unit, level: 'grassroot', upline_user_id: 10 }];
  const r = candidateFollowUp(c, members, [], [{ ...unit, voters: 250 }], '2026-09-30T12:00:00Z');
  assert.equal(r.summary.phone, '123');
  assert.equal(r.summary.nominees_achieved, 1);
  assert.equal(r.summary.no_of_pdp, candidatePdpCount(c));
  assert.equal(r.summary.polling_units_covered, 1);
  assert.equal(r.summary.polling_units_remaining, r.summary.total_polling_units - 1);
  assert.equal(r.summary.nominees_target, r.units.length * 3);
  assert.equal(r.units[0].unit_nominees_remaining, 2);
  assert.equal(r.units[0].unit_no_of_voters, 250);
  assert.equal(r.units[1].coverage, 'Remaining');
  assert.equal(r.units[1].unit_no_of_pdp, pdpCount(r.units[1]));
  assert.ok(!JSON.stringify(r).includes('pvc_no'));
  const summaryOnly = candidateFollowUp(c, members, [], [{ ...unit, voters: 250 }], '2026-09-30T12:00:00Z', true);
  assert.deepEqual(summaryOnly.summary, r.summary);
  assert.equal(summaryOnly.units, undefined);
});
