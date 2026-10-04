// Read-only intelligence API for external consumers (e.g. the Sigar Vote
// integration). Deliberately its own file: this is the one surface in the
// app that hands real people's names, locations and survey answers to a
// system outside this one, so it gets its own auth scheme (API key, not the
// internal JWT), its own rate limit, and is easy to audit or shut off
// without touching anything else.
//
// Field scoping is intentional: name/level/status/location/GPS for
// registrations, and question/answer/location for surveys -- no phone, NIN,
// PVC or bank details leave through this API. Those weren't asked for, and
// this app already treats them as the most sensitive fields on file.

import express from 'express';
import crypto from 'node:crypto';
import { db, nowISO } from './db.js';
import { SENATORIAL, FEDERAL, STATE_CONST } from './data/geo.js';
import { wardsInStateConstituency } from './data/ward-constituencies.js';
import { registerSigarRoutes } from './external-sigar.js';

export const externalRouter = express.Router();

// Express 4 does not catch a rejected promise from an async handler: without
// this, one database hiccup leaves the caller hanging until it times out. The
// app-level error handler in index.js turns next(err) into a clean 500.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// A malformed stored JSON value must not take down a whole page of results.
const parseJson = (text, fallback) => {
  try { return text ? JSON.parse(text) : fallback; } catch { return fallback; }
};

/* -------------------------------- auth ----------------------------------- */

export const hashApiKey = (key) => crypto.createHash('sha256').update(key).digest('hex');

export function generateApiKey() {
  const secret = crypto.randomBytes(32).toString('base64url');
  const key = 'kwarax10_live_' + secret;
  return { key, prefix: key.slice(0, 20), hash: hashApiKey(key) };
}

// Small in-memory limiter, per key: 120 requests/minute is generous for a
// reporting integration polling on a schedule, tight enough to stop a
// misconfigured client from hammering the database.
const buckets = new Map();
function rateLimited(keyId) {
  const now = Date.now();
  const windowMs = 60_000;
  const limit = 120;
  const entry = buckets.get(keyId);
  if (!entry || now > entry.resetAt) {
    buckets.set(keyId, { count: 1, resetAt: now + windowMs });
    return false;
  }
  entry.count++;
  return entry.count > limit;
}

async function authenticateApiKey(req, res, next) {
  const header = req.headers['x-api-key']
    || (req.headers.authorization || '').replace(/^ApiKey\s+/i, '').trim();
  if (!header) {
    return res.status(401).json({ error: 'Missing API key. Send it as an X-API-Key header.' });
  }
  const row = await db.prepare('SELECT * FROM api_keys WHERE key_hash = ?').get(hashApiKey(header));
  if (!row || row.revoked_at) {
    return res.status(401).json({ error: 'Invalid or revoked API key.' });
  }
  if (rateLimited(row.id)) {
    return res.status(429).json({ error: 'Rate limit exceeded -- max 120 requests per minute.' });
  }
  db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(nowISO(), row.id).catch(() => {});
  req.apiKey = row;
  next();
}

externalRouter.use(wrap(authenticateApiKey));

function page(req, defLimit = 200, maxLimit = 1000) {
  const limit = Math.min(maxLimit, Math.max(1, Number(req.query.limit) || defLimit));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  return { limit, offset };
}

/* ------------------------------- summary ---------------------------------- */

externalRouter.get('/summary', wrap(async (_req, res) => {
  const totals = await db.prepare(
    "SELECT COUNT(*) registered, SUM(CASE WHEN status='verified' THEN 1 ELSE 0 END) verified, "
    + "SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending, "
    + "SUM(CASE WHEN status='flagged' THEN 1 ELSE 0 END) flagged, "
    + "SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) rejected, "
    + "SUM(CASE WHEN level='mobiliser' THEN 1 ELSE 0 END) unit_promoters, "
    + "SUM(CASE WHEN level='grassroot' THEN 1 ELSE 0 END) grassroots "
    + 'FROM members'
  ).get();
  const surveys = await db.prepare(
    'SELECT COUNT(DISTINCT task_id) surveys, COUNT(*) responses FROM submissions '
    + 'WHERE answers_json IS NOT NULL'
  ).get();
  const coverage = await db.prepare(
    // Ward and polling-unit names repeat across the state ("WARD I", "Unit
    // 001"), so they are only distinct together with what contains them.
    "SELECT COUNT(DISTINCT lga) lgas, COUNT(DISTINCT lga || '|' || ward) wards, "
    + "COUNT(DISTINCT lga || '|' || ward || '|' || polling_unit) polling_units FROM members"
  ).get();

  res.json({
    generated_at: nowISO(),
    totals: {
      registered: totals.registered || 0,
      verified: totals.verified || 0,
      pending: totals.pending || 0,
      flagged: totals.flagged || 0,
      rejected: totals.rejected || 0,
      unit_promoters: totals.unit_promoters || 0,
      grassroots: totals.grassroots || 0,
    },
    coverage,
    surveys: { count: surveys.surveys || 0, responses: surveys.responses || 0 },
  });
}));

