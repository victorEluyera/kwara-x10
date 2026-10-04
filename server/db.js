// PostgreSQL data layer.
//
// The rest of the app talks to the database through the small interface at the
// bottom of this file -- db.prepare(sql).get/all/run, db.exec, db.transaction.
// That interface was originally shaped around SQLite, and it is kept exactly
// as-is here on purpose: it means ~190 query call sites across the server did
// not have to change when the database moved to Postgres. The translation
// (positional placeholders, INSERT ... RETURNING id, bigint parsing) happens
// here, once, instead of being smeared across every route.

import pg from 'pg';

const { Pool, types } = pg;


types.setTypeParser(types.builtins.INT8, (value) => parseInt(value, 10));
types.setTypeParser(types.builtins.NUMERIC, (value) => parseFloat(value));

const rawConnectionString = process.env.DATABASE_URL;

// Managed providers hand out a URL ending in `?sslmode=require`, but recent
// pg versions treat that as `verify-full` -- full chain verification against
// the system CA store. DigitalOcean signs with its own CA, which Node does
// not ship, so the handshake fails with "self-signed certificate in
// certificate chain" and the sslmode in the URL silently overrides the ssl
// option below. Strip it and decide TLS in one place, here.
export function stripSslMode(url) {
  if (!url) return url;
  const q = url.indexOf('?');
  if (q === -1) return url;
  // Only the query string is touched, never the credentials before it.
  const params = url.slice(q + 1).split('&').filter((p) => !/^sslmode=/i.test(p));
  return params.length ? url.slice(0, q) + '?' + params.join('&') : url.slice(0, q);
}

const connectionString = stripSslMode(rawConnectionString);

// Connections are always encrypted off-box. With the provider's CA supplied
// in DATABASE_CA_CERT the chain is verified properly; without it we still
// encrypt but skip chain validation, which is what the providers' own
// connection snippets do.
const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(connectionString || '');
const ca = process.env.DATABASE_CA_CERT;
const ssl = isLocal ? false
  : ca ? { ca, rejectUnauthorized: true }
  : { rejectUnauthorized: false };

