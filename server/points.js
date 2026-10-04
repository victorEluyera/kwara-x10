// Performance scoring, monthly caps and payment eligibility.
//
// Reward principle from the programme document:
//   Recruitment builds the network. Verified activity creates value.
//   Quality and impact earn rewards.
//
// So activation ALONE never pays. The first 10 verified activations are the
// baseline requirement worth zero points; beyond that each verified, active
// verified activity earns bonus points. All earning is capped monthly and
// is released only when the member and their downline have cleared mandatory
// tasks for the period.

import { taskAppliesTo } from './task-scope.js';
import { db, period as currentPeriod, nowISO } from './db.js';

export const NAIRA_PER_POINT = 100;

export const LEVEL_CAPS = {
  mobiliser:   { points: 100, naira: 10000, label: 'Unit Promoter' },
};

// Activity point values (programme document, Mobiliser Points table).
export const ACTIVITY_POINTS = {
  rally: 5,
  canvass: 5,
  survey: 5,
  follow_up: 3,
  issue_report: 10,
  evidence: 5,
  meeting: 10,
  issue_update: 10,
  service: 15,
  training: 5,
};

export const BASELINE_ACTIVATIONS = 10;
export const BONUS_POINTS_PER_EXTRA = 2;

/** Direct downline of a member, restricted to verified rows. */
export async function directDownline(memberId, verifiedOnly = true) {
  const sql = 'SELECT * FROM members WHERE upline_member_id = ?'
    + (verifiedOnly ? " AND status = 'verified'" : '');
  return await db.prepare(sql).all(memberId);
}

export async function downlineCounts(memberId) {
  const row = await db.prepare(
    'SELECT '
    + " COUNT(*) total,"
    + " SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END) verified,"
    + " SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) pending,"
    + " SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) rejected"
    + ' FROM members WHERE upline_member_id = ?'
  ).get(memberId);
  return {
    total: row.total || 0,
    verified: row.verified || 0,
    pending: row.pending || 0,
    rejected: row.rejected || 0,
  };
}

/**
 * Recompute activation bonus for a member in a period and write it to the
 * ledger as a single idempotent row (replaces any earlier activation row).
 */
export async function recomputeActivationPoints(memberId, per = currentPeriod()) {
  const { verified } = await downlineCounts(memberId);
  const extra = Math.max(0, verified - BASELINE_ACTIVATIONS);
  const points = extra * BONUS_POINTS_PER_EXTRA;

  await db.prepare("DELETE FROM points_ledger WHERE member_id = ? AND period = ? AND source = 'activation'")
    .run(memberId, per);

  if (points > 0) {
    await db.prepare(
      'INSERT INTO points_ledger (member_id,user_id,source,source_id,points,period,note,created_at) '
      + "VALUES (?,NULL,'activation',NULL,?,?,?,?)"
    ).run(memberId, points, per,
      verified + ' verified activations (' + extra + ' above the baseline of '
      + BASELINE_ACTIVATIONS + ')', nowISO());
  }
  return { verified, extra, points };
}

/** Raw (uncapped) points earned by a member in a period. */
export async function rawPoints(memberId, per = currentPeriod()) {
  const row = await db.prepare(
    'SELECT COALESCE(SUM(points),0) p FROM points_ledger WHERE member_id = ? AND period = ?'
  ).get(memberId, per);
  return row.p || 0;
}

export async function pointsBreakdown(memberId, per = currentPeriod()) {
  return await db.prepare(
    'SELECT source, COALESCE(SUM(points),0) points, COUNT(*) entries '
    + 'FROM points_ledger WHERE member_id = ? AND period = ? GROUP BY source'
  ).all(memberId, per);
}

/** Mandatory tasks that apply to a member for the period. */
export async function mandatoryTasksFor(member, per = currentPeriod()) {
  const rows = await db.prepare(
    'SELECT * FROM tasks WHERE period = ? AND mandatory = 1 '
    + "AND status = 'open' "
    + "AND (target_level = 'all' OR target_level = ?)"
  ).all(per, member.level);
  return rows.filter((t) => taskAppliesTo(t, member.lga, member.ward));
}