/* ---------------------------- registrations -------------------------------- */

/**
 * Every registered person: who, what level, where (LGA/ward/polling unit),
 * and their GPS location at registration. No phone, NIN, PVC or bank data.
 */
externalRouter.get('/registrations', wrap(async (req, res) => {
  const { limit, offset } = page(req);
  const where = ['1=1'];
  const params = [];
  if (req.query.lga) { where.push('lga = ?'); params.push(req.query.lga); }
  if (req.query.ward) { where.push('ward = ?'); params.push(req.query.ward); }
  if (req.query.polling_unit) { where.push('polling_unit = ?'); params.push(req.query.polling_unit); }
  if (req.query.level) { where.push('level = ?'); params.push(req.query.level); }
  if (req.query.status) { where.push('status = ?'); params.push(req.query.status); }
  if (req.query.since) { where.push('created_at >= ?'); params.push(req.query.since); }
  const clause = where.join(' AND ');

  const total = (await db.prepare('SELECT COUNT(*) n FROM members WHERE ' + clause).get(...params)).n;
  const rows = await db.prepare(
    'SELECT id, code, first_name, last_name, level, status, lga, ward, polling_unit, '
    + 'lat, lng, accuracy, created_at FROM members WHERE ' + clause
    + ' ORDER BY id ASC LIMIT ? OFFSET ?'
  ).all(...params, limit, offset);

  res.json({
    total, limit, offset,
    next_offset: offset + rows.length < total ? offset + rows.length : null,
    rows: rows.map((r) => ({
      id: r.id, code: r.code,
      name: r.first_name + ' ' + r.last_name,
      level: r.level, status: r.status,
      lga: r.lga, ward: r.ward, polling_unit: r.polling_unit,
      location: r.lat == null ? null : { lat: r.lat, lng: r.lng, accuracy: r.accuracy },
      registered_at: r.created_at,
    })),
  });
}));

/* -------------------------------- surveys ---------------------------------- */

/**
 * Task submissions that carry survey answers, with each answer resolved
 * against its question's label (not just a raw question-id key), plus the
 * respondent's location. Filters mirror /registrations.
 */
externalRouter.get('/surveys', wrap(async (req, res) => {
  const { limit, offset } = page(req);
  const where = ['s.answers_json IS NOT NULL'];
  const params = [];
  if (req.query.lga) { where.push('m.lga = ?'); params.push(req.query.lga); }
  if (req.query.ward) { where.push('m.ward = ?'); params.push(req.query.ward); }
  if (req.query.polling_unit) { where.push('m.polling_unit = ?'); params.push(req.query.polling_unit); }
  if (req.query.status) { where.push('s.status = ?'); params.push(req.query.status); }
  if (req.query.task_id) { where.push('s.task_id = ?'); params.push(req.query.task_id); }
  const clause = where.join(' AND ');

  const total = (await db.prepare(
    'SELECT COUNT(*) n FROM submissions s JOIN members m ON m.id = s.member_id WHERE ' + clause
  ).get(...params)).n;

  const rows = await db.prepare(
    'SELECT s.id, s.task_id, t.title task_title, s.answers_json, s.lat, s.lng, s.accuracy, '
    + 's.status, s.created_at, m.lga, m.ward, m.polling_unit, m.lat member_lat, m.lng member_lng, '
    + 'm.accuracy member_accuracy '
    + 'FROM submissions s JOIN tasks t ON t.id = s.task_id JOIN members m ON m.id = s.member_id '
    + 'WHERE ' + clause + ' ORDER BY s.id ASC LIMIT ? OFFSET ?'
  ).all(...params, limit, offset);

  const taskIds = [...new Set(rows.map((r) => r.task_id))];
  const questionMaps = {};
  for (const tid of taskIds) {
    const t = await db.prepare('SELECT questions_json FROM tasks WHERE id = ?').get(tid);
    const qs = parseJson(t?.questions_json, []);
    questionMaps[tid] = Object.fromEntries((Array.isArray(qs) ? qs : []).map((q) => [q.id, q.label]));
  }

  const shaped = rows.map((r) => {
    const raw = parseJson(r.answers_json, {});
    const qmap = questionMaps[r.task_id] || {};
    const answers = Object.entries(raw && typeof raw === 'object' ? raw : {})
      .filter(([, value]) => value !== '' && value != null)
      .map(([qid, value]) => ({ question: qmap[qid] || qid, value }));
    const lat = r.lat ?? r.member_lat;
    const lng = r.lng ?? r.member_lng;
    return {
      id: r.id, task_id: r.task_id, task_title: r.task_title,
      answers, status: r.status,
      lga: r.lga, ward: r.ward, polling_unit: r.polling_unit,
      location: lat == null ? null : { lat, lng, accuracy: r.accuracy ?? r.member_accuracy },
      submitted_at: r.created_at,
    };
  });

  res.json({
    total, limit, offset,
    next_offset: offset + rows.length < total ? offset + rows.length : null,
    rows: shaped,
  });
}));