const pool = new Pool({
  connectionString,
  ssl,
  // The smallest managed Postgres plans cap total connections in the low
  // twenties, and this app runs as a single web service, so stay well under.
  max: Number(process.env.PGPOOL_MAX || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (error) => {
  // An idle pooled connection dropped by the server must not take the process
  // down; the pool replaces it on the next checkout.
  console.error('[db] idle client error:', error.message);
});

/* --------------------------- SQL translation ------------------------------ */

// The app writes `?` placeholders (SQLite style); Postgres wants $1, $2...
// Quoted string literals are skipped so a `?` inside text is left alone.
const placeholderCache = new Map();
export function toPositional(sql) {
  const cached = placeholderCache.get(sql);
  if (cached) return cached;
  let out = '';
  let n = 0;
  let inString = false;
  for (const ch of sql) {
    if (ch === "'") { inString = !inString; out += ch; continue; }
    if (ch === '?' && !inString) { out += '$' + ++n; continue; }
    out += ch;
  }
  placeholderCache.set(sql, out);
  return out;
}

// SQLite's .run() hands back lastInsertRowid for free. Postgres only returns
// it if asked, so INSERTs get a RETURNING id appended -- but only for tables
// that actually have an id column (voter_roll is keyed by vin and has none).
const tablesWithId = new Set();
const INSERT_TABLE = /^\s*INSERT\s+INTO\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/i;

function withReturningId(sql) {
  if (/\bRETURNING\b/i.test(sql)) return sql;
  const match = sql.match(INSERT_TABLE);
  if (!match || !tablesWithId.has(match[1].toLowerCase())) return sql;
  return sql + ' RETURNING id';
}

const makeDb = (query) => ({
  // Multi-statement DDL goes to Postgres in one call. (The old SQLite driver
  // had to split on ';' by hand, which broke on a semicolon inside a comment.)
  exec: async (sql) => { await query(sql, [], true); },
  prepare: (sql) => ({
    get: async (...args) => (await query(sql, args)).rows[0] || undefined,
    all: async (...args) => (await query(sql, args)).rows,
    run: async (...args) => {
      const result = await query(withReturningId(sql), args);
      return {
        changes: result.rowCount || 0,
        lastInsertRowid: result.rows?.[0]?.id,
      };
    },
  }),
});

const runOnPool = (sql, args = [], raw = false) =>
  raw ? pool.query(sql) : pool.query(toPositional(sql), args);

export const db = {
  ...makeDb(runOnPool),
  transaction: async (fn) => {
    const client = await pool.connect();
    const txDb = makeDb((sql, args = [], raw = false) =>
      raw ? client.query(sql) : client.query(toPositional(sql), args));
    try {
      await client.query('BEGIN');
      const result = await fn(txDb);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* preserve original error */ }
      throw error;
    } finally {
      client.release();
    }
  },
  pool,
};

/* -------------------------------- schema ---------------------------------- */

/**
 * Create/upgrade the schema. Called explicitly by the entry points rather than
 * on import, so that importing this module (which auth.js does purely for
 * touchLogin) does not require a live database -- unit tests import it without
 * one. Creating the Pool above opens no connection; the first query does.
 */
export async function initSchema() {
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. This app needs a PostgreSQL connection string, '
      + 'e.g. postgres://user:password@host:5432/dbname'
    );
  }

  await db.exec(`
CREATE TABLE IF NOT EXISTS pdp_contact_match_index (
  identity TEXT PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS pdp_contact_match_metadata (
  id INTEGER PRIMARY KEY CHECK(id=1),
  secret TEXT NOT NULL,
  source_records INTEGER NOT NULL,
  source_identities INTEGER NOT NULL,
  loaded_at TEXT NOT NULL,
  loaded_by INTEGER
);
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  must_reset    INTEGER NOT NULL DEFAULT 1,
  role          TEXT NOT NULL,
  office        TEXT,
  full_name     TEXT NOT NULL,
  phone         TEXT,
  scope_type    TEXT NOT NULL DEFAULT 'state',
  scope_value   TEXT,
  upline_id     INTEGER REFERENCES users(id),
  member_id     INTEGER,
  referral_code TEXT UNIQUE,
  status        TEXT NOT NULL DEFAULT 'active',
  last_login    TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  id               SERIAL PRIMARY KEY,
  code             TEXT NOT NULL UNIQUE,
  first_name       TEXT NOT NULL,
  last_name        TEXT NOT NULL,
  phone            TEXT NOT NULL,
  title            TEXT,
  designation      TEXT,
  pvc_no           TEXT,
  nin              TEXT,
  bank_name        TEXT,
  account_number   TEXT,
  account_name     TEXT,
  lga              TEXT NOT NULL,
  ward             TEXT NOT NULL,
  polling_unit     TEXT NOT NULL,
  level            TEXT NOT NULL DEFAULT 'mobiliser',
  upline_user_id   INTEGER REFERENCES users(id),
  upline_member_id INTEGER REFERENCES members(id),
  lat DOUBLE PRECISION, lng DOUBLE PRECISION, accuracy DOUBLE PRECISION, captured_at TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',
  review_note      TEXT,
  reviewed_by      INTEGER REFERENCES users(id),
  reviewed_at      TEXT,
  checks_json      TEXT,
  risk_score       INTEGER NOT NULL DEFAULT 0,
  risk_flags       TEXT,
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_members_upline_user ON members(upline_user_id);
CREATE INDEX IF NOT EXISTS idx_members_upline_member ON members(upline_member_id);
CREATE INDEX IF NOT EXISTS idx_members_geo ON members(lga, ward);
CREATE INDEX IF NOT EXISTS idx_members_phone ON members(phone);
CREATE INDEX IF NOT EXISTS idx_members_nin ON members(nin);
CREATE INDEX IF NOT EXISTS idx_members_pvc ON members(pvc_no);
CREATE INDEX IF NOT EXISTS idx_members_account ON members(account_number);
-- The surname-cluster check counts people of one surname in one polling unit,
-- and the nomination quota counts a candidate's people in one unit. Both run
-- once per person added.
CREATE INDEX IF NOT EXISTS idx_members_surname_unit ON members(polling_unit, last_name);
CREATE INDEX IF NOT EXISTS idx_members_upline_unit
  ON members(upline_user_id, lga, ward, polling_unit);

CREATE TABLE IF NOT EXISTS tasks (
  id                 SERIAL PRIMARY KEY,
  title              TEXT NOT NULL,
  description        TEXT,
  type               TEXT NOT NULL,
  points             INTEGER NOT NULL DEFAULT 5,
  mandatory          INTEGER NOT NULL DEFAULT 1,
  requires_photo     INTEGER NOT NULL DEFAULT 0,
  requires_location  INTEGER NOT NULL DEFAULT 1,
  questions_json     TEXT,
  target_level       TEXT NOT NULL DEFAULT 'all',
  target_scope_type  TEXT NOT NULL DEFAULT 'state',
  target_scope_value TEXT,
  period             TEXT NOT NULL,
  opens_at           TEXT,
  due_at             TEXT,
  status             TEXT NOT NULL DEFAULT 'open',
  created_by         INTEGER REFERENCES users(id),
  created_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS submissions (
  id           SERIAL PRIMARY KEY,
  task_id      INTEGER NOT NULL REFERENCES tasks(id),
  member_id    INTEGER REFERENCES members(id),
  user_id      INTEGER REFERENCES users(id),
  answers_json TEXT,
  photo_path   TEXT,
  lat DOUBLE PRECISION, lng DOUBLE PRECISION, accuracy DOUBLE PRECISION,
  note         TEXT,
  status       TEXT NOT NULL DEFAULT 'pending',
  points_awarded INTEGER NOT NULL DEFAULT 0,
  review_note  TEXT,
  reviewed_by  INTEGER REFERENCES users(id),
  reviewed_at  TEXT,
  created_at   TEXT NOT NULL,
  UNIQUE(task_id, member_id)
);
CREATE INDEX IF NOT EXISTS idx_sub_task ON submissions(task_id);
CREATE INDEX IF NOT EXISTS idx_sub_member ON submissions(member_id);

CREATE TABLE IF NOT EXISTS points_ledger (
  id         SERIAL PRIMARY KEY,
  member_id  INTEGER REFERENCES members(id),
  user_id    INTEGER REFERENCES users(id),
  source     TEXT NOT NULL,
  source_id  INTEGER,
  points     INTEGER NOT NULL,
  period     TEXT NOT NULL,
  note       TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_points_member ON points_ledger(member_id, period);

-- INEC register extract, loaded by an administrator. Persisted so PVC matching
-- survives a restart and can be queried rather than held in memory.
CREATE TABLE IF NOT EXISTS voter_roll (
  vin          TEXT PRIMARY KEY,
  last_name    TEXT,
  first_name   TEXT,
  lga          TEXT,
  ward         TEXT,
  polling_unit TEXT,
  loaded_at    TEXT NOT NULL,
  batch        TEXT
);
CREATE INDEX IF NOT EXISTS idx_roll_pu ON voter_roll(polling_unit);
-- For the fallback lookup when a VIN does not match: find the people of that
-- surname in that polling unit. Without it, every miss is a sequential scan of
-- 3.26 million rows.
CREATE INDEX IF NOT EXISTS idx_roll_surname ON voter_roll(LOWER(last_name), polling_unit);

CREATE TABLE IF NOT EXISTS audit_log (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER,
  actor      TEXT,
  action     TEXT NOT NULL,
  entity     TEXT,
  entity_id  INTEGER,
  detail     TEXT,
  ip         TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS registration_drafts (
  id SERIAL PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  creator_user_id INTEGER NOT NULL REFERENCES users(id),
  data_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL
);

-- One current disparities/challenges report per candidate, per the Campaign
-- Council directive of 9 Sept 2026 (items i and ii). Upserted on submission --
-- updated_at tracks edits, reviewed_* tracks leadership follow-up.
CREATE TABLE IF NOT EXISTS disparity_reports (
  id           SERIAL PRIMARY KEY,
  candidate_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  disparities  TEXT,
  challenges   TEXT,
  positives    TEXT,
  lat          DOUBLE PRECISION,
  lng          DOUBLE PRECISION,
  accuracy     DOUBLE PRECISION,
  submitted_at TEXT NOT NULL,
  updated_at   TEXT,
  reviewed_by  INTEGER REFERENCES users(id),
  reviewed_at  TEXT,
  review_note  TEXT
);

-- Self-service "forgot password". There is no email/SMS provider wired up,
-- so this cannot deliver a reset link by itself -- what it can safely do is
-- verify the requester knows the phone number on file and hand the request
-- to an administrator, who fulfils it the same way every password on this
-- platform is already issued: generated once, relayed by a human.
CREATE TABLE IF NOT EXISTS password_reset_requests (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  phone_matched INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'pending',
  requested_ip  TEXT,
  resolved_by   INTEGER REFERENCES users(id),
  resolved_at   TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reset_requests_user ON password_reset_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_reset_requests_status ON password_reset_requests(status);

-- Keys for the read-only external intelligence API (e.g. the Sigar Vote
-- integration). Kept separate from the internal login scheme on purpose --
-- this surface hands real people's GPS locations and survey answers to
-- another system, so it gets its own credential and can be revoked without
-- touching anyone's login.
-- Community & Constituency Development projects: what a candidate intends to
-- do, where, and later what actually happened. A project is a PROMISE by
-- default -- status only moves to ongoing/completed when someone says so, so
-- nothing here should be read as work that has started.
--
-- sector/scale/project_name come from the campaign's framework document
-- (data/project-framework.js). project_name may instead be free text when a
-- candidate picks "Something else", which is why it is not constrained here.
CREATE TABLE IF NOT EXISTS projects (
  id             SERIAL PRIMARY KEY,
  candidate_id   INTEGER NOT NULL REFERENCES users(id),
  title          TEXT NOT NULL,
  sector         TEXT NOT NULL,
  scale          TEXT NOT NULL,              -- small|medium|large
  project_name   TEXT NOT NULL,              -- from the framework, or custom
  is_custom      INTEGER NOT NULL DEFAULT 0,
  lga            TEXT NOT NULL,
  ward           TEXT NOT NULL,
  quantity       INTEGER NOT NULL DEFAULT 1,
  status         TEXT NOT NULL DEFAULT 'promised',
  need           TEXT,                       -- problem being addressed
  budget         TEXT,                       -- indicative, free text
  partner        TEXT,                       -- implementing institution
  timeline       TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT
);
CREATE INDEX IF NOT EXISTS idx_projects_candidate ON projects(candidate_id);
CREATE INDEX IF NOT EXISTS idx_projects_geo ON projects(lga, ward);
CREATE INDEX IF NOT EXISTS idx_projects_sector ON projects(sector, scale);

-- One row per pin dropped on the map. The number of sites is the quantity
-- when a candidate places them; a project with no sites keeps a plain count
-- instead, for when the exact spots are not decided yet.
CREATE TABLE IF NOT EXISTS project_sites (
  id         SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  lat        DOUBLE PRECISION NOT NULL,
  lng        DOUBLE PRECISION NOT NULL,
  label      TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_sites_project ON project_sites(project_id);

-- When a project moved, and to what. The projects table carries only the
-- current status and an updated_at, which cannot answer "how many projects
-- started work last week" -- a question the reporting side needs and one that
-- cannot be reconstructed after the fact. Recorded from here onwards.
CREATE TABLE IF NOT EXISTS project_status_events (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  changed_by  INTEGER REFERENCES users(id),
  changed_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_events_project ON project_status_events(project_id);
CREATE INDEX IF NOT EXISTS idx_project_events_day ON project_status_events(changed_at);

-- Optional before/after evidence. Optional on purpose: most projects are
-- promises with nothing yet to photograph.
CREATE TABLE IF NOT EXISTS project_photos (
  id         SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'evidence',  -- before|after|evidence
  caption    TEXT,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_photos_project ON project_photos(project_id);

CREATE TABLE IF NOT EXISTS api_keys (
  id           SERIAL PRIMARY KEY,
  label        TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,
  key_prefix   TEXT NOT NULL,
  created_by   INTEGER REFERENCES users(id),
  created_at   TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at   TEXT
);

-- GRID3 ward boundaries, matched to the ward names in geo.js (see grid3.js).
CREATE TABLE IF NOT EXISTS grid3_wards (
  lga        TEXT NOT NULL,
  ward       TEXT NOT NULL,
  grid3_name TEXT,
  grid3_code TEXT,
  geometry   TEXT NOT NULL,
  lat        DOUBLE PRECISION,
  lng        DOUBLE PRECISION,
  source     TEXT,
  loaded_at  TEXT NOT NULL,
  PRIMARY KEY (lga, ward)
);
`);

  // Additive migrations. Postgres has IF NOT EXISTS for this, so an existing
  // column is a no-op rather than an error to swallow.
  for (const [table, column, type] of [
    ['members', 'bank_verified_name', 'TEXT'],
    ['members', 'bank_verified_at', 'TEXT'],
    ['members', 'bank_verified_source', 'TEXT'],
    // A coordinator is a mobiliser promoted by admin to oversee a ward/LGA
    // (everyone in that area, not just people they personally added) rather
    // than a separate registration tier.
    ['users', 'is_coordinator', 'INTEGER NOT NULL DEFAULT 0'],
    ['users', 'email', 'TEXT'],
    ['disparity_reports', 'lat', 'DOUBLE PRECISION'],
    ['disparity_reports', 'lng', 'DOUBLE PRECISION'],
    ['disparity_reports', 'accuracy', 'DOUBLE PRECISION'],
    ['disparity_reports', 'positives', 'TEXT'],
    // What the submitted proposals carry that the original project form did
    // not: the concrete item and how it is counted, the community rather than
    // just the ward, and who asked for it. See data/project-items.js.
    ['projects', 'contact_person', 'TEXT'],
    ['projects', 'contact_phone', 'TEXT'],
    ['projects', 'request_date', 'TEXT'],
    ['projects', 'target_completion_date', 'TEXT'],
    ['projects', 'item_id', 'TEXT'],
    ['projects', 'unit', 'TEXT'],
    ['projects', 'community', 'TEXT'],
    ['projects', 'community_lat', 'DOUBLE PRECISION'],
    ['projects', 'community_lng', 'DOUBLE PRECISION'],
    ['projects', 'polling_unit', 'TEXT'],
    ['projects', 'requested_by', 'TEXT'],
    ['projects', 'beneficiaries', 'INTEGER'],
    // Set when a row arrived through a bulk upload rather than the form, so a
    // bad import can be found and undone.
    ['projects', 'import_batch', 'TEXT'],
    // A nominee past the candidate's per-polling-unit allowance is recorded,
    // not refused -- see nominations.js. This is what makes the excess
    // countable instead of invisible.
    ['members', 'over_quota', 'INTEGER NOT NULL DEFAULT 0'],
    ['members', 'import_batch', 'TEXT'],
    ['members', 'vin_verification_status', "TEXT NOT NULL DEFAULT 'not_checked'"],
    ['members', 'vin_verification_json', 'TEXT'],
    ['members', 'polling_unit_resolved', 'INTEGER NOT NULL DEFAULT 0'],
    ['members', 'contact_verification_status', "TEXT NOT NULL DEFAULT 'not_called'"],
    ['members', 'contact_verification_notes', 'TEXT'],
    ['members', 'contact_verified_by', 'TEXT'],
    ['members', 'contact_verified_at', 'TEXT'],
    ['members', 'contact_verification_uploaded_at', 'TEXT'],
    ['members', 'contact_verification_uploaded_by', 'INTEGER'],
    // Explicit test flags used by the aggregate-only integration API.
    ['members', 'is_test', 'INTEGER NOT NULL DEFAULT 0'],
    ['users', 'is_test', 'INTEGER NOT NULL DEFAULT 0'],
    ['projects', 'is_test', 'INTEGER NOT NULL DEFAULT 0'],
    ['tasks', 'is_test', 'INTEGER NOT NULL DEFAULT 0'],
    ['submissions', 'is_test', 'INTEGER NOT NULL DEFAULT 0'],
  ]) {
    await db.exec('ALTER TABLE ' + table + ' ADD COLUMN IF NOT EXISTS ' + column + ' ' + type);
  }

  // Keep candidate submissions when their login is deleted. Historical names
  // are copied before detaching the account reference.
  for (const table of ['projects','disparity_reports']) {
    for (const column of ['former_candidate_name','former_candidate_office','former_candidate_scope','former_candidate_username']) {
      await db.exec('ALTER TABLE ' + table + ' ADD COLUMN IF NOT EXISTS ' + column + ' TEXT');
    }
    await db.exec('ALTER TABLE ' + table + ' ALTER COLUMN candidate_id DROP NOT NULL');
  }

  await loadTablesWithId();

  // Office is meaningful only for candidate accounts. Clean up older accounts
  // created before the role-specific office field was enforced.
  await db.prepare("UPDATE users SET office = NULL WHERE role <> 'candidate'").run();
}

// Which tables carry an id column, so .run() knows where RETURNING id applies.
// Must be populated before any insert runs.
async function loadTablesWithId() {
  const rows = await db.prepare(
    "SELECT table_name FROM information_schema.columns "
    + "WHERE table_schema = 'public' AND column_name = 'id'"
  ).all();
  for (const row of rows) tablesWithId.add(String(row.table_name).toLowerCase());
}

export const nowISO = () => new Date().toISOString();
export const period = (d = new Date()) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

export async function audit(userId, actor, action, entity, entityId, detail, ip) {
  // Never rejects. An audit entry is worth a loud log line and no more: losing
  // one must not fail the action it was recording, and must not leave a loose
  // rejection behind for the process guard to catch.
  try {
    await db.prepare(`INSERT INTO audit_log (user_id,actor,action,entity,entity_id,detail,ip,created_at)
              VALUES (?,?,?,?,?,?,?,?)`)
      .run(userId ?? null, actor ?? null, action, entity ?? null,
           entityId ?? null, detail ? JSON.stringify(detail) : null, ip ?? null, nowISO());
  } catch (error) {
    console.error('[audit] could not record "' + action + '":', error?.message || error);
  }
}

export default db;