export async function taskCompletion(member, per = currentPeriod()) {
  const tasks = await mandatoryTasksFor(member, per);
  if (!tasks.length) return { required: 0, approved: 0, complete: true, outstanding: [] };

  const ids = tasks.map((t) => t.id);
  const placeholders = ids.map(() => '?').join(',');
  const done = (await db.prepare(
    'SELECT task_id FROM submissions WHERE member_id = ? '
    + "AND status = 'approved' AND task_id IN (" + placeholders + ')'
  ).all(member.id, ...ids)).map((r) => r.task_id);

  const doneSet = new Set(done);
  const outstanding = tasks.filter((t) => !doneSet.has(t.id))
    .map((t) => ({ id: t.id, title: t.title, due_at: t.due_at }));

  return {
    required: tasks.length,
    approved: done.length,
    complete: outstanding.length === 0,
    outstanding,
  };
}

/**
 * Payment eligibility for a member in a period.
 *
 * Three gates, all of which must pass:
 *   1. Baseline  - at least 10 verified direct activations.
 *   2. Own work  - every mandatory task for the period approved.
 *   3. Downline  - every verified direct downline member has also cleared
 *                  their mandatory tasks.
 */
export async function eligibility(member, per = currentPeriod()) {
  const counts = await downlineCounts(member.id);
  const own = await taskCompletion(member, per);

  const downline = await directDownline(member.id, true);
  const laggards = [];
  for (const d of downline) {
    const c = await taskCompletion(d, per);
    if (!c.complete) {
      laggards.push({
        id: d.id, code: d.code,
        name: d.first_name + ' ' + d.last_name,
        outstanding: c.outstanding.length,
      });
    }
  }

  const gates = {
    baseline: {
      pass: counts.verified >= BASELINE_ACTIVATIONS,
      detail: counts.verified + ' of ' + BASELINE_ACTIVATIONS + ' verified activations',
    },
    own_tasks: {
      pass: own.complete,
      detail: own.approved + ' of ' + own.required + ' mandatory tasks approved',
    },
    downline_tasks: {
      pass: laggards.length === 0,
      detail: laggards.length === 0
        ? 'All downline members cleared their tasks'
        : laggards.length + ' downline member(s) have outstanding tasks',
      laggards,
    },
  };

  const cap = LEVEL_CAPS[member.level] || LEVEL_CAPS.mobiliser;
  const raw = await rawPoints(member.id, per);
  const capped = Math.min(raw, cap.points);
  const eligible = gates.baseline.pass && gates.own_tasks.pass && gates.downline_tasks.pass;

  return {
    period: per,
    level: member.level,
    gates,
    eligible,
    raw_points: raw,
    capped_points: capped,
    capped_by_ceiling: raw > cap.points,
    point_cap: cap.points,
    amount_naira: eligible ? capped * NAIRA_PER_POINT : 0,
    potential_naira: capped * NAIRA_PER_POINT,
    cash_cap: cap.naira,
    own_tasks: own,
    downline: counts,
  };
}

/** Payroll run across a set of members. */
export async function payroll(members, per = currentPeriod()) {
  const rows = [];
  for (const m of members) {
    const e = await eligibility(m, per);
    rows.push({
      member_id: m.id,
      code: m.code,
      name: m.first_name + ' ' + m.last_name,
      level: m.level,
      lga: m.lga,
      ward: m.ward,
      bank_name: m.bank_name,
      account_number: m.account_number,
      account_name: m.account_name,
      verified_downline: e.downline.verified,
      raw_points: e.raw_points,
      capped_points: e.capped_points,
      eligible: e.eligible,
      blocked_by: Object.entries(e.gates)
        .filter(([, g]) => !g.pass).map(([k]) => k),
      amount_naira: e.amount_naira,
    });
  }

  const payable = rows.filter((r) => r.eligible);
  return {
    period: per,
    rows,
    summary: {
      members: rows.length,
      eligible: payable.length,
      blocked: rows.length - payable.length,
      total_points: payable.reduce((a, r) => a + r.capped_points, 0),
      total_naira: payable.reduce((a, r) => a + r.amount_naira, 0),
    },
  };
}

/** Award points for an approved task submission. */
export async function awardTaskPoints(submission, task, per = currentPeriod()) {
  const points = task.points || ACTIVITY_POINTS[task.type] || 5;
  await db.prepare(
    "DELETE FROM points_ledger WHERE source = 'task' AND source_id = ?"
  ).run(submission.id);
  await db.prepare(
    'INSERT INTO points_ledger (member_id,user_id,source,source_id,points,period,note,created_at) '
    + "VALUES (?,?,'task',?,?,?,?,?)"
  ).run(submission.member_id, submission.user_id || null, submission.id,
        points, per, task.title, nowISO());
  return points;
}
