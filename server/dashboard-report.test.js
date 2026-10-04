import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { dashboardReport } from './dashboard-report.js';

test('administrative reports keep jurisdiction boundaries and include all records for admin', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE members (status TEXT, created_at TEXT, phone TEXT, lga TEXT,
      ward TEXT, polling_unit TEXT, bank_name TEXT, account_number TEXT, account_name TEXT);
      INSERT INTO members VALUES
      ('pending','2026-09-01T00:00:00.000Z','','A','Ward 1','1','','',''),
      ('verified','2026-09-15T00:00:00.000Z','123','A','Ward 1','1','Bank','123','Name'),
      ('flagged','2026-08-01T00:00:00.000Z','456','B','','','Bank','456','Other');`);
    const now = new Date('2026-09-16T00:00:00.000Z');
    const local = await dashboardReport(db, { sql: 'lga = ?', params: ['A'] }, now);
    assert.equal(local.total, 2);
    assert.equal(local.overdue_reviews, 1);
    assert.equal(local.missing_location, 0);
    assert.equal(local.incomplete_payment, 1);
    assert.equal(local.statuses.some((s) => s.status === 'flagged'), false);
    const admin = await dashboardReport(db, { sql: '1=1', params: [] }, now);
    assert.equal(admin.total, 3);
    assert.equal(admin.overdue_reviews, 2);
    assert.equal(admin.missing_location, 1);
    const empty = await dashboardReport(db, { sql: 'lga = ?', params: ['unknown'] }, now);
    assert.equal(empty.total, 0);
    assert.equal(empty.overdue_reviews, 0);
    assert.equal(empty.oldest_review, null);
    assert.deepEqual(empty.statuses, []);
  } finally { db.close(); }
});
