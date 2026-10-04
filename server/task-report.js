import { areasOverlap, taskArea } from './task-scope.js';

// Reuse the member visibility predicate without rewriting SQL column names.
// `area` (from task-scope.js userArea) replaces the SQL area match: it also
// understands constituency-wide tasks set by candidates. Without it the older
// lgas/ward match applies.
export async function taskReport(db, { scope, period, isAdmin, lgas = [], ward = null, area = null }) {
  const areaParams = [...lgas];
  const lgaMatch = lgas.length ? `t.target_scope_value IN (${lgas.map(() => '?').join(',')})` : '0';
  const visibility = isAdmin || area ? '1=1' : `(
    t.target_scope_type = 'state'
    OR (t.target_scope_type = 'lga' AND ${lgaMatch})
    OR (t.target_scope_type = 'ward' AND ${ward ? 't.target_scope_value = ?' : `EXISTS (
      SELECT 1 FROM visible_members m WHERE m.ward = t.target_scope_value)`})
  )`;
  if (ward && !area) areaParams.push(ward);
  const rows = await db.prepare(`WITH visible_members AS (
      SELECT * FROM members WHERE (${scope.sql})
    ), counts AS (
      SELECT s.task_id, COUNT(*) submissions,
        SUM(CASE WHEN s.status = 'approved' THEN 1 ELSE 0 END) approved,
        SUM(CASE WHEN s.status = 'pending' THEN 1 ELSE 0 END) pending,
        SUM(CASE WHEN s.status = 'rejected' THEN 1 ELSE 0 END) rejected,
        MAX(s.created_at) latest_submission
      FROM submissions s
      WHERE ${isAdmin ? '1=1' : 's.member_id IN (SELECT id FROM visible_members)'}
      GROUP BY s.task_id
    ) SELECT t.*, COALESCE(c.submissions,0) submissions,
      COALESCE(c.approved,0) approved, COALESCE(c.pending,0) pending,
      COALESCE(c.rejected,0) rejected, c.latest_submission
    FROM tasks t LEFT JOIN counts c ON c.task_id = t.id
    WHERE t.period = ? AND ${visibility}
    ORDER BY t.created_at DESC, t.id DESC`).all(...scope.params, period, ...(isAdmin || area ? [] : areaParams));
  const visible = isAdmin || !area ? rows
    : rows.filter((t) => areasOverlap(taskArea(t.target_scope_type, t.target_scope_value), area));
  return visible.map((task) => {
    let questions = [];
    try { questions = JSON.parse(task.questions_json || '[]'); } catch { /* Old malformed questionnaire. */ }
    return { ...task, questions: Array.isArray(questions) ? questions : [] };
  });
}
