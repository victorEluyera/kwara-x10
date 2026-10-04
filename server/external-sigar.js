import {dashboardPayload} from './external-dashboard.js';
// The endpoints Sigar Vote asked for.
//
// Kept in its own file rather than grown inside external.js, which somebody
// else owns and which has already lost a set of endpoints once to a merge.
// external.js imports this and hands it the router.
//
// Three things in the brief cannot be answered from what this system holds,
// and they come back as null with a reason rather than being omitted or
// guessed at:
//
//   polling_unit_code   INEC's 30-12-05-007 form. Nothing here carries it --
//                       geography is held by name. It needs an INEC
//                       polling-unit code list loaded before it can be filled.
//   date_of_birth       Never collected from members. The voter register has
//                       it, but that is a different population, and matching
//                       the two is what Sigar Vote is for.
//   progress_percent    Not tracked. Projects carry a status, not a percentage.
//
// Everything else is real. Where a field is derived rather than stored --
// category, cost, the status vocabulary -- the mapping is written out here so
// the consuming side can see exactly what it is being given.

import { db, nowISO } from './db.js';
import { SENATORIAL, TOTAL_POLLING_UNITS } from './data/geo.js';

/* ------------------------------ vocabularies ------------------------------- */

/**
 * Our twenty framework sectors in the seven categories Sigar Vote uses, plus
 * "other" -- because forcing a town hall or a refuse round into "empowerment"
 * is a worse answer than admitting it does not fit.
 */
export const CATEGORY_OF_SECTOR = {
  'Water, Sanitation & Hygiene (WASH)': 'water',
  'Roads & Mobility': 'roads',
  'Transport & Public Access': 'roads',
  'Flooding & Drainage': 'roads',
  'Electricity & Public Lighting': 'power',
  'Primary Healthcare': 'health',
  Education: 'education',
  'Digital Inclusion': 'education',
  'Markets & Local Commerce': 'market',
  'SMEs & Local Enterprise': 'market',
  'Agriculture & Food Security': 'market',
  'Youth Skills & Employment': 'empowerment',
  'Women & Social Inclusion': 'empowerment',
  'Social Protection': 'empowerment',
  'Sports & Youth Development': 'empowerment',
  'Community & Civic Infrastructure': 'other',
  'Community Safety': 'other',
  'Environment & Waste Management': 'other',
  'Culture, Tourism & Heritage': 'other',
  'Community Data & Planning': 'other',
};

export const CATEGORIES = [...new Set(Object.values(CATEGORY_OF_SECTOR))];

/**
 * Our status words in theirs.
 *
 * "submitted" is not one of ours, because every project in this system has
 * been submitted -- that is how it got here. A project that exists is
 * submitted, and `submitted_at` says when. What varies afterwards is whether
 * work has begun.
 */
export const STATUS_OF = { promised: 'not_started', ongoing: 'ongoing', completed: 'completed' };
export const STATUSES = ['submitted', 'not_started', 'ongoing', 'completed'];

/**
 * A naira figure out of free text.
 *
 * The budget field was always free text -- "₦2.5m", "about 900,000", "2 million
 * naira" -- so this reads what it can and returns null rather than a wrong
 * number when it cannot. The raw text goes alongside it either way.
 */
export function parseNaira(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const m = /([\d,]+(?:\.\d+)?)\s*(m|mn|million|k|thousand|bn|billion)?/i.exec(raw);
  if (!m) return null;
  const value = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(value) || value <= 0) return null;
  const scale = { m: 1e6, mn: 1e6, million: 1e6, k: 1e3, thousand: 1e3, bn: 1e9, billion: 1e9 };
  return Math.round(value * (scale[String(m[2] || '').toLowerCase()] || 1));
}

/* ------------------------------ query helpers ------------------------------ */

/**
 * `?since=` -- an ISO timestamp, so a consumer can pull only what has changed.
 * Anything unparseable is refused rather than ignored: a caller who believes
 * they are getting a delta and is quietly handed everything will build on that
 * wrong assumption for months.
 */