/* -------------------------------- coverage --------------------------------- */

/**
 * Membership counts (Unit Promoters + Grassroots together, since both are
 * "members" in this app) rolled up at every geographic level the state uses
 * -- polling unit, ward, LGA, and the three electoral tiers above LGA
 * (senatorial district, federal constituency, state assembly constituency).
 * Senatorial and federal tiers are folded in JS from the by-LGA counts; state
 * assembly seats from the by-ward counts, since some of them split an LGA.
 */
externalRouter.get('/coverage', wrap(async (req, res) => {
  const requestedLevel = req.query.level; // polling_unit|ward|lga|senatorial|federal|state_const

  const byPollingUnit = await db.prepare(
    'SELECT lga, ward, polling_unit, COUNT(*) members, '
    + "SUM(CASE WHEN status='verified' THEN 1 ELSE 0 END) verified "
    + 'FROM members GROUP BY lga, ward, polling_unit ORDER BY lga, ward, polling_unit'
  ).all();

  const byWard = await db.prepare(
    'SELECT lga, ward, COUNT(*) members, '
    + "SUM(CASE WHEN status='verified' THEN 1 ELSE 0 END) verified, "
    + 'COUNT(DISTINCT polling_unit) polling_units '
    + 'FROM members GROUP BY lga, ward ORDER BY lga, ward'
  ).all();

  const byLga = await db.prepare(
    'SELECT lga, COUNT(*) members, '
    + "SUM(CASE WHEN status='verified' THEN 1 ELSE 0 END) verified, "
    + "COUNT(DISTINCT ward) wards, COUNT(DISTINCT ward || '|' || polling_unit) polling_units "
    + 'FROM members GROUP BY lga ORDER BY lga'
  ).all();

  const rollUp = (groups) => Object.entries(groups).map(([name, lgas]) => {
    const rows = byLga.filter((r) => lgas.includes(r.lga));
    return {
      name,
      lgas: lgas.length,
      members: rows.reduce((a, r) => a + r.members, 0),
      verified: rows.reduce((a, r) => a + (r.verified || 0), 0),
      wards: rows.reduce((a, r) => a + r.wards, 0),
      polling_units: rows.reduce((a, r) => a + r.polling_units, 0),
    };
  });

  // State Assembly seats split some LGAs (Akinyele I / II etc.), so they are
  // built from wards, which ward-constituencies.js assigns to exactly one seat.
  // These rows therefore partition the state and can be summed.
  const byStateConst = Object.keys(STATE_CONST).map((name) => {
    const wards = new Set(wardsInStateConstituency(name).map((w) => w.lga + '|' + w.ward));
    const rows = byWard.filter((r) => wards.has(r.lga + '|' + r.ward));
    return {
      name,
      lgas: STATE_CONST[name].length,
      members: rows.reduce((a, r) => a + r.members, 0),
      verified: rows.reduce((a, r) => a + (r.verified || 0), 0),
      wards: rows.length,
      polling_units: rows.reduce((a, r) => a + r.polling_units, 0),
    };
  });

  const result = {
    generated_at: nowISO(),
    by_senatorial_district: rollUp(SENATORIAL),
    by_federal_constituency: rollUp(FEDERAL),
    by_state_constituency: byStateConst,
    by_lga: byLga,
    by_ward: byWard,
    by_polling_unit: byPollingUnit,
  };

  if (requestedLevel) {
    const key = 'by_' + requestedLevel.replace(/-/g, '_');
    if (!(key in result)) {
      return res.status(400).json({
        error: 'Unknown level. Use one of: polling_unit, ward, lga, '
             + 'senatorial_district, federal_constituency, state_constituency',
      });
    }
    return res.json({ generated_at: result.generated_at, level: requestedLevel, rows: result[key] });
  }

  res.json(result);
}));

/* --------------------------- the Sigar Vote set ---------------------------- */

// /areas, /volunteers, /projects, /activity and /all live in external-sigar.js
// and are attached here. Separate file on purpose: this one is shared, and a
// previous set of endpoints was lost to a merge once already.
registerSigarRoutes(externalRouter, wrap);
