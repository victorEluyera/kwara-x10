import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { taskReport } from './task-report.js';

test('survey counts respect jurisdiction, month, empty surveys and administrator access', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE members (id INTEGER, lga TEXT, ward TEXT);
      CREATE TABLE tasks (id INTEGER, type TEXT, target_scope_type TEXT, target_scope_value TEXT,
        period TEXT, created_at TEXT, questions_json TEXT);
      CREATE TABLE submissions (task_id INTEGER, member_id INTEGER, status TEXT, created_at TEXT);
      INSERT INTO members VALUES (1,'A','A1'),(2,'B','B1');
      INSERT INTO tasks VALUES
        (1,'survey','state',NULL,'2026-09','2026-09-01','[]'),
        (2,'survey','lga','B','2026-09','2026-09-01','[]'),
        (3,'survey','lga','A','2026-09','2026-09-01','invalid'),
        (4,'survey','state',NULL,'2026-08','2026-08-01','[]');
      INSERT INTO submissions VALUES
        (1,1,'pending','2026-09-02'),(1,2,'approved','2026-09-03'),
        (2,2,'rejected','2026-09-03'),(4,1,'approved','2026-08-03');`);
    const candidate = await taskReport(db, { scope: { sql: 'lga = ?', params: ['A'] },
      period: '2026-09', isAdmin: false, lgas: ['A'] });
    assert.deepEqual(candidate.map((r) => r.id).sort(), [1,3]);
    const local = candidate.find((r) => r.id === 1);
    assert.equal(local.submissions, 1);
    assert.equal(local.pending, 1);
    assert.equal(local.approved, 0);
    assert.equal(local.latest_submission, '2026-09-02');
    const empty = candidate.find((r) => r.id === 3);
    assert.equal(empty.submissions, 0);
    assert.deepEqual(empty.questions, []);
    for (const role of ['admin', 'superadmin']) {
      const rows = await taskReport(db, { scope: { sql: '1=1', params: [] },
        period: '2026-09', isAdmin: true, lgas: ['A','B'] });
      assert.equal(rows.length, 3, role);
      assert.equal(rows.find((r) => r.id === 1).submissions, 2, role);
      assert.equal(rows.find((r) => r.id === 2).rejected, 1, role);
    }
    const prior = await taskReport(db, { scope: { sql: 'lga = ?', params: ['A'] },
      period: '2026-08', isAdmin: false, lgas: ['A'] });
    assert.equal(prior.length, 1);
    assert.equal(prior[0].id, 4);
  } finally { db.close(); }
});