export function since(query) {
  const raw = String(query?.since || '').trim();
  if (!raw) return null;
  const at = new Date(raw);
  if (Number.isNaN(at.getTime())) {
    const error = new Error('since must be an ISO timestamp, e.g. 2026-09-01T00:00:00Z');
    error.status = 400;
    throw error;
  }
  return at.toISOString();
}

const page = (query, max = 5000) => ({
  limit: Math.min(Math.max(1, Number(query?.limit) || 1000), max),
  offset: Math.max(0, Number(query?.offset) || 0),
});

/** The note that travels with every payload, so nobody has to guess. */
export const NOT_AVAILABLE = {
  polling_unit_code: 'Not held, and not invented. 10x stores geography by name, and its '
    + 'polling units are held alphabetically rather than in INEC unit order, so a code '
    + 'derived from position would look right and be wrong. Join on place_key, or send an '
    + 'INEC polling-unit code list and this will be filled from it.',
  date_of_birth: 'Not collected from members.',
  progress_percent: 'Not tracked. Projects carry a status, not a percentage.',
};

/* ----------------------------- payload builders ---------------------------- */
//
// Plain functions taking a query object, so /all can call them directly rather
// than re-entering the router. Each returns exactly what its endpoint sends.

/**
 * A stable key for a place, to join on.
 *
 * Not an INEC code, and deliberately not shaped like one. 10x holds geography
 * by name, and its polling units are stored alphabetically rather than in
 * INEC's unit order — so a code derived from position would look authoritative
 * and be wrong, which is worse than not having one. A consumer joining on a
 * wrong 30-12-05-007 would attach results to the wrong unit and never know.
 *
 * This is what a name-based join needs instead: case, punctuation and spacing
 * folded away, so "OJO-EMO/MONIYA" and "Ojo Emo / Moniya" meet.
 */
