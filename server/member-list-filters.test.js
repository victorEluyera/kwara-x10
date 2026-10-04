import test from 'node:test';
import assert from 'node:assert/strict';
import {memberListFilters, memberListOrder, memberDateFilters} from './member-list-filters.js';
test('registration windows use bound timestamps and exclude the end boundary for repeat batches', () => {
  const query = {registered_from:'2026-10-01T08:30:00+01:00',registered_before:'2026-10-02T08:30:00+01:00'};
  const dates = memberDateFilters(query);
  assert.deepEqual(dates.params, ['2026-10-01T07:30:00.000Z','2026-10-02T07:30:00.000Z']);
  assert.match(dates.where[0], />= \?::timestamptz/);
  assert.match(dates.where[1], / < \?::timestamptz/);
  const listed = memberListFilters({id:1,role:'admin'},query);
  const exported = memberExportFilters(query);
  assert.deepEqual(exported.params,dates.params);
  assert.deepEqual(listed.params,dates.params);
  assert.throws(() => memberDateFilters({registered_from:'invalid date'}), /valid registration/);
});
import { memberExportFilters } from './member-issues.js';
test('member list and exports share combined phone, account and VIN completeness filters', () => {
  for (const phone_quality of ['missing', 'incomplete', 'complete']) {
    const query = {phone_quality, account_presence:'missing', vin_presence:'missing'};
    const list = memberListFilters({id:1,role:'admin'}, query);
    const exported = memberExportFilters(query);
    assert.equal(exported.where.length, 3);
    for (const condition of exported.where) assert.ok(list.clause.includes(condition));
    assert.match(list.clause, /m.account_number/);
    assert.match(list.clause, /m.level IN \('mobiliser', 'unit_promoter', 'grassroot'\)/);
  }
  assert.match(memberExportFilters({phone_quality:'incomplete'}).where[0], /NOT.*NULLIF.*NOT.*REGEXP_REPLACE/);
  assert.deepEqual(memberExportFilters({phone_quality:"'; DROP TABLE members"}).where, []);
});
test('member sorting only allows known columns and directions, with stable pagination', () => {
  assert.equal(memberListOrder({sort:'phone', direction:'asc'}), "NULLIF(TRIM(m.phone), '') ASC NULLS LAST, m.id ASC");
  assert.match(memberListOrder({sort:'account',direction:'desc'}), /m.account_number.*DESC NULLS LAST, m.id DESC/);
  assert.equal(memberListOrder({sort:'m.id; DROP TABLE members',direction:'DELETE'}), 'm.created_at DESC NULLS LAST, m.id DESC');
});
test('issues sorting counts contact, bank and voter follow-up items without requiring candidate VINs', () => {
  const order = memberListOrder({sort:'issues'});
  assert.match(order, /m.level IN \('mobiliser', 'unit_promoter', 'grassroot'\)/);
  assert.match(order, /m.polling_unit_resolved/);
  assert.match(order, /m.account_name/);
  assert.match(order, /DESC NULLS LAST, m.id DESC$/);
});
test('candidate nominee filters preserve nested account and member aliases',()=>{
  const result=memberListFilters({id:7,role:'candidate',member_id:42},{mine:'1',level:'mobiliser'});
  assert.match(result.clause,/SELECT downline\.id FROM users downline/);
  assert.match(result.clause,/mine\.id = downline\.member_id/);
  assert.match(result.clause,/mine\.upline_user_id/);
  assert.doesNotMatch(result.clause,/mine\.m\.|downline\.m\./);
  assert.match(result.clause,/m\.level = \?/);
  assert.deepEqual(result.params,[7,42,42,7,'mobiliser',7]);
  assert.equal((result.clause.match(/\?/g)||[]).length,result.params.length);
});
test('shared member filters use bound values and unambiguous outer member columns',()=>{
  const result=memberListFilters({id:1,role:'admin'},{status:'verified',lga:'Akinyele',ward:'Ward 01',vin_verification_status:'verified',polling_unit_presence:'without',q:"O'Neil"});
  assert.match(result.clause,/m\.status = \?/);assert.match(result.clause,/m\.polling_unit_resolved = 0/);
  assert.ok(!result.clause.includes("O'Neil"));
  assert.equal((result.clause.match(/\?/g)||[]).length,result.params.length);
});