export const placeKey = (...parts) => parts
  .filter((v) => v !== null && v !== undefined && String(v).trim() !== '')
  .map((v) => String(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
  .join(':');

/** Which senatorial district an LGA sits in. */
const DISTRICT_OF_LGA = Object.fromEntries(
  Object.entries(SENATORIAL).flatMap(([district, lgas]) => lgas.map((l) => [l, district])));

/** Counts per area, at whichever level is asked for. */
export async function areasPayload(query = {}) {
  const level = String(query.level || 'ward').toLowerCase();
  const columns = { senatorial: ['lga'], lga: ['lga'], ward: ['lga', 'ward'],
    polling_unit: ['lga', 'ward', 'polling_unit'] }[level];
  if (!columns) {
    const error = new Error('level must be senatorial, lga, ward or polling_unit');
    error.status = 400;
    throw error;
  }

  // Ward and polling-unit names repeat across the state, so a row only means
  // anything together with what contains it: every level below LGA is grouped
  // by the full path, not the name alone.
  const group = columns.join(', ');
  const rows = await db.prepare(
    'SELECT ' + group + ', COUNT(*) AS registered, '
    + "SUM(CASE WHEN status='verified' THEN 1 ELSE 0 END) AS verified, "
    + "SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending, "
    + "SUM(CASE WHEN level='mobiliser' THEN 1 ELSE 0 END) AS unit_promoters, "
    + "SUM(CASE WHEN level='grassroot' THEN 1 ELSE 0 END) AS grassroots, "
    + 'MAX(created_at) AS last_registration '
    + 'FROM members GROUP BY ' + group + ' ORDER BY ' + group
  ).all();

  // Senatorial districts are whole LGAs, so they are rolled up from the LGA
  // counts rather than queried separately -- one less pass over the members
  // table, and the two can never disagree.
  if (level === 'senatorial') {
    const districts = new Map();
    for (const r of rows) {
      const name = DISTRICT_OF_LGA[r.lga];
      if (!name) continue;
      const d = districts.get(name) || { senatorial_district: name,
        place_key: placeKey('kwara', name), lgas: 0, registered: 0,
        verified: 0, pending: 0, unit_promoters: 0, grassroots: 0, last_registration: null };
      d.lgas += 1;
      d.registered += Number(r.registered) || 0;
      d.verified += Number(r.verified) || 0;
      d.pending += Number(r.pending) || 0;
      d.unit_promoters += Number(r.unit_promoters) || 0;
      d.grassroots += Number(r.grassroots) || 0;
      if (!d.last_registration || (r.last_registration || '') > d.last_registration) {
        d.last_registration = r.last_registration;
      }
      districts.set(name, d);
    }
    return {
      generated_at: nowISO(),
      level,
      complete: true,
      areas: Object.keys(SENATORIAL).map((name) => districts.get(name)
        || { senatorial_district: name, place_key: placeKey('kwara', name),
          lgas: 0, registered: 0, verified: 0, pending: 0,
          unit_promoters: 0, grassroots: 0, last_registration: null }),
      targets: {
        unit_promoters: TOTAL_POLLING_UNITS * 10, engagements: 19300, split_by_lga: false,
        note: 'Programme-wide targets, not divided by district in this system.',
      },
    };
  }

  return {
    generated_at: nowISO(),
    level,
    // Every area with anybody in it is here; nothing is paged away.
    complete: true,
    areas: rows.map((r) => {
      const area = { lga: r.lga };
      if (columns.includes('ward')) area.ward = r.ward;
      if (columns.includes('polling_unit')) {
        area.polling_unit = r.polling_unit;
        area.polling_unit_code = null;
      }
      return {
        ...area,
        // Join on this rather than on the display names.
        place_key: placeKey('kwara', r.lga,
          columns.includes('ward') ? r.ward : null,
          columns.includes('polling_unit') ? r.polling_unit : null),
        registered: Number(r.registered) || 0,
        verified: Number(r.verified) || 0,
        pending: Number(r.pending) || 0,
        unit_promoters: Number(r.unit_promoters) || 0,
        grassroots: Number(r.grassroots) || 0,
        last_registration: r.last_registration,
      };
    }),
    targets: {
      // The programme's own figures, as this system holds them. If a different
      // number is in circulation, it did not come from here.
      unit_promoters: TOTAL_POLLING_UNITS * 10,
      engagements: 19300,
      split_by_lga: false,
      note: 'Programme-wide targets, not divided by LGA in this system.',
    },
    not_available: { polling_unit_code: NOT_AVAILABLE.polling_unit_code },
  };
}

/**
 * Candidates and nominees as counts, with nobody named.
 *
 * The consuming side asked for aggregate totals only: how many candidates,
 * how many nominees, how many of those are verified. No candidate-level
 * records, so none are read.
 */
export async function stakeholdersPayload() {
  const candidates = await db.prepare(
    "SELECT COUNT(*) AS total, "
    + "SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active "
    + "FROM users WHERE role = 'candidate'"
  ).get();

  const nominees = await db.prepare(
    "SELECT COUNT(*) AS total, "
    + "SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END) AS verified, "
    + "SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending, "
    + "SUM(CASE WHEN status = 'flagged' THEN 1 ELSE 0 END) AS flagged, "
    + "COUNT(DISTINCT upline_user_id) AS candidates_nominating "
    + "FROM members WHERE level = 'mobiliser' AND status <> 'rejected'"
  ).get();

  const projects = await db.prepare(
    'SELECT COUNT(*) AS total, COUNT(DISTINCT candidate_id) AS candidates_submitting FROM projects'
  ).get();

  const num = (v) => Number(v) || 0;
  return {
    generated_at: nowISO(),
    candidates: { total: num(candidates.total), active: num(candidates.active) },
    nominees: {
      total: num(nominees.total),
      verified: num(nominees.verified),
      pending: num(nominees.pending),
      flagged: num(nominees.flagged),
      candidates_nominating: num(nominees.candidates_nominating),
    },
    projects: {
      total: num(projects.total),
      candidates_submitting: num(projects.candidates_submitting),
    },
  };
}

/**
 * One row per person, for matching against the PDP membership register.
 *
 * Name, phone and location only. No NIN, no BVN, no bank details, no PVC and
 * no photographs -- the fields this app treats as most sensitive, and which
 * were explicitly not asked for.
 */
export async function volunteersPayload(query = {}) {
  const { limit, offset } = page(query);
  const from = since(query);

  const where = [];
  const params = [];
  if (from) { where.push('created_at >= ?'); params.push(from); }
  if (query.level) {
    where.push('level = ?');
    params.push(query.level === 'unit_promoter' ? 'mobiliser' : String(query.level));
  }
  const clause = where.length ? ' WHERE ' + where.join(' AND ') : '';

  const total = Number((await db.prepare(
    'SELECT COUNT(*) AS n FROM members' + clause).get(...params)).n) || 0;

  const rows = await db.prepare(
    'SELECT id, code, first_name, last_name, phone, level, status, '
    + 'lga, ward, polling_unit, created_at '
    + 'FROM members' + clause + ' ORDER BY id LIMIT ? OFFSET ?'
  ).all(...params, limit, offset);

  return {
    generated_at: nowISO(),
    since: from,
    total,
    count: rows.length,
    next_offset: offset + rows.length < total ? offset + rows.length : null,
    volunteers: rows.map((r) => ({
      member_id: r.id,
      member_code: r.code,
      full_name: [r.first_name, r.last_name].filter(Boolean).join(' '),
      phone: r.phone,
      date_of_birth: null,
      level: r.level === 'mobiliser' ? 'unit_promoter' : r.level,
      status: r.status,
      lga: r.lga,
      ward: r.ward,
      polling_unit: r.polling_unit,
      polling_unit_code: null,
      registered_at: r.created_at,
    })),
    not_available: {
      date_of_birth: NOT_AVAILABLE.date_of_birth,
      polling_unit_code: NOT_AVAILABLE.polling_unit_code,
    },
  };
}

/** One row per community project. */
export async function projectsPayload(query = {}) {
  const { limit, offset } = page(query);
  const from = since(query);

  const where = [];
  const params = [];
  if (from) { where.push('COALESCE(p.updated_at, p.created_at) >= ?'); params.push(from); }
  if (query.status) {
    const ours = Object.keys(STATUS_OF).find((k) => STATUS_OF[k] === query.status)
      || String(query.status);
    where.push('p.status = ?');
    params.push(ours);
  }
  const clause = where.length ? ' WHERE ' + where.join(' AND ') : '';

  const total = Number((await db.prepare(
    'SELECT COUNT(*) AS n FROM projects p' + clause).get(...params)).n) || 0;

  const rows = await db.prepare(
    'SELECT p.*, u.member_id AS submitter_member_id '
    + 'FROM projects p LEFT JOIN users u ON u.id = p.candidate_id'
    + clause + ' ORDER BY p.id LIMIT ? OFFSET ?'
  ).all(...params, limit, offset);

  // Photo counts only. Coordinates are deliberately not read: the consuming
  // side does not want precise project locations, and the LGA, ward and
  // polling unit already place a project well enough to map.
  const photos = new Map();
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    const marks = ids.map(() => '?').join(',');
    for (const row of await db.prepare(
      'SELECT project_id, COUNT(*) AS n FROM project_photos '
      + 'WHERE project_id IN (' + marks + ') GROUP BY project_id').all(...ids)) {
      photos.set(Number(row.project_id), Number(row.n));
    }
  }

  return {
    generated_at: nowISO(),
    since: from,
    total,
    count: rows.length,
    next_offset: offset + rows.length < total ? offset + rows.length : null,
    // Whether this is every project or only a page of them.
    complete: offset === 0 && rows.length === total,
    truncated: offset + rows.length < total,
    categories: CATEGORIES,
    statuses: STATUSES,
    projects: rows.map((p) => {
      return {
        project_id: p.id,
        title: p.title,
        category: CATEGORY_OF_SECTOR[p.sector] || 'other',
        sector: p.sector,
        item: p.item_id || null,
        status: STATUS_OF[p.status] || p.status,
        lga: p.lga,
        ward: p.ward,
        polling_unit: p.polling_unit || null,
        polling_unit_code: null,
        place_key: placeKey('kwara', p.lga, p.ward, p.polling_unit),
        community: p.community || null,
        quantity: p.quantity ?? null,
        unit: p.unit || null,
        estimated_cost_ngn: parseNaira(p.budget),
        estimated_cost_text: p.budget || null,
        submitted_at: p.created_at,
        started_at: p.status === 'ongoing' || p.status === 'completed' ? p.updated_at : null,
        completed_at: p.status === 'completed' ? p.updated_at : null,
        updated_at: p.updated_at || p.created_at,
        progress_percent: null,
        people_served: p.beneficiaries ?? null,
        photo_count: photos.get(Number(p.id)) || 0,
        // An account id, never a name or a phone number.
        submitted_by_member_id: p.submitter_member_id ?? null,
        submitted_by_account_id: p.candidate_id,
      };
    }),
    not_available: {
      progress_percent: NOT_AVAILABLE.progress_percent,
      polling_unit_code: NOT_AVAILABLE.polling_unit_code,
      coordinates: 'Deliberately not sent. LGA, ward and polling unit place a project '
        + 'closely enough to map, and precise coordinates were not wanted.',
      started_at: 'Inferred from the current status and the last update. Exact '
        + 'transition times are recorded from the date this shipped -- see /activity.',
    },
  };
}

/** Registrations and project movement, per day. */
export async function activityPayload(query = {}) {
  const from = since(query) || new Date(Date.now() - 90 * 864e5).toISOString();

  const registrations = await db.prepare(
    'SELECT SUBSTRING(created_at, 1, 10) AS day, COUNT(*) AS n, '
    + "SUM(CASE WHEN level='mobiliser' THEN 1 ELSE 0 END) AS unit_promoters, "
    + "SUM(CASE WHEN level='grassroot' THEN 1 ELSE 0 END) AS grassroots "
    + 'FROM members WHERE created_at >= ? GROUP BY SUBSTRING(created_at, 1, 10) ORDER BY day'
  ).all(from);

  const created = await db.prepare(
    'SELECT SUBSTRING(created_at, 1, 10) AS day, COUNT(*) AS n '
    + 'FROM projects WHERE created_at >= ? GROUP BY SUBSTRING(created_at, 1, 10) ORDER BY day'
  ).all(from);

  // Real transitions, from the day the history table shipped. Before that
  // there is nothing to report, and saying so beats inventing a curve.
  const changes = await db.prepare(
    'SELECT SUBSTRING(changed_at, 1, 10) AS day, to_status AS status, COUNT(*) AS n '
    + 'FROM project_status_events WHERE changed_at >= ? '
    + 'GROUP BY SUBSTRING(changed_at, 1, 10), to_status ORDER BY day'
  ).all(from);

  const earliest = (await db.prepare(
    'SELECT MIN(changed_at) AS first FROM project_status_events').get())?.first || null;

  return {
    generated_at: nowISO(),
    since: from,
    registrations_per_day: registrations.map((r) => ({
      day: r.day,
      registered: Number(r.n) || 0,
      unit_promoters: Number(r.unit_promoters) || 0,
      grassroots: Number(r.grassroots) || 0,
    })),
    projects_submitted_per_day: created.map((r) => ({ day: r.day, submitted: Number(r.n) || 0 })),
    project_status_changes_per_day: changes.map((r) => ({
      day: r.day,
      to_status: STATUS_OF[r.status] || r.status,
      count: Number(r.n) || 0,
    })),
    status_history_begins: earliest,
    note: earliest
      ? 'Status changes are recorded from ' + earliest + ' onwards.'
      : 'No status changes recorded yet. Transitions are captured from the date this '
        + 'shipped; projects created before then have a status but no history of how '
        + 'they reached it.',
  };
}

/**
 * Everything in one call, for a consumer that would otherwise make four.
 *
 * Complete aggregate dashboard snapshot, with uncapped project rows and
 * questionnaire answer summaries. Person-level volunteers are never included.
 */
export async function allPayload(query = {}) {
  // /all is a complete dashboard snapshot. Pagination never caps its totals or project rows.
  return dashboardPayload(db);
}

/* --------------------------------- routes ---------------------------------- */

export function registerSigarRoutes(router, wrap) {
  const serve = (build) => wrap(async (req, res) => res.json(await build(req.query)));

  router.get('/areas', serve(areasPayload));
  router.get('/stakeholders', serve(stakeholdersPayload));
  // Person-level, and therefore not part of /all. See allPayload.
  router.get('/volunteers', serve(volunteersPayload));
  router.get('/projects', serve(projectsPayload));
  router.get('/activity', serve(activityPayload));
  router.get('/all', serve(allPayload));
  router.get('/field-work', serve(async()=> (await dashboardPayload(db)).field_work));
}
