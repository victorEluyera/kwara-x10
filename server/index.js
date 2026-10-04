import { wardsInStateConstituency } from './data/ward-constituencies.js';
import {readPdpContacts,importPdpContacts,pdpPromoterOverlap} from './pdp-promoter-overlap.js';
import {clearExternalDashboardCache} from './external-dashboard.js';
import {readContactVerification,contactVerificationImport} from './contact-verification.js';
import { streamCsv } from './csv-export.js';
import {referenceVoterCounts,wardVoterCounts,withReferenceVoters} from './reference-voter-counts.js';
import {attachPdpCounts,pdpCount} from './pdp-counts.js';
import {promoterReassignmentPreview,reassignPromoters} from './reassign-promoters.js';
import {aggregateCache} from './aggregate-cache.js';
import {promoterSourceTotals} from './promoter-sources.js';
import {locationEditPreview,saveMemberLocation} from './member-location-edit.js';
import {nomineeVerificationSummary} from './nominee-verification-summary.js';
import {memberListFilters, memberListOrder} from './member-list-filters.js';
import {lgaCoverageRows} from './lga-coverage.js';
import { networkReport } from './network-report.js';
import {mergeNetworkDuplicates} from './merge-network-duplicates.js';
import { deleteAccount } from './delete-account.js';
import { allCandidateTemplates, itemCostReviewCsv } from './project-downloads.js';
import express from 'express';
import { reportResponseCache } from './report-response-cache.js';
import { candidateFollowUp } from './candidate-follow-up.js';
import { nominationSummary, validateNomination, nominationQuota, nominationUnits }
  from './nominations.js';
import cors from 'cors';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { db, nowISO, period as currentPeriod, audit, initSchema } from './db.js';
import { dashboardReport } from './dashboard-report.js';
import { areaReport } from './area-report.js';
import { taskReport } from './task-report.js';
import { externalRouter, generateApiKey } from './external.js';
import { makeLimiter } from './rate-limit.js';
import { wrap, guardProcess } from './wrap.js';
import { locationInScope, memberScope, scopedLgas, scopedWards, scopeTargets, isGovernor,
  coverageOf } from './scope.js';
import { storePublicFile, warnIfNotDurable } from './storage.js';
import { importGrassrootsOnce } from './seed-grassroots.js';
import { userArea, canTarget, taskAppliesTo } from './task-scope.js';
import {
  wardBoundary, wardPosition, grid3Status, syncFromGrid3, loadFeatures, syncGrid3IfEmpty, lgaView,
} from './grid3.js';
import {
  SCALES, SCALE_IDS, SECTORS, FRAMEWORK, PROJECT_STATUSES, STATUS_IDS, isFrameworkProject,
} from './data/project-framework.js';
import { ITEMS, ITEMS_BY_ID, UNITS, estimatedProjectCost, searchItems,
  unitCostForProject } from './data/project-items.js';
import { COMMUNITY_COUNT, findCommunity, searchCommunities } from './data/communities.js';
import { buildProjectTemplate, projectTemplateCsv, templateFilename }
  from './project-template.js';
import { readProjectUpload, projectKey,
  applyRegisterDuplicates as applyProjectDuplicates } from './project-import.js';
import { buildNomineeTemplate, nomineeTemplateCsv, templateFilename as nomineeFilename }
  from './nominee-template.js';
import { readNomineeUpload, applyRegisterDuplicates, applyVoterRoll, nameKey, personKey,
  rollNameKey } from './nominee-import.js';
import { splitName } from './load-voter-roll.js';
import { applyMemberVerificationReport } from './apply-member-verification.js';
import { verifyExistingMembers } from './live-member-verification.js';
import { memberIssueRow, ISSUE_COLUMNS, memberExportFilters } from './member-issues.js';
import { matchLga } from './grid3.js';
import {
  hashPassword, verifyPassword, issueToken, authenticate, MEMBER_STARTER_PASSWORD,
  requireAdmin, requireRole, tempPassword, referralCode, touchLogin, ADMIN_ROLES,
  normaliseRole, isUnitPromoterRole, isCandidateRole, isGrassrootRole,
} from './auth.js';
import {
  LGAS, WARDS, POLLING_UNITS, SENATORIAL, FEDERAL, STATE_CONST, BANKS, lgasForScope,
  TOTAL_WARDS, TOTAL_POLLING_UNITS,
  hasPollingUnit,
  canonicalLocation,
} from './data/geo.js';
import {
  runChecks, normalisePhone, isValidPhone, loadVoterRoll, voterRollSize, forgetVoterRollSize,
  clearVoterRoll, voterRollBatches, isSimulated, resolveBankAccount,
} from './verify.js';

const MEMBER_STARTER_PASSWORD_HASH = hashPassword(MEMBER_STARTER_PASSWORD);
import {
  LEVEL_CAPS, ACTIVITY_POINTS, NAIRA_PER_POINT, BASELINE_ACTIVATIONS,
  recomputeActivationPoints, eligibility, payroll, awardTaskPoints,
  downlineCounts, pointsBreakdown, taskCompletion,
} from './points.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4000;
// KWARA_UPLOADS lets a host mount a persistent volume for field evidence, the
// same way KWARA_DB relocates the database. Both default to the repo folder.
const UPLOAD_DIR = process.env.KWARA_UPLOADS || path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
const reportResponses = reportResponseCache();
app.use((req, res, next) => {
  if (!['GET','HEAD','OPTIONS'].includes(req.method)) {
    reportResponses.clear(); clearExternalDashboardCache();
    const changesVoterRoll = /^\/api\/admin\/voter-roll(?:\/|$)/.test(req.path);
    if(changesVoterRoll){voterAggregates.clear();wardVoterAggregates.clear();}
    res.on('finish', () => { reportResponses.clear();clearExternalDashboardCache();if(changesVoterRoll){voterAggregates.clear();wardVoterAggregates.clear();} });
  }
  next();
});
const VALID_USER_ROLES = new Set(['superadmin', 'admin', 'campaign_admin', 'candidate', 'unit_promoter', 'grassroot', 'mobiliser']);
const LOGIN_CREATION_ROLES = new Set(['admin', 'campaign_admin', 'superadmin', 'candidate']);
// Auth here is a Bearer token in localStorage, never a cookie, so there is no
// CSRF exposure from allowing cross-origin requests -- this is what makes a
// split deploy (frontend on Vercel, API on Render) safe without extra
// plumbing. ALLOWED_ORIGINS optionally locks it down to specific origins
// (comma-separated, e.g. "https://kwarax10.vercel.app,https://kwarax10.app");
// left unset, every origin is allowed, which is fine given the auth model.
const configuredOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim().replace(/\/$/, ''))
  .filter(Boolean);
const allowedOrigins = new Set(['https://kwarax10.vercel.app', ...configuredOrigins]);
const corsOptions = {
  origin: (origin, callback) => {
    // No lockdown configured: allow everything, as the auth model above
    // intends. This also covers same-origin requests (single-server deploy,
    // local dev) and Vercel preview URLs, which a fixed allowlist would
    // otherwise reject with a 500 and no way in.
    if (!configuredOrigins.length) return callback(null, true);
    if (!origin || allowedOrigins.has(origin.replace(/\/$/, ''))) return callback(null, true);
    // Reject without throwing: an error here would 500 the whole request
    // instead of just omitting CORS headers.
    callback(null, false);
  },
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '2mb' }));

app.use((_req, res, next) => {
  // nosniff is the important one: it stops a browser deciding for itself that
  // an uploaded file is HTML. The rest are cheap hardening.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// Second line of defence behind the extension allowlist above: never render
// an uploaded file inline, always hand it to the browser as a download.
// Nothing displays submission photos in the UI today. If that changes, serve
// the image through an authenticated route rather than dropping this header --
// these files are public to anyone holding the URL.
app.use('/uploads', express.static(UPLOAD_DIR, {
  setHeaders: (res) => res.setHeader('Content-Disposition', 'attachment'),
}));

// Read-only external intelligence API (API-key auth, not the internal JWT
// scheme) -- see server/external.js for what it exposes and why.
app.use('/api/external/v1', externalRouter);

// Uploaded files are served back from this app's own origin, so the
// extension must never be taken from whatever the uploader called the file.
// An .html or .svg upload would otherwise be served as markup and could run
// JavaScript on our origin -- which is where the session token lives.
const ALLOWED_UPLOAD_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.csv', '.txt']);

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _f, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 8)
              + (ALLOWED_UPLOAD_EXT.has(ext) ? ext : '.bin'));
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
});

// The project-list import. Held in memory rather than written to disk: it is
// parsed once and thrown away, and a copy on disk is just someone's project
// list left lying around.
const sheetUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

// wrap/guardProcess live in ./wrap.js so external.js uses the same ones.
const ip = (req) => req.headers['x-forwarded-for'] || req.socket.remoteAddress;
const draftToken = () => crypto.randomBytes(24).toString('base64url');

/* ------------------------------ scope rules ------------------------------ */
// memberScope / scopedLgas / scopedWards live in ./scope.js so they can be
// unit tested -- importing this file would start a server.

// The network is a single field tier: Mobilisers added by admin/candidate.
// A Mobiliser promoted to Coordinator
// supervises their ward/LGA -- see /api/users/:id/coordinator.
function canRegisterLevels(user) {
  if (ADMIN_ROLES.has(normaliseRole(user.role)) || isCandidateRole(user.role)) {
    return ['unit_promoter'];
  }
  if (isUnitPromoterRole(user.role) || isGrassrootRole(user.role)) return ['grassroot'];
  return [];
}

function memberLevel(value) {
  return normaliseRole(value) === 'unit_promoter' ? 'mobiliser'
    : normaliseRole(value) === 'grassroot' ? 'grassroot' : value;
}

function canRegisterLevel(user, level) {
  return canRegisterLevels(user).some((allowed) => normaliseRole(allowed) === normaliseRole(level));
}

function mobiliserPollingUnit(user) {
  if ((!isUnitPromoterRole(user.role) && !isGrassrootRole(user.role)) || Number(user.is_coordinator)) return null;
  const [lga, ward, pollingUnit] = String(user.scope_value || '').split('|');
  return lga && ward && pollingUnit ? { lga, ward, pollingUnit } : null;
}

function registrationLocation(user, body) {
  const own = mobiliserPollingUnit(user);
  return {
    ...body,
    lga: body.lga || own?.lga || 'Not specified',
    ward: body.ward || own?.ward || 'Not specified',
    polling_unit: body.polling_unit || own?.pollingUnit || 'Not specified',
  };
}

/**
 * The member profile a task submission should be recorded against. Only ever
 * the account's own linked member_id, or an explicit member_id the caller is
 * allowed to see (validated by memberScope at the call site) -- never a
 * guess. Guessing by name or phone risks silently attributing a submission to
 * the wrong person when two people share a name, which is worse than simply
 * refusing.
 */
function resolveMemberForSubmission(user, explicitMemberId) {
  const id = Number(explicitMemberId ?? user.member_id ?? 0);
  return id > 0 ? id : null;
}


// Legislative quotas are per polling unit; other allocations are independent.
// Who the Council directive says should see nomination progress and the
// disparities/challenges reports: leadership (admin/superadmin) and the
// Governor specifically -- not other candidates, who only see their own.
const canSeeCompliance = (user) => ADMIN_ROLES.has(normaliseRole(user.role)) || isGovernor(user);
const isDg = (user) => normaliseRole(user.role) === 'campaign_admin';

async function nominationStatus(candidateUserId) {
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(candidateUserId);
  if (!user) return null;
  const nominees = await db.prepare("SELECT lga, ward, polling_unit, status FROM members WHERE upline_user_id = ? AND level = 'mobiliser'").all(candidateUserId);
  return nominationSummary(user, nominees);
}

/* ------------------------------- health --------------------------------- */

// Unauthenticated, so platform health checks (Render, Fly, Cloud Run) get a 200.
// Deliberately exposes no data beyond liveness.
app.get('/api/health', async (_req, res) => {
  try {
    const users = (await db.prepare('SELECT COUNT(*) n FROM users').get()).n;
    res.json({ status: 'ok', seeded: users > 0, uptime: Math.round(process.uptime()) });
  } catch (e) {
    res.status(503).json({ status: 'degraded', error: e.message });
  }
});

/* -------------------------------- auth ---------------------------------- */

app.post('/api/auth/login', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  const name = String(username || '').trim();

  // Checked before the password is verified, so a flood of guesses cannot be
  // used to burn CPU on scrypt either.
  if (tooManyLoginsForAccount(name.toLowerCase()) || tooManyLoginsFromIp(String(ip(req)))) {
    await audit(null, name, 'login_rate_limited', 'user', null, null, ip(req));
    return res.status(429).json({
      error: 'Too many sign-in attempts. Please wait 15 minutes and try again.',
    });
  }

  const user = await db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)')
    .get(name);
  if (user) user.role = normaliseRole(user.role);

  if (!user || !verifyPassword(password || '', user.password_hash)) {
    await audit(null, username, 'login_failed', 'user', null, null, ip(req));
    return res.status(401).json({ error: 'Incorrect username or password' });
  }
  if (user.status !== 'active') {
    return res.status(403).json({ error: 'This account has been suspended' });
  }

  await touchLogin(user.id);
  await audit(user.id, user.username, 'login', 'user', user.id, null, ip(req));
  delete user.password_hash;
  res.json({ token: issueToken(user), user });
}));

// Recorded so the audit trail shows a full session, not just its start --
// also gives the client something genuine to wait for, rather than a
// decorative delay, when it shows a loading state on sign-out.
app.post('/api/auth/logout', authenticate, wrap(async (req, res) => {
  await audit(req.user.id, req.user.username, 'logout', 'user', req.user.id, null, ip(req));
  res.json({ ok: true });
}));

const tooManyForgotAttempts = makeLimiter(60 * 60 * 1000, 6);

// Login needs this more than anything else here: usernames follow a published
// pattern (SEN-<FIRSTNAME>-01 and so on) and accounts are handed out with a
// shared starting password, so an unthrottled login is guessable. Two limits:
// one per account (stops targeting one candidate) and a looser one per IP
// (stops sweeping across many accounts from one place).
// The per-account limit is the one that matters. The per-IP limit is kept
// deliberately loose because Nigerian mobile networks put many real users
// behind one address -- a tight IP limit would lock out a whole ward.
const tooManyLoginsForAccount = makeLimiter(15 * 60 * 1000, 10);
const tooManyLoginsFromIp = makeLimiter(15 * 60 * 1000, 200);

/**
 * Self-service "forgot password". There is no email or SMS provider
 * configured, so this cannot deliver a reset link on its own -- what it
 * safely CAN do is confirm the requester knows the phone number already on
 * file for that account (checked against the login's own phone, or the
 * phone of the member record it is linked to) and put the request in front
 * of an administrator. The response is deliberately identical whether or
 * not anything matched, so this cannot be used to test which usernames
 * exist.
 */
app.post('/api/auth/forgot-password', wrap(async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const phone = normalisePhone(req.body?.phone || '');
  const genericReply = {
    ok: true,
    message: 'If those details match an account, the programme office has '
           + 'been notified and will be in touch with a new password.',
  };

  if (!username || !phone) {
    return res.status(400).json({ error: 'Enter your username and the phone number on the account' });
  }
  const limiterKey = ip(req) + '|' + username.toLowerCase();
  if (tooManyForgotAttempts(limiterKey)) {
    return res.status(429).json({ error: 'Too many attempts. Please wait a while and try again.' });
  }

  const user = await db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)')
    .get(username);
  if (!user || user.status !== 'active') {
    await audit(null, username, 'forgot_password_no_match', 'user', null, null, ip(req));
    return res.json(genericReply);
  }

  let onFile = normalisePhone(user.phone || '');
  if (!onFile && user.member_id) {
    const member = await db.prepare('SELECT phone FROM members WHERE id = ?').get(user.member_id);
    onFile = normalisePhone(member?.phone || '');
  }
  const matched = !!onFile && onFile === phone;

  if (!matched) {
    await audit(user.id, username, 'forgot_password_no_match', 'user', user.id, null, ip(req));
    return res.json(genericReply);
  }

  const existing = await db.prepare(
    "SELECT id FROM password_reset_requests WHERE user_id = ? AND status = 'pending'"
  ).get(user.id);
  if (!existing) {
    await db.prepare(
      'INSERT INTO password_reset_requests (user_id, phone_matched, status, requested_ip, created_at) '
      + "VALUES (?,1,'pending',?,?)"
    ).run(user.id, ip(req), nowISO());
  }
  await audit(user.id, username, 'forgot_password_requested', 'user', user.id, null, ip(req));
  res.json(genericReply);
}));

app.get('/api/admin/password-reset-requests', authenticate, requireAdmin, wrap(async (req, res) => {
  const rows = await db.prepare(
    'SELECT r.*, u.username, u.full_name, u.role, u.office '
    + 'FROM password_reset_requests r JOIN users u ON u.id = r.user_id '
    + "WHERE r.status = 'pending' ORDER BY r.created_at ASC"
  ).all();
  res.json({ rows });
}));

app.post('/api/admin/password-reset-requests/:id/approve', authenticate, requireAdmin, wrap(async (req, res) => {
  const reqRow = await db.prepare("SELECT * FROM password_reset_requests WHERE id = ? AND status = 'pending'")
    .get(req.params.id);
  if (!reqRow) return res.status(404).json({ error: 'That request is no longer pending' });

  const password = tempPassword();
  await db.prepare('UPDATE users SET password_hash = ?, must_reset = 1 WHERE id = ?')
    .run(hashPassword(password), reqRow.user_id);
  await db.prepare(
    "UPDATE password_reset_requests SET status = 'approved', resolved_by = ?, resolved_at = ? WHERE id = ?"
  ).run(req.user.id, nowISO(), reqRow.id);
  await audit(req.user.id, req.user.username, 'password_reset_approved', 'user', reqRow.user_id,
    null, ip(req));
  res.json({ password });
}));

app.post('/api/admin/password-reset-requests/:id/reject', authenticate, requireAdmin, wrap(async (req, res) => {
  const info = await db.prepare(
    "UPDATE password_reset_requests SET status = 'rejected', resolved_by = ?, resolved_at = ? "
    + "WHERE id = ? AND status = 'pending'"
  ).run(req.user.id, nowISO(), req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'That request is no longer pending' });
  await audit(req.user.id, req.user.username, 'password_reset_rejected', null,
    Number(req.params.id), null, ip(req));
  res.json({ ok: true });
}));

const isCoordinator = (user) => !!(isUnitPromoterRole(user.role) && Number(user.is_coordinator));
const canReview = (user) => ADMIN_ROLES.has(normaliseRole(user.role))
  || isCandidateRole(user.role) || isCoordinator(user);

app.get('/api/me', authenticate, wrap(async (req, res) => {
  const role = normaliseRole(req.user.role);
  const caps = LEVEL_CAPS[role] || LEVEL_CAPS[req.user.role] || null;
  const nomination = isCandidateRole(role)
    ? await nominationStatus(req.user.id, req.user.office)
    : null;
  res.json({
    user: { ...req.user, role },
    permissions: {
      is_admin: ADMIN_ROLES.has(role),
      is_coordinator: isCoordinator(req.user),
      is_governor: isGovernor(req.user),
      can_register_levels: canRegisterLevels(req.user),
      can_review: canReview(req.user),
      can_see_compliance: canSeeCompliance(req.user),
      scoped_lgas: scopedLgas(req.user),
    },
    nomination,
    caps,
  });
}));

app.post('/api/auth/change-password', authenticate, wrap(async (req, res) => {
  const { current_password, new_password } = req.body || {};
  const row = await db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(current_password || '', row.password_hash)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  if (!new_password || new_password.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  await db.prepare('UPDATE users SET password_hash = ?, must_reset = 0 WHERE id = ?')
    .run(hashPassword(new_password), req.user.id);
  await audit(req.user.id, req.user.username, 'password_changed', 'user', req.user.id, null, ip(req));
  res.json({ ok: true });
}));

app.patch('/api/auth/profile', authenticate, wrap(async (req, res) => {
  const isCandidateAccount = isCandidateRole(req.user.role);
  const username = isCandidateAccount
    ? req.user.username
    : String(req.body?.username || '').trim().toLowerCase();
  const phone = String(req.body?.phone || '').trim() || null;
  if (!username) return res.status(400).json({ error: 'Username is required' });
  if (!isCandidateAccount && !/^[a-z0-9._-]+$/.test(username)) {
    return res.status(400).json({ error: 'Username may use lowercase letters, numbers, dots, hyphens and underscores' });
  }
  if (!isCandidateAccount) {
    const existing = await db.prepare(
      'SELECT id FROM users WHERE LOWER(username) = ? AND id <> ?'
    ).get(username, req.user.id);
    if (existing) return res.status(409).json({ error: 'That username is already taken' });
  }
  await db.prepare('UPDATE users SET username = ?, phone = ? WHERE id = ?')
    .run(username, phone, req.user.id);
  await audit(req.user.id, req.user.username, 'profile_updated', 'user', req.user.id, null, ip(req));
  res.json({ ok: true, user: { ...req.user, username, phone } });
}));

/* ----------------------------- reference data ---------------------------- */

app.get('/api/geo', authenticate, (req, res) => {
  const allowed = scopedLgas(req.user);
  res.json({
    lgas: allowed,
    all_lgas: LGAS,
    wards: Object.fromEntries(allowed.map((l) => [l, scopedWards(req.user, l)])),
    polling_units: Object.fromEntries(allowed.map((l) => [l, POLLING_UNITS[l]])),
    senatorial: Object.keys(SENATORIAL),
    federal: Object.keys(FEDERAL),
    state_const: Object.keys(STATE_CONST).filter(name => wardsInStateConstituency(name).length),
    pending_state_const: Object.keys(STATE_CONST).filter(name => !wardsInStateConstituency(name).length),
    banks: BANKS,
    totals: { lgas: LGAS.length, wards: TOTAL_WARDS },
    levels: canRegisterLevels(req.user),
    activity_points: ACTIVITY_POINTS,
  });
});

app.get('/api/public/geo', (_req, res) => res.json({
  lgas: LGAS, wards: WARDS, polling_units: POLLING_UNITS, banks: BANKS,
}));

app.get('/api/public/registration/:token', wrap(async (req, res) => {
  const draft = await db.prepare(
    'SELECT data_json,expires_at,completed_at FROM registration_drafts WHERE token = ?'
  ).get(req.params.token);
  if (!draft || draft.completed_at || new Date(draft.expires_at) < new Date()) {
    return res.status(404).json({ error: 'This registration link is invalid, expired, or already completed' });
  }
  res.json({ ...JSON.parse(draft.data_json), expires_at: draft.expires_at });
}));

app.post('/api/registration-drafts', authenticate, wrap(async (req, res) => {
  const b = req.body || {};
  if (!String(b.first_name || '').trim() || !String(b.last_name || '').trim() || !b.level) {
    return res.status(400).json({ error: 'First name, last name, and network position are required' });
  }
  const token = draftToken();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await db.prepare(
    'INSERT INTO registration_drafts (token,creator_user_id,data_json,expires_at,created_at) VALUES (?,?,?,?,?)'
  ).run(token, req.user.id, JSON.stringify({
    first_name: String(b.first_name || '').trim(), last_name: String(b.last_name || '').trim(),
    level: b.level, designation: b.designation || '', lga: b.lga || '', ward: b.ward || '',
  }), expires, nowISO());
  res.status(201).json({ token, expires_at: expires });
}));

app.post('/api/public/registration/:token', wrap(async (req, res) => {
  const draft = await db.prepare(
    'SELECT * FROM registration_drafts WHERE token = ?'
  ).get(req.params.token);
  if (!draft || draft.completed_at || new Date(draft.expires_at) < new Date()) {
    return res.status(404).json({ error: 'This registration link is invalid, expired, or already completed' });
  }
  const b = { ...JSON.parse(draft.data_json), ...(req.body || {}) };
  const level = 'mobiliser';

  const result = await registerMemberRow(b, { level, uplineUserId: draft.creator_user_id });
  if (!result.ok) return res.status(result.status).json(result);

  await db.prepare('UPDATE registration_drafts SET completed_at = ? WHERE id = ?').run(nowISO(), draft.id);
  res.status(201).json(result);
}));

app.post('/api/bank/resolve', authenticate, wrap(async (req, res) => {
  const accountNumber = String(req.body?.account_number || '').replace(/\D/g, '');
  const bankName = String(req.body?.bank_name || '').trim();
  if (!/^\d{10}$/.test(accountNumber)) {
    return res.status(400).json({ error: 'Account number must be exactly 10 digits' });
  }
  if (!bankName) return res.status(400).json({ error: 'Select a bank first' });
  const result = await resolveBankAccount(accountNumber, bankName);
  if (result.status === 'pass') return res.json(result);
  const status = result.status === 'not_configured' ? 503 : 422;
  return res.status(status).json(result);
}));

/* -------------------------------- members -------------------------------- */

const MEMBER_FIELDS = ['first_name', 'last_name', 'phone', 'title', 'designation',
  'pvc_no', 'nin', 'bank_name', 'account_number', 'account_name',
  'lga', 'ward', 'polling_unit', 'level'];

/**
 * Validate, verify-check and insert one member row, then create a matching
 * login for them. Shared by the single-entry form, the bulk table, and the
 * public self-completion link, so all three behave identically and a fix
 * made once applies everywhere.
 *
 * The auto-created login is linked to the new Mobiliser member profile so the
 * account can submit tasks immediately.
 */
async function registerMemberRow(b, opts) {
  const {
    level, uplineUserId, uplineMemberId, force = false, dryRun = false,
    loginUsername, loginPassword, importBatch = null, allowIncomplete = false, allowMissingNames = false, importWarnings = [], requireVin = false,
    allowInvalidNomination = false, allowExternalChecks = true,
    allowUnmatchedVoterRoll = false, verifyWhenReady = false,
  } = opts;

  for (const f of (allowMissingNames ? [] : allowIncomplete ? ['first_name', 'last_name'] : ['first_name', 'last_name', 'phone'])) {
    if (!String(b[f] || '').trim()) {
      return { ok: false, status: 400, error: 'Missing required field: ' + f.replace(/_/g, ' ') };
    }
  }

  const payload = {
    first_name: String(b.first_name || '').trim(),
    last_name: String(b.last_name || '').trim(),
    phone: allowIncomplete && !isValidPhone(b.phone)
      ? String(b.phone || '').trim() : normalisePhone(b.phone),
    title: b.title || null,
    designation: b.designation || null,
    pvc_no: b.pvc_no ? String(b.pvc_no).toUpperCase().replace(/\s/g, '') : null,
    nin: b.nin ? String(b.nin).replace(/\D/g, '') : null,
    bank_name: b.bank_name || null,
    account_number: b.account_number ? String(b.account_number).replace(/\D/g, '') : null,
    account_name: b.account_name || null,
    lga: b.lga || 'Not specified',
    ward: b.ward || 'Not specified',
    polling_unit: String(b.polling_unit || 'Not specified').trim(),
    lat: b.lat ?? null, lng: b.lng ?? null, accuracy: b.accuracy ?? null,
  };

  if (requireVin && !payload.pvc_no) return {ok:false,status:400,error:'VIN is missing - not registered'};
  Object.assign(payload, canonicalLocation(payload));
  const result = await runChecks(payload, { uplineUserId, external: allowExternalChecks });
  if (importWarnings.length) {
    result.checks.import_warnings = { status: 'needs_review', messages: importWarnings };
    result.flags.push(...importWarnings.map(message => ({code:'import_warning',weight:0,message})));
  }
  if (dryRun) return { ok: true, preview: true, ...result };

  // Candidate nominees may be saved without a voter-roll match; their checks
  // still retain the mismatch for later review.
  const hardFail = result.flags.some((f) =>
    f.code === 'duplicate'
      || (!allowIncomplete && f.code === 'format')
      || (!allowIncomplete && !allowUnmatchedVoterRoll && f.code === 'voter_roll_missing'));
  if (hardFail && !force) {
    return {
      ok: false, status: 409, error: 'This entry did not pass validation',
      flags: result.flags, checks: result.checks, risk_score: result.riskScore,
    };
  }

  return db.transaction(async (tx) => {
    // Read, not locked. The FOR UPDATE was here to make the quota decision
    // atomic -- so two people being added at once could not both slip under
    // the cap. The cap is no longer a refusal (see nominations.js: going over
    // is recorded and flagged), so there is nothing left to serialise, and
    // every row of a bulk upload was queueing behind the same candidate's user
    // row. Four workers waiting on one lock is one worker.
    const owner = uplineUserId
      ? await tx.prepare('SELECT * FROM users WHERE id = ?').get(uplineUserId) : null;
    let overQuota = 0;
    let quotaWarning = null;
    if (level === 'mobiliser') {
      const verdict = await validateNomination(tx, owner, payload);
      // A bad location is still refused; going past the allowance is not.
      if (verdict?.error && !allowInvalidNomination) return verdict;
      if (verdict?.over_quota) { overQuota = 1; quotaWarning = verdict.warning; }
    }
    const code = referralCode('KWARA');
    const info = await tx.prepare(
      'INSERT INTO members (code,first_name,last_name,phone,title,designation,pvc_no,nin,'
      + 'bank_name,account_number,account_name,lga,ward,polling_unit,level,'
      + 'upline_user_id,upline_member_id,lat,lng,accuracy,captured_at,status,'
      + 'checks_json,risk_score,risk_flags,over_quota,import_batch,created_at,polling_unit_resolved) '
      + 'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ).run(code, payload.first_name, payload.last_name, payload.phone, payload.title,
      payload.designation, payload.pvc_no, payload.nin, payload.bank_name,
      payload.account_number, payload.account_name, payload.lga, payload.ward,
      payload.polling_unit, level, uplineUserId || null, uplineMemberId || null,
      payload.lat, payload.lng, payload.accuracy, payload.lat != null ? nowISO() : null,
      verifyWhenReady ? 'verified' : result.riskScore >= 50 ? 'flagged' : 'pending',
      JSON.stringify(result.checks), result.riskScore, JSON.stringify(result.flags),
      overQuota, importBatch || null, nowISO(), Number(hasPollingUnit(payload)));

    const id = Number(info.lastInsertRowid);
    const password = loginPassword || MEMBER_STARTER_PASSWORD;
    const username = loginUsername || 'member.' + id;
    const loginRole = level === 'grassroot' ? 'grassroot' : 'mobiliser';
    await tx.prepare(
      'INSERT INTO users (username,password_hash,must_reset,role,full_name,phone,scope_type,scope_value,member_id,status,created_at) '
      + 'VALUES (?,?,?,?,?,?,?,?,?,?,?)'
    ).run(username, password === MEMBER_STARTER_PASSWORD
      ? MEMBER_STARTER_PASSWORD_HASH : hashPassword(password), 1, loginRole,
      payload.first_name + ' ' + payload.last_name, payload.phone, 'polling_unit',
      payload.lga + '|' + payload.ward + '|' + payload.polling_unit, id, 'active', nowISO());

    return {
      ok: true, id, code, name: payload.first_name + ' ' + payload.last_name,
      status: verifyWhenReady ? 'verified' : result.riskScore >= 50 ? 'flagged' : 'pending',
      over_quota: overQuota === 1, quota_warning: quotaWarning,
      login: { username, password },
      risk_score: result.riskScore, flags: result.flags, checks: result.checks,
    };
  });
}

app.post('/api/members', authenticate, wrap(async (req, res) => {
  const b = registrationLocation(req.user, req.body || {});
  const level = memberLevel(b.level || canRegisterLevels(req.user)[0]);
  const delegatedCandidateId = Number(b.candidate_id || 0);
  const isDelegatedNomination = level === 'mobiliser' && delegatedCandidateId > 0;
  let nominationOwner = req.user;

  if (level === 'mobiliser' && isDg(req.user) && !delegatedCandidateId) {
    return res.status(400).json({ error: 'Select the candidate this nominee is being added for' });
  }

  if (isDelegatedNomination) {
    if (normaliseRole(req.user.role) !== 'campaign_admin') {
      return res.status(403).json({ error: 'Only the DG can nominate on behalf of a candidate' });
    }
    nominationOwner = await db.prepare(
      "SELECT id, role, office, member_id FROM users WHERE id = ? AND role = 'candidate' AND status = 'active'"
    ).get(delegatedCandidateId);
    if (!nominationOwner) return res.status(404).json({ error: 'Candidate not found' });
  }

  if (!canRegisterLevel(req.user, level)) {
    return res.status(403).json({ error: 'You cannot register members at the "' + level + '" level' });
  }
  if (isCandidateRole(req.user.role) && !locationInScope(req.user, b)) {
    return res.status(403).json({ error: 'That location is outside your constituency' });
  }
  if (b.lga && b.lga !== 'Not specified' && !scopedLgas(req.user).includes(b.lga)) {
    return res.status(403).json({ error: b.lga + ' is outside your constituency' });
  }
  const ownPollingUnit = mobiliserPollingUnit(req.user);
  if (ownPollingUnit && (b.lga !== ownPollingUnit.lga
      || b.ward !== ownPollingUnit.ward
      || b.polling_unit !== ownPollingUnit.pollingUnit)) {
    return res.status(403).json({ error: 'Field users can only register people in their own polling unit' });
  }

  const result = await registerMemberRow(b, {
    level, uplineUserId: nominationOwner.id, uplineMemberId: nominationOwner.member_id,
    force: req.query.force === '1', dryRun: req.query.dry_run === '1',
    allowUnmatchedVoterRoll: level === 'mobiliser'
      && (isCandidateRole(req.user.role) || isDelegatedNomination),
    verifyWhenReady: level === 'mobiliser'
      && (isCandidateRole(req.user.role) || isDelegatedNomination),
  });

  if (result.preview) return res.json(result);
  if (!result.ok) return res.status(result.status).json(result);

  await audit(req.user.id, req.user.username, 'member_registered', 'member', result.id,
    { code: result.code, level, lga: b.lga, risk: result.risk_score }, ip(req));
  res.status(201).json(result);
}));

/**
 * Register many people from one table in a single request. Rows are
 * processed independently -- one bad row (a duplicate phone, a validation
 * failure) does not block the others. The level and location apply to the
 * whole batch since that is almost always what is being entered (one
 * mobiliser adding everyone from their own polling unit), but a row may
 * override lga/ward/polling_unit if it needs to.
 */
/* ----------------------- nominee list: out and back ----------------------- */

/**
 * Whose list this is: the candidate themselves, or an admin acting for them.
 *
 * Lists arrive on paper and in other people's spreadsheets, and it is often
 * the programme office holding them rather than the candidate. `?candidate_id=`
 * says who the list belongs to; the rows are then scoped, quota-checked and
 * attributed to that candidate exactly as if they had uploaded it themselves,
 * and the audit entry records who actually did.
 *
 * Stakeholders and the Deputy Governor are candidate accounts too, so they are
 * covered by the same path.
 */
async function listOwner(req) {
  const delegated = Number(req.query.candidate_id || 0);
  if (!delegated) return isCandidateRole(req.user.role) ? req.user : null;
  if (normaliseRole(req.user.role) !== 'campaign_admin'
      && !ADMIN_ROLES.has(normaliseRole(req.user.role))) return null;
  return db.prepare(
    "SELECT * FROM users WHERE id = ? AND role = 'candidate' AND status = 'active'"
  ).get(delegated);
}

/** Kept for the nominee routes, which read better with the specific name. */
const nomineeOwner = listOwner;

/**
 * The blank nominee spreadsheet, built for one candidate: their LGAs, their
 * wards and their polling units, and their own allowance written on the front.
 */
app.get('/api/members/template.:extension(xlsx|csv)', authenticate, wrap(async (req, res) => {
  const owner = await nomineeOwner(req);
  if (!owner) return res.status(403).json({ error: 'Only a candidate has a nominee list' });

  const who = owner.full_name || owner.scope_value || owner.username;
  if (req.params.extension === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',
      'attachment; filename="' + nomineeFilename(who, 'csv') + '"');
    return res.send(nomineeTemplateCsv());
  }

  const lgas = scopedLgas(owner);
  if (!lgas.length) return res.status(403).json({ error: 'That candidate has no area assigned' });

  res.setHeader('Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="' + nomineeFilename(who) + '"');
  res.send(buildNomineeTemplate({
    lgas, units: nominationUnits(owner), who, office: owner.office,
    quota: nominationQuota(owner.office),
    // With a register loaded there is no way to accept a nominee without one.
    requireVin: (await voterRollSize()) > 0,
  }));
}));

/**
 * The filled-in nominee list, coming back.
 *
 * Checked before it is saved, like the project list. Rows past the candidate's
 * allowance are counted and marked but never refused -- the register is meant
 * to show who is actually on the ground, and a fifth nominee recorded and
 * flagged is worth more than one left off or hidden under the next unit along.
 */
/**
 * What of an uploaded list is already on the register.
 *
 * Only the identifiers the file actually contains are looked up -- the members
 * table holds hundreds of thousands of rows and must not be pulled into memory
 * to answer this. Phone, NIN, PVC and account are checked against everybody,
 * because those belong to one person nationally; name is checked against this
 * candidate's own list, since names repeat and only the combination of a name
 * and a polling unit says anything.
 */
async function registerLookup(rows, candidateId) {
  const lookup = {
    phone: new Map(), nin: new Map(), pvc: new Map(), account: new Map(),
    name: new Map(), person: new Map(),
  };
  const wanted = { phone: new Set(), nin: new Set(), pvc_no: new Set(), account_number: new Set() };
  for (const row of rows) {
    if (!row.nominee) continue;
    for (const field of Object.keys(wanted)) {
      if (row.nominee[field]) wanted[field].add(row.nominee[field]);
    }
  }

  const CHUNK = 500;
  for (const [field, target] of [['phone', 'phone'], ['nin', 'nin'],
    ['pvc_no', 'pvc'], ['account_number', 'account']]) {
    const values = [...wanted[field]];
    for (let i = 0; i < values.length; i += CHUNK) {
      const slice = values.slice(i, i + CHUNK);
      const found = await db.prepare(
        'SELECT id, code, first_name, last_name, ' + field + ' AS value FROM members '
        + 'WHERE ' + field + ' IN (' + slice.map(() => '?').join(',') + ") "
        + "AND status <> 'rejected'"
      ).all(...slice);
      for (const m of found) lookup[target].set(String(m.value), m);
    }
  }

  // The candidate's own people, for the name checks.
  const mine = await db.prepare(
    'SELECT id, code, first_name, last_name, polling_unit FROM members '
    + "WHERE upline_user_id = ? AND level = 'mobiliser' AND status <> 'rejected'"
  ).all(candidateId);
  for (const m of mine) {
    lookup.name.set(nameKey(m.first_name, m.last_name, m.polling_unit), m);
    if (!lookup.person.has(personKey(m.first_name, m.last_name))) {
      lookup.person.set(personKey(m.first_name, m.last_name), m);
    }
  }

  return lookup;
}

/**
 * The INEC entries for the VINs in an uploaded list, or null when no register
 * has been loaded.
 *
 * Looked up by the VINs the file contains rather than read whole: the Kwara
 * register is 3.27 million rows, and the answer needed here is only "are
 * these two hundred in it".
 */
async function voterRollLookup(rows) {
  if (await voterRollSize() === 0) return null;
  const CHUNK = 500;
  const candidates = rows.filter((r) => r.nominee);

  const wanted = [...new Set(candidates
    .filter((r) => r.nominee.pvc_no)
    .map((r) => r.nominee.pvc_no.toUpperCase()))];

  const byVin = new Map();
  for (let i = 0; i < wanted.length; i += CHUNK) {
    const slice = wanted.slice(i, i + CHUNK);
    const hits = await db.prepare(
      'SELECT vin, first_name, last_name, lga, ward, polling_unit FROM voter_roll '
      + 'WHERE vin IN (' + slice.map(() => '?').join(',') + ')'
    ).all(...slice);
    for (const hit of hits) byVin.set(String(hit.vin).toUpperCase(), hit);
  }

  // For the rows the VIN did not answer for, ask the other way round: who does
  // the register have of that surname, in that polling unit? A mistyped VIN is
  // commoner than a fabricated nominee, and a candidate told "not found" with
  // nothing else has no way to tell the two apart.
  const unmatched = candidates.filter((r) =>
    !r.nominee.pvc_no || !byVin.has(r.nominee.pvc_no.toUpperCase()));

  const byName = new Map();
  if (unmatched.length) {
    const surnames = [...new Set(unmatched.map((r) => String(r.nominee.last_name || '')
      .toLowerCase()).filter(Boolean))];
    const units = [...new Set(unmatched.map((r) => r.nominee.polling_unit).filter(Boolean))];

    for (let i = 0; i < surnames.length; i += CHUNK) {
      const slice = surnames.slice(i, i + CHUNK);
      if (!units.length) break;
      const hits = await db.prepare(
        'SELECT vin, first_name, last_name, lga, ward, polling_unit FROM voter_roll '
        + 'WHERE LOWER(last_name) IN (' + slice.map(() => '?').join(',') + ') '
        + 'AND polling_unit IN (' + units.map(() => '?').join(',') + ') LIMIT 5000'
      ).all(...slice, ...units);

      for (const hit of hits) {
        const key = rollNameKey(hit.last_name, hit.polling_unit);
        if (!byName.has(key)) byName.set(key, []);
        byName.get(key).push(hit);
      }
    }
  }

  return { byVin, byName };
}

const nomineeImportProgress = new Map();

function updateNomineeImportProgress(id, userId, progress) {
  if (!id) return;
  const now = Date.now();
  for (const [key, value] of nomineeImportProgress) {
    if (value.expiresAt <= now) nomineeImportProgress.delete(key);
  }
  nomineeImportProgress.set(id, {
    userId, ...progress, expiresAt: now + 10 * 60 * 1000,
  });
}

app.get('/api/members/import-progress/:id', authenticate, wrap(async (req, res) => {
  const progress = nomineeImportProgress.get(req.params.id);
  if (progress && progress.expiresAt <= Date.now()) nomineeImportProgress.delete(req.params.id);
  if (!progress || progress.expiresAt <= Date.now()
      || Number(progress.userId) !== Number(req.user.id)) {
    return res.status(404).json({ error: 'Import progress not found' });
  }
  res.json({ phase: progress.phase, done: progress.done, total: progress.total,
    percentage: progress.percentage, message: progress.message });
}));

app.post('/api/members/import', authenticate, sheetUpload.single('file'), wrap(async (req, res) => {
  const owner = await nomineeOwner(req);
  if (!owner) return res.status(403).json({ error: 'Only a candidate has a nominee list' });
  if (!req.file?.buffer?.length) {
    return res.status(400).json({ error: 'Attach the filled-in spreadsheet' });
  }
  const confirm = req.query.confirm === '1' || req.query.confirm === 'true';
  const progressId = /^[0-9a-f-]{36}$/i.test(String(req.query.progress_id || ''))
    ? String(req.query.progress_id) : null;
  if (confirm) updateNomineeImportProgress(progressId, req.user.id, {
    phase: 'checking', done: 0, total: 0, percentage: 2,
    message: 'Checking the nominee list',
  });

  const lgas = scopedLgas(owner);
  if (!lgas.length) return res.status(403).json({ error: 'That candidate has no area assigned' });
  const wardsByLga = Object.fromEntries(lgas.map((l) => [l, scopedWards(owner, l)]));

  // What is already on the register, so the allowance is judged against the
  // whole list rather than against this file alone.
  const existing = await db.prepare(
    "SELECT lga, ward, polling_unit, COUNT(*) AS n FROM members "
    + "WHERE upline_user_id = ? AND level = 'mobiliser' AND status <> 'rejected' "
    + 'GROUP BY lga, ward, polling_unit'
  ).all(owner.id);
  const existingCounts = new Map(
    existing.map((r) => [[r.lga, r.ward, r.polling_unit].join('|'), Number(r.n)]));

  const quota = nominationQuota(owner.office);

  let verdict;
  try {
    verdict = readNomineeUpload(req.file.buffer, req.file.originalname || '',
      { lgas, wardsByLga, quota, existingCounts, acceptIssues: true, requireVin: true });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  if (verdict.error) return res.status(400).json({ error: verdict.error, summary: verdict.summary });

  // Nobody already on the register gets added a second time. Checked here,
  // before anything is saved, so the count the candidate is shown is the count
  // they will get -- rather than "6 ready" followed by four silent failures.
  verdict = applyRegisterDuplicates(verdict, await registerLookup(verdict.rows, owner.id),
    { quota, existingCounts });

  // And nobody goes on the list whose VIN is not in the INEC register, once
  // one has been loaded.
  verdict = applyVoterRoll(verdict, await voterRollLookup(verdict.rows),
    { quota, existingCounts, allowUnverified: true });

  const skipInvalid = req.query.skip_invalid === '1' || req.query.skip_invalid === 'true';

  if (!confirm) {
    return res.json({ ...verdict, committed: 0,
      message: verdict.ok
        ? 'Nothing saved yet. Send it again with confirm=1 to add these people.'
        : 'Nothing saved yet. Saving will register non-duplicate rows, including rows with issues; duplicates and rows without VIN are excluded.' });
  }
  if (!verdict.ok && !skipInvalid && !verdict.rows.every(row => !row.errors.length || row.duplicate || row.missing_vin)) {
    return res.status(422).json({ ...verdict, committed: 0,
      error: verdict.summary.invalid + ' row(s) have problems. Fix them, or resend with '
        + 'skip_invalid=1 to add only the rows that are correct.' });
  }

  const good = verdict.rows.filter((r) => r.nominee && !r.errors.length);
  if (!good.length) return res.status(422).json({ ...verdict, committed: 0, error: 'Nothing to import' });

  // Keep the per-row save boundary so a bad row cannot discard good ones, but
  // overlap independent checks and avoid external provider calls during import.
  const batch = crypto.randomUUID();
  const loginsByRow = new Array(good.length);
  const failuresByRow = new Array(good.length);
  let processed = 0;
  updateNomineeImportProgress(progressId, req.user.id, {
    phase: 'saving', done: 0, total: good.length, percentage: 5,
    message: `Adding nominees: 0 of ${good.length}`,
  });
  let nextRow = 0;
  const saveWorker = async () => {
    while (nextRow < good.length) {
      const index = nextRow++;
      const row = good[index];
      try {
        const result = await registerMemberRow(row.nominee, {
          level: 'mobiliser', uplineUserId: owner.id, uplineMemberId: owner.member_id,
          importBatch: batch, allowIncomplete: true, allowMissingNames: true, importWarnings: row.warnings, requireVin: true, allowInvalidNomination: true,
          allowExternalChecks: false, verifyWhenReady: true,
        });
        if (result.ok) {
          loginsByRow[index] = { line: row.line, name: result.name, code: result.code,
            over_quota: Boolean(result.over_quota), ...result.login };
        } else {
          failuresByRow[index] = { line: row.line, error: result.error, flags: result.flags || [] };
        }
      } catch (error) {
        failuresByRow[index] = { line: row.line, error: 'Could not be saved: ' + error.message };
      }
      processed++;
      updateNomineeImportProgress(progressId, req.user.id, {
        phase: 'saving', done: processed, total: good.length,
        percentage: 5 + Math.floor((processed / good.length) * 94),
        message: `Adding nominees: ${processed} of ${good.length}`,
      });
    }
  };
  // Six, not four: each worker holds one pooled connection for the length of
  // its transaction, and the pool is ten. Four left the pool half idle; more
  // than six would starve everything else the app is serving at the time.
  const workers = Math.min(Number(process.env.IMPORT_WORKERS) || 6, good.length);
  await Promise.all(Array.from({ length: workers }, saveWorker));
  const logins = loginsByRow.filter(Boolean);
  const failed = failuresByRow.filter(Boolean);

  await audit(req.user.id, req.user.username, 'nominees_imported', 'user', owner.id,
    { batch, committed: logins.length, rejected: failed.length,
      over_quota: logins.filter((l) => l.over_quota).length,
      duplicates: verdict.summary.duplicates,
      file: req.file.originalname || null }, ip(req));

  updateNomineeImportProgress(progressId, req.user.id, {
    phase: 'complete', done: good.length, total: good.length, percentage: 100,
    message: `Finished: ${logins.length} added`,
  });

  res.status(201).json({ ...verdict, committed: logins.length, batch, logins, failed });
}));

app.post('/api/members/bulk', authenticate, wrap(async (req, res) => {
  const b = registrationLocation(req.user, req.body || {});
  const level = memberLevel(b.level || canRegisterLevels(req.user)[0]);
  const rows = Array.isArray(b.rows) ? b.rows : [];
  const delegatedCandidateId = Number(b.candidate_id || 0);
  let nominationOwner = req.user;

  if (level === 'mobiliser' && isDg(req.user) && !delegatedCandidateId) {
    return res.status(400).json({ error: 'Select the candidate this nominee is being added for' });
  }

  if (level === 'mobiliser' && delegatedCandidateId > 0) {
    if (normaliseRole(req.user.role) !== 'campaign_admin') {
      return res.status(403).json({ error: 'Only the DG can nominate on behalf of a candidate' });
    }
    nominationOwner = await db.prepare(
      "SELECT id, role, office, member_id FROM users WHERE id = ? AND role = 'candidate' AND status = 'active'"
    ).get(delegatedCandidateId);
    if (!nominationOwner) return res.status(404).json({ error: 'Candidate not found' });

  }

  if (!canRegisterLevel(req.user, level)) {
    return res.status(403).json({ error: 'You cannot register members at the "' + level + '" level' });
  }
  if (!rows.length) return res.status(400).json({ error: 'No rows to save' });
  if (rows.length > 200) return res.status(400).json({ error: 'Save at most 200 rows at a time' });

  const results = [];
  for (const row of rows) {
    const merged = registrationLocation(req.user, { ...b, ...row, level: undefined });
    if (isCandidateRole(req.user.role) && !locationInScope(req.user, merged)) {
      results.push({ ok: false, status: 403, error: 'That location is outside your constituency',
        input: row });
      continue;
    }
    if (merged.lga && merged.lga !== 'Not specified' && !scopedLgas(req.user).includes(merged.lga)) {
      results.push({ ok: false, status: 403, error: merged.lga + ' is outside your constituency',
        input: row });
      continue;
    }
    const ownPollingUnit = mobiliserPollingUnit(req.user);
    if (ownPollingUnit && (merged.lga !== ownPollingUnit.lga
        || merged.ward !== ownPollingUnit.ward
        || merged.polling_unit !== ownPollingUnit.pollingUnit)) {
      results.push({ ok: false, status: 403,
        error: 'Field users can only register people in their own polling unit', input: row });
      continue;
    }
    const r = await registerMemberRow(merged, {
      level, uplineUserId: nominationOwner.id, uplineMemberId: nominationOwner.member_id,
      force: req.query.force === '1',
    });
    if (!r.ok) r.input = row;
    results.push(r);
  }

  const created = results.filter((r) => r.ok);
  await audit(req.user.id, req.user.username, 'members_bulk_registered', null, null,
    { level, submitted: rows.length, created: created.length }, ip(req));

  res.status(created.length ? 201 : 400).json({
    created: created.length, failed: results.length - created.length, rows: results,
  });
}));

app.post('/api/members/:id/login', authenticate, wrap(async (req, res) => {
  const scope = memberScope(req.user);
  const member = await db.prepare(
    'SELECT * FROM members WHERE id = ? AND (' + scope.sql + ')'
  ).get(req.params.id, ...scope.params);
  if (!member) return res.status(404).json({ error: 'Member not found in your permitted area' });
  const isAdmin = ADMIN_ROLES.has(normaliseRole(req.user.role));
  const ownsMember = isCandidateRole(req.user.role)
    && Number(member.upline_user_id) === Number(req.user.id);
  if (!isAdmin && !ownsMember) {
    return res.status(403).json({ error: 'Only the owning candidate or an administrator can create this login' });
  }

  const existing = await db.prepare('SELECT username FROM users WHERE member_id = ?').get(member.id);
  if (existing) return res.status(409).json({ error: 'This member already has a login', username: existing.username });

  const password = MEMBER_STARTER_PASSWORD;
  const username = 'member.' + member.id;
  const role = member.level;
  const scopeType = 'polling_unit';
  const scopeValue = member.lga + '|' + member.ward + '|' + member.polling_unit;

  await db.prepare(
    'INSERT INTO users (username,password_hash,must_reset,role,full_name,phone,scope_type,scope_value,member_id,status,created_at) '
    + 'VALUES (?,?,?,?,?,?,?,?,?,?,?)'
  ).run(username, MEMBER_STARTER_PASSWORD_HASH, 1, role, member.first_name + ' ' + member.last_name,
    member.phone, scopeType, scopeValue, member.id, 'active', nowISO());
  await audit(req.user.id, req.user.username, 'member_login_created', 'member', member.id,
    { username, role }, ip(req));
  res.status(201).json({ username, password, role });
}));

/* --------------------- nominations & compliance reporting --------------------- */

/**
 * Every candidate covered by the nomination directive, with their Unit
 * Promoter progress and their nominees -- so leadership can see not just a
 * count but who was actually nominated, matching the Council's ask for
 * "detailed information" on each nominee.
 */
app.get('/api/nominations', authenticate, wrap(async (req, res) => {
  if (!canSeeCompliance(req.user)) {
    return res.status(403).json({ error: 'You cannot view nomination compliance' });
  }
  const candidates = await db.prepare(
    "SELECT id, username, full_name, office, scope_type, scope_value FROM users "
    + "WHERE role = 'candidate' AND office IN ('Senator','Senatorial','House of Representatives','House of Assembly','State Assembly','Deputy Governor','Stakeholder') "
    + 'ORDER BY office, full_name'
  ).all();

  const nominees = await db.prepare(
    "SELECT id, code, first_name, last_name, lga, ward, polling_unit, pvc_no, "
    + "bank_name, account_number, status, upline_user_id "
    + "FROM members WHERE level = 'mobiliser' "
    + 'ORDER BY created_at'
  ).all();
  const byUpline = new Map();
  for (const n of nominees) {
    if (!byUpline.has(n.upline_user_id)) byUpline.set(n.upline_user_id, []);
    byUpline.get(n.upline_user_id).push(n);
  }

  const rows = candidates.map((c) => {
    const list = byUpline.get(c.id) || [];
    const summary = nominationSummary(c, list);
    return {
      id: c.id, username: c.username, full_name: c.full_name,
      office: c.office, scope_value: c.scope_value,
      lgas: lgasForScope(c.scope_type, c.scope_value),
      ...summary,
      nominees: list,
    };
  });

  res.json({
    rows,
    summary: {
      candidates: rows.length,
      complete: rows.filter((r) => r.complete).length,
      incomplete: rows.filter((r) => !r.unlimited && !r.complete).length,
      unlimited: rows.filter((r) => r.unlimited).length,
      total_remaining: rows.reduce((a, r) => a + (r.remaining || 0), 0),
      total_nominated: rows.reduce((a, r) => a + (r.total_count ?? r.count ?? 0), 0),
      unlimited_nominated: rows.filter((r) => r.unlimited).reduce((a, r) => a + r.count, 0),
      total_required: rows.reduce((a, r) => a + r.quota, 0),
    },
  });
}));

/** A candidate's own current disparities/challenges report, or null. */
app.get('/api/disparity-report', authenticate, wrap(async (req, res) => {
  if (!isCandidateRole(req.user.role) && !isUnitPromoterRole(req.user.role)
      && !isGrassrootRole(req.user.role)) {
    return res.status(403).json({ error: 'This account cannot submit a field report' });
  }
  const row = await db.prepare('SELECT * FROM disparity_reports WHERE candidate_id = ?')
    .get(req.user.id);
  res.json({ report: row || null });
}));

app.post('/api/disparity-report', authenticate, wrap(async (req, res) => {
  if (!isCandidateRole(req.user.role) && !isUnitPromoterRole(req.user.role)
      && !isGrassrootRole(req.user.role)) {
    return res.status(403).json({ error: 'This account cannot submit a field report' });
  }
  const disparities = String(req.body?.disparities || '').trim();
  const challenges = String(req.body?.challenges || '').trim();
  const positives = String(req.body?.positives || '').trim();
  const lat = req.body?.lat == null ? null : Number(req.body.lat);
  const lng = req.body?.lng == null ? null : Number(req.body.lng);
  const accuracy = req.body?.accuracy == null ? null : Number(req.body.accuracy);
  if (!disparities && !challenges && !positives) {
    return res.status(400).json({ error: 'Describe at least one disparity, challenge, or positive progress item' });
  }

  const existing = await db.prepare('SELECT id FROM disparity_reports WHERE candidate_id = ?')
    .get(req.user.id);
  if (existing) {
    await db.prepare(
      'UPDATE disparity_reports SET disparities = ?, challenges = ?, positives = ?, updated_at = ?, '
      + 'lat = ?, lng = ?, accuracy = ?, reviewed_by = NULL, reviewed_at = NULL, review_note = NULL '
      + 'WHERE candidate_id = ?'
    ).run(disparities, challenges, positives, nowISO(), lat, lng, accuracy, req.user.id);
  } else {
    await db.prepare(
      'INSERT INTO disparity_reports (candidate_id, disparities, challenges, positives, lat, lng, accuracy, submitted_at) '
      + 'VALUES (?,?,?,?,?,?,?,?)'
    ).run(req.user.id, disparities, challenges, positives, lat, lng, accuracy, nowISO());
  }
  await audit(req.user.id, req.user.username, 'disparity_report_submitted', 'user', req.user.id,
    null, ip(req));
  const row = await db.prepare('SELECT * FROM disparity_reports WHERE candidate_id = ?')
    .get(req.user.id);
  res.status(existing ? 200 : 201).json({ report: row });
}));

app.get('/api/admin/disparity-reports', authenticate, wrap(async (req, res) => {
  if (!canSeeCompliance(req.user)) {
    return res.status(403).json({ error: 'You cannot view these reports' });
  }
  const rows = await db.prepare(
    'SELECT r.*, COALESCE(u.full_name,r.former_candidate_name) candidate_name, COALESCE(u.office,r.former_candidate_office) office, COALESCE(u.scope_value,r.former_candidate_scope) scope_value, COALESCE(u.username,r.former_candidate_username) candidate_username '
    + 'FROM disparity_reports r LEFT JOIN users u ON u.id = r.candidate_id '
    + 'ORDER BY r.submitted_at DESC'
  ).all();
  res.json({ rows });
}));

app.post('/api/admin/disparity-reports/:id/review', authenticate, wrap(async (req, res) => {
  if (!canSeeCompliance(req.user)) {
    return res.status(403).json({ error: 'You cannot review these reports' });
  }
  const note = req.body?.note ? String(req.body.note).trim() : null;
  await db.prepare(
    'UPDATE disparity_reports SET reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?'
  ).run(req.user.id, nowISO(), note, req.params.id);
  await audit(req.user.id, req.user.username, 'disparity_report_reviewed', null,
    Number(req.params.id), { note }, ip(req));
  res.json({ ok: true });
}));

/* ------------------ community & constituency projects -------------------- */

// Kwara State's bounding box, generously drawn. A pin outside it is a mistake
// -- a mistyped coordinate or a phone reporting a bogus fix -- not a project.
const KWARA_BOUNDS = { minLat: 7.7, maxLat: 10.2, minLng: 2.7, maxLng: 6.3 };

const PROJECT_PHOTO_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic']);

/** Candidates own projects; oversight sees every one of them. */
const canSeeAllProjects = (user) => canSeeCompliance(user);

function validateSites(raw) {
  if (!Array.isArray(raw)) return { sites: [], error: null };
  const sites = [];
  for (const s of raw.slice(0, 200)) {
    const lat = Number(s?.lat);
    const lng = Number(s?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { error: 'A map location was missing its coordinates.' };
    }
    if (lat < KWARA_BOUNDS.minLat || lat > KWARA_BOUNDS.maxLat
        || lng < KWARA_BOUNDS.minLng || lng > KWARA_BOUNDS.maxLng) {
      return { error: 'A map location falls outside the approximate Kwara envelope.' };
    }
    sites.push({ lat, lng, label: s?.label ? String(s.label).trim().slice(0, 120) : null });
  }
  return { sites, error: null };
}

/**
 * Roughly where a ward is, so the map can open near it.
 *
 * The GRID3 boundary's centroid when one is loaded (see grid3.js); otherwise
 * the average GPS fix of people already registered in the ward. A ward with
 * neither returns nothing and the map falls back to a wider view.
 */
app.get('/api/geo/ward-centre', authenticate, wrap(async (req, res) => {
  const lga = String(req.query.lga || '').trim();
  const ward = String(req.query.ward || '').trim();
  if (!lga || !ward) return res.status(400).json({ error: 'Give an LGA and a ward' });

  const boundary = await wardBoundary(lga, ward);
  if (boundary?.lat != null) {
    return res.json({ lat: boundary.lat, lng: boundary.lng, from: 'grid3', members: null });
  }

  // Averaged over the caller's own people only. It is just a map centre, but
  // the count comes back with it, and "how many has the candidate next door
  // registered in this ward" is not theirs to know.
  const scope = memberScope(req.user);
  const row = await db.prepare(
    'SELECT AVG(lat) lat, AVG(lng) lng, COUNT(*) n FROM members '
    + 'WHERE lga = ? AND ward = ? AND lat IS NOT NULL AND lng IS NOT NULL '
    + 'AND (' + scope.sql + ')'
  ).get(lga, ward, ...scope.params);

  if (!row || !row.n || row.lat == null) {
    return res.json({ lat: null, lng: null, from: 'none', members: 0 });
  }
  res.json({ lat: row.lat, lng: row.lng, from: 'registrations', members: Number(row.n) });
}));

/** Where the project map should fly when an LGA is picked. */
app.get('/api/geo/lga-view', authenticate, wrap(async (req, res) => {
  const lga = String(req.query.lga || '').trim();
  if (!LGAS.includes(lga)) return res.status(400).json({ error: 'Unknown LGA' });
  res.json(await lgaView(lga));
}));

/**
 * The GRID3 outline of a ward, for drawing on the project map. With lat/lng it
 * also says whether that point is inside the ward.
 */
app.get('/api/geo/ward-boundary', authenticate, wrap(async (req, res) => {
  const lga = String(req.query.lga || '').trim();
  const ward = String(req.query.ward || '').trim();
  if (!lga || !ward) return res.status(400).json({ error: 'Give an LGA and a ward' });
  const boundary = await wardBoundary(lga, ward);
  if (!boundary) return res.json({ found: false });
  const lat = req.query.lat != null && req.query.lat !== '' ? Number(req.query.lat) : null;
  const lng = req.query.lng != null && req.query.lng !== '' ? Number(req.query.lng) : null;
  res.json({
    found: true,
    lga: boundary.lga,
    ward: boundary.ward,
    grid3_name: boundary.grid3_name,
    grid3_code: boundary.grid3_code,
    centre: boundary.lat != null ? { lat: boundary.lat, lng: boundary.lng } : null,
    geometry: boundary.geometry,
    source: boundary.source,
    position: Number.isFinite(lat) && Number.isFinite(lng)
      ? await wardPosition(lga, ward, lat, lng) : null,
  });
}));

/** The picklists: 20 sectors x 3 scales x 6 projects, plus status options. */
app.get('/api/project-framework', authenticate, (_req, res) => {
  res.json({ scales: SCALES, sectors: SECTORS, framework: FRAMEWORK, statuses: PROJECT_STATUSES });
});

/**
 * The concrete deliverables -- sewing machines, transformers, boreholes --
 * that the framework's 360 development projects do not name. Sent whole
 * because it is small and the form needs it offline as much as online.
 */
app.get('/api/project-items', authenticate, (req, res) => {
  const term = String(req.query.q || '').trim();
  res.json({
    units: UNITS,
    items: term ? searchItems(term, Number(req.query.limit) || 12) : ITEMS,
  });
});

/**
 * Named communities from GRID3, for the community field on a project.
 *
 * Scoped by LGA, which the candidate must already have picked -- 11,491
 * communities statewide is too many to send, and about 350 per LGA is right
 * for a type-ahead. A ward, if given, only sorts: GRID3 and INEC do not share
 * a ward set, so a third of communities have no INEC ward and filtering them
 * out would make real villages untypeable.
 */
app.get('/api/communities', authenticate, (req, res) => {
  const lga = String(req.query.lga || '').trim();
  if (!lga) return res.status(400).json({ error: 'Choose an LGA first' });
  if (!scopedLgas(req.user).includes(lga)) {
    return res.status(403).json({ error: 'That LGA is outside your area' });
  }

  const ward = String(req.query.ward || '').trim() || null;
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  res.json({
    lga,
    ward,
    total: COMMUNITY_COUNT,
    communities: searchCommunities(lga, ward, String(req.query.q || ''), limit),
  });
});

/**
 * The blank spreadsheet a candidate fills in with their project list.
 *
 * Built per candidate rather than served as one static file: the dropdowns
 * offer only their own LGAs and wards, and their wards come pre-typed down the
 * sheet. A proposal is usually the same package repeated across every ward, so
 * that pre-fill removes most of the typing and all of the misspelling.
 */
app.get('/api/projects/templates-all.zip', authenticate, requireAdmin, wrap(async (req,res) => {
  const candidates = await db.prepare("SELECT * FROM users WHERE role = 'candidate' ORDER BY full_name,id").all();
  if (!candidates.length) return res.status(404).json({error:'No candidates found'});
  const archive = allCandidateTemplates(candidates, owner => {
    const lgas = scopedLgas(owner);
    return {lgas,wardsByLga:Object.fromEntries(lgas.map(lga=>[lga,scopedWards(owner,lga)]))};
  });
  res.setHeader('Content-Type','application/zip');
  res.setHeader('Content-Disposition','attachment; filename="all-candidate-project-templates.zip"');
  res.send(archive);
}));

app.get('/api/projects/item-cost-review.csv', authenticate, requireAdmin, (req,res) => {
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition','attachment; filename="project-item-cost-review.csv"');
  res.send(itemCostReviewCsv());
});

app.get('/api/projects/template.:extension(xlsx|csv)', authenticate, wrap(async (req, res) => {
  const owner = await listOwner(req);
  if (!owner) return res.status(403).json({ error: 'Choose whose project list this is' });

  const lgas = scopedLgas(owner);
  if (!lgas.length) {
    return res.status(403).json({ error: 'That candidate has no area assigned' });
  }
  const who = owner.full_name || owner.scope_value || owner.username;

  if (req.params.extension === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',
      'attachment; filename="' + templateFilename(who, 'csv') + '"');
    return res.send(projectTemplateCsv());
  }

  const wardsByLga = Object.fromEntries(lgas.map((l) => [l, scopedWards(owner, l)]));
  res.setHeader('Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition',
    'attachment; filename="' + templateFilename(who) + '"');
  res.send(buildProjectTemplate({ lgas, wardsByLga, who }));
}));

/**
 * The filled-in spreadsheet, coming back.
 *
 * Two passes on purpose. Without ?confirm=1 nothing is written and the reply
 * is the verdict on every row, so a candidate can see "line 14: that ward is
 * not yours" before anything lands. With it, the good rows are written in one
 * transaction under a batch id, so a regretted import can be found again.
 *
 * A file with bad rows is refused outright unless ?skip_invalid=1, because the
 * usual mistake is a column shifted by one, and importing the nine rows that
 * happened to survive that would be worse than importing none.
 */
app.post('/api/projects/import', authenticate, sheetUpload.single('file'), wrap(async (req, res) => {
  const owner = await listOwner(req);
  if (!owner) {
    return res.status(403).json({ error: 'Only candidates can add projects — '
      + 'or an admin acting for one, with candidate_id' });
  }
  if (!req.file?.buffer?.length) {
    return res.status(400).json({ error: 'Attach the filled-in spreadsheet' });
  }

  // Scoped to the candidate the list belongs to, not to whoever is uploading:
  // an admin has the whole state, and rows must still be checked against the
  // wards of the person they are being filed under.
  const lgas = scopedLgas(owner);
  if (!lgas.length) return res.status(403).json({ error: 'That candidate has no area assigned' });
  const wardsByLga = Object.fromEntries(lgas.map((l) => [l, scopedWards(owner, l)]));

  let verdict;
  try {
    verdict = readProjectUpload(req.file.buffer, req.file.originalname || '', { lgas, wardsByLga });
  } catch (error) {
    // A malformed upload is the candidate's problem to fix, not a server fault.
    return res.status(400).json({ error: error.message });
  }
  if (verdict.error) return res.status(400).json({ error: verdict.error, summary: verdict.summary });

  // Re-sending the sheet is the normal way these arrive -- a candidate adds a
  // ward and uploads the whole file again -- so anything already promised is
  // left out rather than doubled. A candidate's register is a few hundred rows
  // at most, so it is cheaper to read than to query key by key.
  const already = await db.prepare(
    'SELECT id, title, quantity, item_id, lga, ward, community, polling_unit '
    + 'FROM projects WHERE candidate_id = ?'
  ).all(owner.id);
  verdict = applyProjectDuplicates(verdict,
    new Map(already.map((row) => [projectKey(row), row])));

  const confirm = req.query.confirm === '1' || req.query.confirm === 'true';
  const skipInvalid = req.query.skip_invalid === '1' || req.query.skip_invalid === 'true';

  if (!confirm) {
    return res.json({ ...verdict, committed: 0,
      message: verdict.ok
        ? 'Nothing saved yet. Send it again with confirm=1 to import.'
        : 'Nothing saved. Fix the rows listed below and upload again.' });
  }
  if (!verdict.ok && !skipInvalid) {
    return res.status(422).json({ ...verdict, committed: 0,
      error: verdict.summary.invalid + ' row(s) have problems. Fix them, or resend with '
        + 'skip_invalid=1 to import only the rows that are correct.' });
  }

  const good = verdict.rows.filter((r) => r.project && !r.errors.length);
  if (!good.length) return res.status(422).json({ ...verdict, committed: 0, error: 'Nothing to import' });

  const batch = crypto.randomUUID();
  const now = nowISO();
  const ids = await db.transaction(async (tx) => {
    const created = [];
    for (const { project: p } of good) {
      const info = await tx.prepare(
        'INSERT INTO projects (candidate_id,title,sector,scale,project_name,is_custom,lga,ward,'
        + 'quantity,status,need,timeline,item_id,unit,community,community_lat,community_lng,'
        + 'polling_unit,requested_by,beneficiaries,import_batch,created_at) '
        + 'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
      ).run(owner.id, p.title, p.sector, p.scale, p.project_name,
        isFrameworkProject(p.sector, p.scale, p.project_name) ? 0 : 1,
        p.lga, p.ward, p.quantity, p.status, p.need, p.timeline,
        p.item_id, p.unit, p.community, p.community_lat, p.community_lng,
        p.polling_unit, p.requested_by, p.beneficiaries, batch, now);
      const id = Number(info.lastInsertRowid);
      await tx.prepare('UPDATE projects SET contact_person=?,contact_phone=?,request_date=?,target_completion_date=? WHERE id=?').run(p.contact_person,p.contact_phone,p.request_date,p.target_completion_date,id);
      created.push(id);
      // A resolved community gives the project a place on the map. It is a
      // location, not a unit count -- the quantity came from the sheet.
      if (p.community_lat != null) {
        await tx.prepare(
          'INSERT INTO project_sites (project_id,lat,lng,label,created_at) VALUES (?,?,?,?,?)'
        ).run(id, p.community_lat, p.community_lng, p.community, now);
      }
    }
    return created;
  });

  // Filed under the candidate, recorded against whoever actually uploaded it.
  await audit(req.user.id, req.user.username, 'projects_imported', 'project', null,
    { batch, committed: ids.length, skipped: verdict.summary.invalid,
      duplicates: verdict.summary.duplicates,
      on_behalf_of: owner.id === req.user.id ? null : owner.id,
      file: req.file.originalname || null }, ip(req));

  res.status(201).json({ ...verdict, committed: ids.length, batch, ids });
}));

/**
 * Undo one import.
 *
 * Bulk entry goes wrong in bulk: a column shifted by one, the wrong file, the
 * same list sent twice. Without this the only remedy is deleting ninety
 * projects by hand, so the batch id every imported row carries has to lead
 * somewhere.
 */
app.delete('/api/projects/import/:batch', authenticate, wrap(async (req, res) => {
  const batch = String(req.params.batch || '');
  const mine = ADMIN_ROLES.has(normaliseRole(req.user.role))
    ? { sql: '', params: [] }
    : { sql: ' AND candidate_id = ?', params: [req.user.id] };

  const rows = await db.prepare(
    'SELECT id FROM projects WHERE import_batch = ?' + mine.sql).all(batch, ...mine.params);
  if (!rows.length) return res.status(404).json({ error: 'No import found with that reference' });

  const ids = rows.map((r) => Number(r.id));
  await db.prepare('DELETE FROM projects WHERE id IN (' + ids.map(() => '?').join(',') + ')')
    .run(...ids);

  await audit(req.user.id, req.user.username, 'projects_import_undone', 'project', null,
    { batch, removed: ids.length }, ip(req));
  res.json({ removed: ids.length, batch });
}));

app.get('/api/projects', authenticate, wrap(async (req, res) => {
  const where = [];
  const params = [];

  if (canSeeAllProjects(req.user)) {
    if (req.query.candidate_id) { where.push('p.candidate_id = ?'); params.push(Number(req.query.candidate_id)); }
  } else {
    where.push('p.candidate_id = ?');
    params.push(req.user.id);
  }
  for (const [field, column] of [['lga', 'p.lga'], ['ward', 'p.ward'],
                                 ['polling_unit', 'p.polling_unit'],
                                 ['community', 'p.community'],
                                 ['sector', 'p.sector'], ['scale', 'p.scale'],
                                 ['status', 'p.status']]) {
    if (req.query[field]) { where.push(column + ' = ?'); params.push(req.query[field]); }
  }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const rows = await db.prepare(
    'SELECT p.*, COALESCE(u.full_name,p.former_candidate_name) candidate_name, COALESCE(u.office,p.former_candidate_office) office, COALESCE(u.scope_value,p.former_candidate_scope) constituency '
    + 'FROM projects p LEFT JOIN users u ON u.id = p.candidate_id '
    + clause + ' ORDER BY p.created_at DESC LIMIT 1000'
  ).all(...params);

  const wardCounts = rows.length ? await projectWardVoterCounts() : new Map();

  // Sites and photos in two queries rather than one per project.
  const ids = rows.map((r) => r.id);
  const sites = ids.length ? await db.prepare(
    'SELECT * FROM project_sites WHERE project_id IN (' + ids.map(() => '?').join(',') + ')'
  ).all(...ids) : [];
  const photos = ids.length ? await db.prepare(
    'SELECT * FROM project_photos WHERE project_id IN (' + ids.map(() => '?').join(',') + ')'
  ).all(...ids) : [];

  res.json({
    rows: rows.map((r) => ({
      ...r,
      ward_voter_key: JSON.stringify([canonicalLocation(r).lga,canonicalLocation(r).ward]),
      ward_voters: wardCounts.get(JSON.stringify([canonicalLocation(r).lga, canonicalLocation(r).ward])) ?? null,
      pdp_people: pdpCount(r,'ward'),
      unit_cost: unitCostForProject(r),
      estimated_cost: estimatedProjectCost(r),
      sites: sites.filter((s) => s.project_id === r.id),
      photos: photos.filter((p) => p.project_id === r.id),
    })),
    can_see_all: canSeeAllProjects(req.user),
  });
}));

app.post('/api/projects', authenticate, wrap(async (req, res) => {
  if (!isCandidateRole(req.user.role) && !ADMIN_ROLES.has(normaliseRole(req.user.role))) {
    return res.status(403).json({ error: 'Only candidates can add projects' });
  }
  const b = req.body || {};
  const title = String(b.title || '').trim();
  const sector = String(b.sector || '').trim();
  const scale = String(b.scale || '').trim();
  const projectName = String(b.project_name || '').trim();
  const lga = String(b.lga || '').trim();
  const ward = String(b.ward || '').trim();

  if (!title) return res.status(400).json({ error: 'Give the project a title' });
  if (!SECTORS.includes(sector)) return res.status(400).json({ error: 'Choose a development sector' });
  if (!SCALE_IDS.includes(scale)) return res.status(400).json({ error: 'Choose a project scale' });
  if (!projectName) return res.status(400).json({ error: 'Choose a project type' });
  if (!lga || !ward) return res.status(400).json({ error: 'Choose an LGA and ward' });

  const status = STATUS_IDS.includes(b.status) ? b.status : 'promised';

  // A candidate may only place projects inside their own constituency --
  // otherwise anyone could file projects against someone else's ward.
  if (!ADMIN_ROLES.has(normaliseRole(req.user.role))) {
    if (!scopedLgas(req.user).includes(lga)
        || !scopedWards(req.user, lga).includes(ward)) {
      return res.status(403).json({ error: 'That ward is outside your constituency' });
    }
  }

  const { sites, error } = validateSites(b.sites);
  if (error) return res.status(400).json({ error });

  // Pins are the quantity when they exist; otherwise take the stated number.
  const quantity = sites.length || Math.max(1, Math.min(9999, Number(b.quantity) || 1));

  const created = await db.transaction(async (tx) => {
    const info = await tx.prepare(
      'INSERT INTO projects (candidate_id,title,sector,scale,project_name,is_custom,lga,ward,'
      + 'quantity,status,need,budget,partner,timeline,created_at) '
      + 'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ).run(req.user.id, title, sector, scale, projectName,
      isFrameworkProject(sector, scale, projectName) ? 0 : 1,
      lga, ward, quantity, status,
      b.need ? String(b.need).trim() : null,
      b.budget ? String(b.budget).trim() : null,
      b.partner ? String(b.partner).trim() : null,
      b.timeline ? String(b.timeline).trim() : null,
      nowISO());
    const id = Number(info.lastInsertRowid);
    await tx.prepare('UPDATE projects SET community=?,polling_unit=?,unit=?,requested_by=?,beneficiaries=?,contact_person=?,contact_phone=?,request_date=?,target_completion_date=?,item_id=? WHERE id=?')
      .run(String(b.community || '').trim() || null,String(b.polling_unit || '').trim() || null,String(b.unit || '').trim() || null,String(b.requested_by || '').trim() || null,
        b.beneficiaries === '' || b.beneficiaries == null ? null : Math.max(0,Number(b.beneficiaries)||0),String(b.contact_person || '').trim() || null,String(b.contact_phone || '').trim() || null,
        b.request_date || null,b.target_completion_date || null,ITEMS_BY_ID[b.item_id]?.id || null,id);
    for (const s of sites) {
      await tx.prepare(
        'INSERT INTO project_sites (project_id,lat,lng,label,created_at) VALUES (?,?,?,?,?)'
      ).run(id, s.lat, s.lng, s.label, nowISO());
    }
    return id;
  });

  await audit(req.user.id, req.user.username, 'project_created', 'project', created,
    { title, sector, scale, lga, ward, sites: sites.length }, ip(req));
  res.status(201).json({ id: created });
}));

/** Load a project the caller is allowed to touch, or null. */
async function projectForUser(user, id, { write = false } = {}) {
  const row = await db.prepare('SELECT * FROM projects WHERE id = ?').get(Number(id));
  if (!row) return null;
  if (row.candidate_id === user.id) return row;
  if (ADMIN_ROLES.has(normaliseRole(user.role))) return row;
  // Oversight can read everything but must not edit someone's promises.
  if (!write && canSeeAllProjects(user)) return row;
  return null;
}

app.patch('/api/projects/:id', authenticate, wrap(async (req, res) => {
  const project = await projectForUser(req.user, req.params.id, { write: true });
  if (!project) return res.status(404).json({ error: 'That project was not found' });

  const b = req.body || {};
  const fields = [];
  const params = [];
  const set = (column, value) => { fields.push(column + ' = ?'); params.push(value); };

  for (const [key, value] of Object.entries({
    title: b.title, need: b.need, partner: b.partner, timeline: b.timeline,
    polling_unit: b.polling_unit, requested_by: b.requested_by,
    contact_person:b.contact_person,contact_phone:b.contact_phone,request_date:b.request_date,target_completion_date:b.target_completion_date,
  })) {
    if (value !== undefined) set(key, String(value).trim() || null);
  }

  if (b.budget !== undefined) {
    if (!ADMIN_ROLES.has(normaliseRole(req.user.role))) {
      return res.status(403).json({ error: 'Only administrators can set project estimated costs' });
    }
    if (b.budget === null || String(b.budget).trim() === '') {
      set('budget', null);
    } else {
      const cost = Number(b.budget);
      if (!Number.isFinite(cost) || cost < 0) {
        return res.status(400).json({ error: 'Estimated cost must be a non-negative number' });
      }
      set('budget', String(cost));
    }
  }

  let movedTo = null;
  if (b.status !== undefined) {
    if (!STATUS_IDS.includes(b.status)) return res.status(400).json({ error: 'Unknown status' });
    set('status', b.status);
    if (b.status !== project.status) movedTo = b.status;
  }
  if (b.scale !== undefined) {
    if (!SCALE_IDS.includes(b.scale)) return res.status(400).json({ error: 'Unknown scale' });
    set('scale', b.scale);
  }

  // Changing the item changes what the project IS, so its name, sector and
  // unit move with it -- otherwise a borehole edited into a transformer keeps
  // reporting under Water and counting in boreholes.
  if (b.item_id !== undefined) {
    const item = ITEMS_BY_ID[String(b.item_id)];
    if (!item) return res.status(400).json({ error: 'Unknown item' });
    set('item_id', item.id);
    set('project_name', item.label);
    set('sector', item.sector);
    if (b.unit === undefined) set('unit', item.unit);
    set('is_custom', isFrameworkProject(item.sector, b.scale || project.scale, item.label) ? 0 : 1);
  }
  if (b.unit !== undefined) {
    const unit = String(b.unit).trim().toLowerCase();
    if (unit && !UNITS.includes(unit)) return res.status(400).json({ error: 'Unknown unit' });
    set('unit', unit || null);
  }

  for (const [key, value] of [['quantity', b.quantity], ['beneficiaries', b.beneficiaries]]) {
    if (value === undefined) continue;
    if (value === null || value === '') { set(key, key === 'quantity' ? 1 : null); continue; }
    const n = Math.round(Number(value));
    if (!Number.isFinite(n) || n < 1 || n > 100000) {
      return res.status(400).json({ error: 'That ' + key.replace('_', ' ') + ' is not a number we can use' });
    }
    set(key, n);
  }

  // Moving a project is allowed, but only within the candidate's own ground,
  // and the two halves move together -- a ward without its LGA is meaningless.
  if (b.lga !== undefined || b.ward !== undefined) {
    const lga = String(b.lga ?? project.lga).trim();
    const ward = String(b.ward ?? project.ward).trim();
    if (!lga || !ward) return res.status(400).json({ error: 'Choose an LGA and ward' });
    if (!ADMIN_ROLES.has(normaliseRole(req.user.role))
        && (!scopedLgas(req.user).includes(lga) || !scopedWards(req.user, lga).includes(ward))) {
      return res.status(403).json({ error: 'That ward is outside your constituency' });
    }
    set('lga', lga);
    set('ward', ward);
  }

  // The community carries its own coordinates, so it cannot be changed without
  // re-resolving them -- a renamed community keeping the old pin would put the
  // project somewhere it is not.
  if (b.community !== undefined) {
    const name = String(b.community || '').trim();
    const lga = String(b.lga ?? project.lga).trim();
    const found = name ? findCommunity(lga, name) : null;
    set('community', name || null);
    set('community_lat', found?.lat ?? null);
    set('community_lng', found?.lng ?? null);
  }

  if (!fields.length) return res.status(400).json({ error: 'Nothing to update' });

  fields.push('updated_at = ?'); params.push(nowISO());
  await db.prepare('UPDATE projects SET ' + fields.join(', ') + ' WHERE id = ?')
    .run(...params, project.id);

  // The projects table keeps only where a project is now. Reporting needs to
  // know when it moved, and that cannot be recovered afterwards.
  if (movedTo) {
    await db.prepare(
      'INSERT INTO project_status_events (project_id,from_status,to_status,changed_by,changed_at) '
      + 'VALUES (?,?,?,?,?)'
    ).run(project.id, project.status, movedTo, req.user.id, nowISO());
  }
  // Record what was touched, not just the status: an edit that moves a project
  // to another ward or changes what it is should be traceable afterwards.
  await audit(req.user.id, req.user.username, 'project_updated', 'project', project.id,
    { changed: fields.map((f) => f.split(' ')[0]).filter((f) => f !== 'updated_at') }, ip(req));
  res.json({ ok: true });
}));

app.delete('/api/projects/:id', authenticate, wrap(async (req, res) => {
  const project = await projectForUser(req.user, req.params.id, { write: true });
  if (!project) return res.status(404).json({ error: 'That project was not found' });
  await db.prepare('DELETE FROM projects WHERE id = ?').run(project.id);
  await audit(req.user.id, req.user.username, 'project_deleted', 'project', project.id,
    { title: project.title }, ip(req));
  res.json({ ok: true });
}));

/**
 * Optional before/after evidence. Most projects are promises with nothing yet
 * to photograph, so this is never required.
 */
app.post('/api/projects/:id/photos', authenticate, upload.single('photo'),
  wrap(async (req, res) => {
    const project = await projectForUser(req.user, req.params.id, { write: true });
    if (!project) return res.status(404).json({ error: 'That project was not found' });
    if (!req.file) return res.status(400).json({ error: 'Choose a photo to upload' });

    const kind = ['before', 'after', 'evidence'].includes(req.body?.kind)
      ? req.body.kind : 'evidence';

    let stored;
    try {
      stored = await storePublicFile(
        fs.readFileSync(req.file.path), req.file.originalname,
        req.file.mimetype || 'image/jpeg',
        {
          prefix: 'projects',
          localDir: path.join(UPLOAD_DIR, 'projects'),
          publicPath: '/uploads/projects',
          allowedExt: PROJECT_PHOTO_EXT,
        });
    } finally {
      fs.unlink(req.file.path, () => {});
    }

    const info = await db.prepare(
      'INSERT INTO project_photos (project_id,url,kind,caption,uploaded_by,created_at) '
      + 'VALUES (?,?,?,?,?,?)'
    ).run(project.id, stored.url, kind,
      req.body?.caption ? String(req.body.caption).trim().slice(0, 200) : null,
      req.user.id, nowISO());

    res.status(201).json({ id: Number(info.lastInsertRowid), url: stored.url, durable: stored.durable });
  }));

const verificationUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024, files: 1 } });
app.get('/api/dashboard/pdp-promoters', authenticate, requireAdmin, reportResponses.middleware, wrap(async(req,res)=>{
  res.json(await pdpPromoterOverlap(db,req.user,{excludeTest:true}));
}));
app.post('/api/admin/pdp-contact-list', authenticate, requireAdmin, verificationUpload.single('file'), wrap(async(req,res)=>{
  if(!req.file)return res.status(400).json({error:'Choose the supplied PDP contact CSV.'});
  let rows;
  try { rows=readPdpContacts(req.file.buffer); }
  catch(error){return res.status(400).json({error:error.message});}
  const result=await importPdpContacts(db,rows,req.user.id);
  await audit(req.user.id,req.user.username,'pdp_contact_matching_list_loaded',null,null,result,ip(req));
  res.json(result);
}));
app.post('/api/members/contact-verification-upload', authenticate, requireAdmin, verificationUpload.single('file'), wrap(async (req,res)=>{
  if(!req.file)return res.status(400).json({error:'Choose the contact centre CSV or XLSX file.'});
  let rows,result;
  try { rows=readContactVerification(req.file.buffer,req.file.originalname); }
  catch(error){return res.status(400).json({error:error.message});}
  try { result=await contactVerificationImport(db,req.user,rows,req.body.commit==='1'); }
  catch(error){
    if(error.contactImportError)return res.status(400).json({error:error.message});
    throw error;
  }
  if(req.body.commit==='1')await audit(req.user.id,req.user.username,'contact_verification_imported','members',null,{updated:result.updated,corrected:result.corrected,filename:req.file.originalname},ip(req));
  res.json(result);
}));
app.post('/api/members/update-voter-verification', authenticate, requireAdmin, wrap(async (req,res)=>{
  const scope=memberScope(req.user,{alias:'m'});
  const filters=memberExportFilters(req.body?.filters || {});
  const members=await db.prepare('SELECT m.id,m.code,m.upline_user_id,m.pvc_no,m.lga,m.ward,m.polling_unit FROM members m WHERE ('+scope.sql+')'
    +(filters.where.length?' AND '+filters.where.join(' AND '):'')).all(...scope.params,...filters.params);
  if(members.length>100000)return res.status(400).json({error:'Select a candidate or LGA to check fewer than 100,000 members at a time.'});
  try {
    const result=await verifyExistingMembers(db,members);
    await audit(req.user.id,req.user.username,'member_vin_verification_updated','members',null,result,ip(req));
    res.json(result);
  } catch(error) {
    if(error.reportError)return res.status(409).json({error:error.message});
    throw error;
  }
}));
app.post('/api/members/verification-report', authenticate, requireAdmin, verificationUpload.single('file'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose the member verification report' });
  let report;
  try { report = JSON.parse(req.file.buffer.toString('utf8')); }
  catch { return res.status(400).json({ error: 'Choose a valid verification JSON report' }); }
  try {
    const result = await applyMemberVerificationReport(db, report);
    await audit(req.user.id, req.user.username, 'member_vin_verification_applied', 'members', null, result, ip(req));
    res.json(result);
  } catch (error) {
    if (error.reportError) return res.status(409).json({ error: error.message });
    throw error;
  }
}));

app.get('/api/members', authenticate, wrap(async (req, res) => {
  const {clause,params} = memberListFilters(req.user,req.query);

  const limit = Math.min(Number(req.query.limit) || 100, 1000);
  const offset = Number(req.query.offset) || 0;

  const total = (await db.prepare('SELECT COUNT(*) n FROM members m WHERE ' + clause).get(...params)).n;
  const rows = await db.prepare(
    'SELECT m.*, u.full_name upline_name, u.username upline_username '
    + 'FROM members m LEFT JOIN users u ON u.id = m.upline_user_id '
    + 'WHERE ' + clause
    + ' ORDER BY ' + memberListOrder(req.query) + ' LIMIT ? OFFSET ?'
  ).all(...params, limit, offset);

  const ownerScope = memberScope(req.user, { alias: 'm' });
  const owners = await db.prepare('SELECT DISTINCT u.id, u.full_name, u.username '
    + 'FROM members m JOIN users u ON u.id = m.upline_user_id WHERE (' + ownerScope.sql + ') ORDER BY u.full_name')
    .all(...ownerScope.params);
  let nomination,verification;
  if(req.query.include_nomination_summary==='1' && isCandidateRole(req.user.role) && req.query.mine==='1' && req.query.level==='mobiliser') {
    const allNominees=await db.prepare('SELECT lga,ward,polling_unit,pvc_no,vin_verification_status,status,over_quota FROM members m WHERE '+clause).all(...params);
    nomination=nominationSummary(req.user,allNominees);
    verification=nomineeVerificationSummary(allNominees);
  }
  res.json({ total, limit, offset, rows, owners, nomination, verification });
}));

app.get('/api/members/:id', authenticate, wrap(async (req, res) => {
  const scope = memberScope(req.user);
  const m = await db.prepare('SELECT * FROM members WHERE id = ? AND (' + scope.sql + ')')
    .get(req.params.id, ...scope.params);
  if (!m) return res.status(404).json({ error: 'Member not found or outside your scope' });
  const fieldUser = isUnitPromoterRole(req.user.role) || isGrassrootRole(req.user.role);
  const isSelf = Number(m.id) === Number(req.user.member_id);
  if (fieldUser && !isSelf) {
    return res.status(404).json({ error: 'Member not found or outside your scope' });
  }

  m.checks = m.checks_json ? JSON.parse(m.checks_json) : null;
  m.flags = m.risk_flags ? JSON.parse(m.risk_flags) : [];
  const per = req.query.period || currentPeriod();

  res.json({
    member: m,
    downline: await downlineCounts(m.id),
    downline_rows: await db.prepare(
      'SELECT id,code,first_name,last_name,phone,level,status,ward,polling_unit '
      + 'FROM members WHERE upline_member_id = ? ORDER BY created_at DESC'
    ).all(m.id),
    eligibility: await eligibility(m, per),
    points: await pointsBreakdown(m.id, per),
    submissions: await db.prepare(
      'SELECT s.*, t.title task_title, t.points task_points FROM submissions s '
      + 'JOIN tasks t ON t.id = s.task_id WHERE s.member_id = ? ORDER BY s.created_at DESC'
    ).all(m.id),
  });
}));

app.get('/api/members/:id/location-edit', authenticate, requireAdmin, wrap(async (req,res)=>{
  try { res.json(await locationEditPreview(db,req.user,Number(req.params.id))); }
  catch(e){if(e.status)return res.status(e.status).json({error:e.message});throw e;}
}));
app.patch('/api/members/:id/location-edit', authenticate, requireAdmin, wrap(async (req,res)=>{
  try {
    const result=await saveMemberLocation(db,req.user,Number(req.params.id),req.body||{});
    await audit(req.user.id,req.user.username,'member_location_corrected','member',Number(req.params.id),result,ip(req));
    res.json(result);
  }catch(e){if(e.status)return res.status(e.status).json({error:e.message});throw e;}
}));

app.patch('/api/members/:id', authenticate, wrap(async (req, res) => {
  const scope = memberScope(req.user);
  const member = await db.prepare('SELECT * FROM members WHERE id = ? AND (' + scope.sql + ')')
    .get(req.params.id, ...scope.params);
  if (!member) return res.status(404).json({ error: 'Member not found or outside your scope' });

  const isAdmin = ADMIN_ROLES.has(normaliseRole(req.user.role));
  const isSelf = Number(member.id) === Number(req.user.member_id);
  const ownsNominee = isCandidateRole(req.user.role)
    && Number(member.upline_user_id) === Number(req.user.id);
  if (!isAdmin && !ownsNominee && !isSelf) {
    return res.status(403).json({ error: 'Only the owning candidate or an administrator can edit this nominee' });
  }

  const body = req.body || {};
  const value = (key) => body[key] === undefined
    ? String(member[key] || '') : String(body[key] || '').trim();
  const firstName = value('first_name');
  const lastName = value('last_name');
  if (!firstName || !lastName) {
    return res.status(400).json({ error: 'First name and surname are required' });
  }

  const lga = matchLga(value('lga')) || value('lga');
  const ward = value('ward');
  const pollingUnit = value('polling_unit');
  const originalLga = matchLga(member.lga) || member.lga;
  const locationChanged = lga !== originalLga || ward !== member.ward
    || pollingUnit !== member.polling_unit;
  if (locationChanged) {
    const allowedLgas = isSelf ? LGAS : scopedLgas(req.user);
    if (!allowedLgas.includes(lga)) {
      return res.status(400).json({ error: 'Choose a valid LGA in your area' });
    }
  }

  const phoneRaw = value('phone');
  const phone = isValidPhone(phoneRaw) ? normalisePhone(phoneRaw) : phoneRaw;
  if (isValidPhone(phone)) {
    const duplicate = await db.prepare('SELECT id FROM members WHERE phone = ? AND id <> ? LIMIT 1')
      .get(phone, member.id);
    if (duplicate) return res.status(409).json({ error: 'That phone number is already on another member record' });
  }

  const next = {
    first_name: firstName, last_name: lastName, phone,
    title: value('title') || null, designation: value('designation') || null,
    pvc_no: value('pvc_no') || null, nin: value('nin') || null,
    bank_name: value('bank_name') || null, account_number: value('account_number') || null,
    account_name: value('account_name') || null, lga, ward, polling_unit: pollingUnit,
  };
  Object.assign(next, canonicalLocation(next));
  const changed = Object.keys(next).some((key) => String(next[key] ?? '') !== String(member[key] ?? ''));
  const confirming = isSelf && body.confirm === true;
  if (!changed && !confirming) return res.json({ ok: true, unchanged: true });

  await db.prepare(
    'UPDATE members SET first_name = ?, last_name = ?, phone = ?, title = ?, designation = ?, '
    + 'pvc_no = ?, nin = ?, bank_name = ?, account_number = ?, account_name = ?, '
    + 'lga = ?, ward = ?, polling_unit = ?, status = ?, reviewed_by = NULL, reviewed_at = NULL, '
    + "checks_json = NULL, risk_score = 0, risk_flags = NULL, vin_verification_status = 'not_checked', vin_verification_json = NULL, polling_unit_resolved = ? WHERE id = ?"
  ).run(next.first_name, next.last_name, next.phone, next.title, next.designation,
    next.pvc_no, next.nin, next.bank_name, next.account_number, next.account_name,
    next.lga, next.ward, next.polling_unit, 'pending', Number(hasPollingUnit(next)), member.id);
  await db.prepare(
    'UPDATE users SET full_name = ?, phone = ?, scope_value = ? WHERE member_id = ?'
  ).run(firstName + ' ' + lastName, phone,
    [next.lga, next.ward, next.polling_unit].join('|'), member.id);
  await audit(req.user.id, req.user.username, 'member_edited', 'member', member.id,
    { fields: Object.keys(next).filter((key) => String(next[key] ?? '') !== String(member[key] ?? '')),
      confirmed_by_member: confirming }, ip(req));
  res.json({ ok: true });
}));

app.post('/api/members/:id/review', authenticate, wrap(async (req, res) => {
  if (!canReview(req.user)) {
    return res.status(403).json({ error: 'You cannot review registrations' });
  }
  const { status, note } = req.body || {};
  if (!['verified', 'rejected', 'pending'].includes(status)) {
    return res.status(400).json({ error: 'status must be verified, rejected or pending' });
  }
  const scope = memberScope(req.user);
  const m = await db.prepare('SELECT * FROM members WHERE id = ? AND (' + scope.sql + ')')
    .get(req.params.id, ...scope.params);
  if (!m) return res.status(404).json({ error: 'Member not found or outside your scope' });

  const reviewError = await db.transaction(async (tx) => {
    const owner = m.upline_user_id ? await tx.prepare('SELECT * FROM users WHERE id = ? FOR UPDATE').get(m.upline_user_id) : null;
    if (m.level === 'mobiliser' && status !== 'rejected') {
      const verdict = await validateNomination(tx, owner, m, m.id);
      if (verdict?.error) return verdict;
      // Approving someone already recorded cannot be blocked by the allowance;
      // mark it instead, so the excess stays visible.
      if (verdict?.over_quota) await tx.prepare('UPDATE members SET over_quota = 1 WHERE id = ?').run(m.id);
    }
    await tx.prepare('UPDATE members SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?')
      .run(status, note || null, req.user.id, nowISO(), req.params.id);
    return null;
  });
  if (reviewError) return res.status(reviewError.status).json(reviewError);

  // A status change alters the upline's activation count, so re-score them.
  if (m.upline_member_id) await recomputeActivationPoints(m.upline_member_id);

  await audit(req.user.id, req.user.username, 'member_' + status, 'member', m.id, { note }, ip(req));
  res.json({ ok: true, status });
}));

app.post('/api/members/:id/recheck', authenticate, requireAdmin, wrap(async (req, res) => {
  const m = await db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Member not found' });
  const result = await runChecks(m, { excludeId: m.id, uplineUserId: m.upline_user_id });
  await db.prepare('UPDATE members SET checks_json = ?, risk_score = ?, risk_flags = ? WHERE id = ?')
    .run(JSON.stringify(result.checks), result.riskScore, JSON.stringify(result.flags), m.id);
  res.json(result);
}));

/* -------------------------------- network -------------------------------- */

app.get('/api/network', authenticate, wrap(async (req,res)=>{
  const scope=memberScope(req.user);
  const members=await db.prepare('SELECT * FROM members WHERE ('+scope.sql+') ORDER BY created_at,id').all(...scope.params);
  const rootId=req.query.root?Number(req.query.root):null;
  if(req.query.root && (!Number.isInteger(rootId)||!members.some(m=>m.id===rootId))) return res.status(404).json({error:'Network member not found'});
  const users=await db.prepare('SELECT id,member_id FROM users WHERE member_id IS NOT NULL').all();
  res.json(networkReport(members,users,req.user,BASELINE_ACTIVATIONS,rootId));
}));

app.post('/api/network/merge-duplicates', authenticate, wrap(async(req,res)=>{
  if(!isCandidateRole(req.user.role) && !['admin','superadmin'].includes(normaliseRole(req.user.role))) return res.status(403).json({error:'Only candidates and administrators can consolidate duplicates'});
  const ids=req.body.member_ids,keepId=Number(req.body.keep_id);
  if(!Array.isArray(ids)||ids.length<2||ids.length>50||ids.some(id=>!Number.isInteger(id)||id<=0)||new Set(ids).size!==ids.length||!ids.includes(keepId)) return res.status(400).json({error:'Choose a record to keep from a duplicate group of 2–50 records'});
  try { await mergeNetworkDuplicates(db,req.user,ids,keepId); }
  catch(e){if(e.status)return res.status(e.status).json({error:e.message});throw e;}
  await audit(req.user.id,req.user.username,'network_duplicates_consolidated','member',keepId,{kept_id:keepId,removed_ids:ids.filter(id=>id!==keepId)},ip(req));
  res.json({ok:true,kept_id:keepId,removed:ids.length-1});
}));

/* --------------------------------- tasks --------------------------------- */

app.get('/api/tasks', authenticate, wrap(async (req, res) => {
  const per = req.query.period || currentPeriod();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(per)) {
    return res.status(400).json({ error: 'Period must use YYYY-MM' });
  }
  const rows = await taskReport(db, {
    scope: memberScope(req.user), period: per, isAdmin: ADMIN_ROLES.has(req.user.role),
    area: userArea(req.user),
  });
  res.json({ period: per, rows, activity_points: ACTIVITY_POINTS });
}));

// Administrators manage every task. A candidate may set tasks for people in
// their own jurisdiction, and edit or delete only the tasks they created.
const isAdminUser = (user) => ADMIN_ROLES.has(normaliseRole(user.role));
const requireTaskAuthor = (req, res, next) =>
  (isAdminUser(req.user) || isCandidateRole(req.user.role)) ? next()
    : res.status(403).json({ error: 'Only administrators and candidates can manage tasks' });

async function ownedTask(user, id) {
  const task = await db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  if (!task) return { status: 404, error: 'Task not found' };
  if (!isAdminUser(user) && Number(task.created_by) !== Number(user.id)) {
    return { status: 403, error: 'You can only change tasks you created' };
  }
  return { task };
}

/** The target a task will be saved with, defaulting a candidate to their whole jurisdiction. */
function taskTarget(user, b, existing = null) {
  let type = b.target_scope_type || existing?.target_scope_type;
  let value = b.target_scope_value ?? existing?.target_scope_value ?? null;
  if (!type) {
    type = isAdminUser(user) ? 'state' : (user.scope_type || 'state');
    value = isAdminUser(user) ? null : (user.scope_value || null);
  }
  if (type === 'jurisdiction') { type = user.scope_type || 'state'; value = user.scope_value || null; }
  if (type === 'state') value = null;
  if (type !== 'state' && !value) return { error: 'Choose where this task applies' };
  if (!canTarget(user, type, value)) return { error: 'You can only set tasks inside your own jurisdiction' };
  return { type, value };
}

app.post('/api/tasks', authenticate, requireTaskAuthor, wrap(async (req, res) => {
  const b = req.body || {};
  if (!String(b.title || '').trim()) return res.status(400).json({ error: 'Task title is required' });
  const target = taskTarget(req.user, b);
  if (target.error) return res.status(403).json({ error: target.error });

  const info = await db.prepare(
    'INSERT INTO tasks (title,description,type,points,mandatory,requires_photo,requires_location,'
    + 'questions_json,target_level,target_scope_type,target_scope_value,period,opens_at,due_at,'
    + 'status,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  ).run(
    b.title, b.description || null, b.type || 'canvass',
    Number(b.points) || ACTIVITY_POINTS[b.type] || 5,
    b.mandatory === false ? 0 : 1,
    0, 1, // photo evidence retired; GPS is mandatory for every submission
    b.questions ? JSON.stringify(b.questions) : null,
    b.target_level || 'all', target.type, target.value,
    b.period || currentPeriod(), b.opens_at || null, b.due_at || null,
    'open', req.user.id, nowISO()
  );
  await audit(req.user.id, req.user.username, 'task_created', 'task', Number(info.lastInsertRowid),
    { title: b.title }, ip(req));
  res.status(201).json({ id: Number(info.lastInsertRowid) });
}));

app.patch('/api/tasks/:id', authenticate, requireTaskAuthor, wrap(async (req, res) => {
  const b = req.body || {};
  const found = await ownedTask(req.user, req.params.id);
  if (found.error) return res.status(found.status).json({ error: found.error });
  const { task } = found;

  if (Object.prototype.hasOwnProperty.call(b, 'status')) {
    const { status } = b;
    if (!['open', 'closed'].includes(status)) {
      return res.status(400).json({ error: 'status must be open or closed' });
    }
    await db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(status, req.params.id);
    return res.json({ ok: true, updated: 'status' });
  }

  const title = String(b.title ?? task.title ?? '').trim();
  if (!title) return res.status(400).json({ error: 'Task title is required' });
  const target = taskTarget(req.user, b, task);
  if (target.error) return res.status(403).json({ error: target.error });

  const payload = {
    title,
    description: b.description ?? task.description ?? null,
    type: b.type || task.type || 'canvass',
    points: Number(b.points ?? task.points ?? 5) || 0,
    mandatory: b.mandatory === false ? 0 : 1,
    requires_photo: 0, // photo evidence retired -- always 0
    requires_location: 1,
    questions: Array.isArray(b.questions)
      ? b.questions
      : (task.questions_json ? JSON.parse(task.questions_json || '[]') : []),
    target_level: b.target_level || task.target_level || 'all',
    target_scope_type: target.type,
    target_scope_value: target.value,
    period: b.period || task.period || currentPeriod(),
    opens_at: b.opens_at ?? task.opens_at ?? null,
    due_at: b.due_at ?? task.due_at ?? null,
  };

  const questionsJson = JSON.stringify(payload.questions || []);
  await db.prepare(
    'UPDATE tasks SET title = ?, description = ?, type = ?, points = ?, mandatory = ?, '
    + 'requires_photo = ?, requires_location = ?, questions_json = ?, target_level = ?, '
    + 'target_scope_type = ?, target_scope_value = ?, period = ?, opens_at = ?, due_at = ? '
    + 'WHERE id = ?'
  ).run(
    payload.title, payload.description, payload.type, payload.points,
    payload.mandatory, payload.requires_photo, payload.requires_location,
    questionsJson, payload.target_level, payload.target_scope_type,
    payload.target_scope_value, payload.period, payload.opens_at, payload.due_at,
    req.params.id
  );

  await audit(req.user.id, req.user.username, 'task_updated', 'task', Number(req.params.id),
    { title: payload.title }, ip(req));
  res.json({ ok: true, updated: 'task' });
}));

app.delete('/api/tasks/:id', authenticate, requireTaskAuthor, wrap(async (req, res) => {
  const taskId = Number(req.params.id);
  const found = await ownedTask(req.user, taskId);
  if (found.error) return res.status(found.status).json({ error: found.error });
  const { task } = found;

  await db.transaction(async (tx) => {
    await tx.prepare("DELETE FROM points_ledger WHERE source = 'task' AND source_id = ?").run(taskId);
    await tx.prepare('DELETE FROM submissions WHERE task_id = ?').run(taskId);
    await tx.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
  });

  await audit(req.user.id, req.user.username, 'task_deleted', 'task', taskId,
    { title: task.title }, ip(req));
  res.json({ ok: true });
}));

/** Tasks that apply to a given member, with their submission state. */
app.get('/api/tasks/for-member/:memberId', authenticate, wrap(async (req, res) => {
  const scope = memberScope(req.user);
  const m = await db.prepare('SELECT * FROM members WHERE id = ? AND (' + scope.sql + ')')
    .get(req.params.memberId, ...scope.params);
  if (!m) return res.status(404).json({ error: 'Member not found' });
  const per = req.query.period || currentPeriod();
  const completion = await taskCompletion(m, per);
  const subs = await db.prepare('SELECT * FROM submissions WHERE member_id = ?').all(m.id);
  const byTask = new Map(subs.map((s) => [s.task_id, s]));
  const all = (await db.prepare(
    'SELECT * FROM tasks WHERE period = ? '
    + "AND (target_level = 'all' OR target_level = ?)"
  ).all(per, m.level)).filter((t) => taskAppliesTo(t, m.lga, m.ward));

  res.json({
    member: { id: m.id, code: m.code, name: m.first_name + ' ' + m.last_name, level: m.level },
    completion,
    tasks: all.map((t) => ({
      ...t,
      questions: t.questions_json ? JSON.parse(t.questions_json) : [],
      submission: byTask.get(t.id) || null,
    })),
  });
}));

// Photo evidence has been retired, but the client still posts the rest of
// the submission (answers, note, lat/lng) as multipart form data -- keep
// multer parsing the body, it just no longer expects a file.
app.post('/api/tasks/:id/submit', authenticate, upload.single('photo'), wrap(async (req, res) => {
  const task = await db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  if (task.status !== 'open') return res.status(400).json({ error: 'This task is closed' });

  const memberId = resolveMemberForSubmission(req.user, req.body.member_id);
  if (!memberId) {
    return res.status(400).json({
      error: 'Your account has no member profile to submit tasks against. '
           + 'Ask an administrator to link one, or pick who you are submitting for.',
    });
  }

  const scope = memberScope(req.user);
  const m = await db.prepare('SELECT * FROM members WHERE id = ? AND (' + scope.sql + ')')
    .get(memberId, ...scope.params);
  if (!m) return res.status(403).json({ error: 'That member is outside your scope' });
  if (!taskAppliesTo(task, m.lga, m.ward)) {
    return res.status(403).json({ error: 'This task is not set for that member\'s area' });
  }

  const lat = req.body.lat ? Number(req.body.lat) : null;
  const lng = req.body.lng ? Number(req.body.lng) : null;
  if (lat == null || lng == null) {
    return res.status(400).json({ error: 'GPS location is required to submit this task' });
  }

  const existing = await db.prepare('SELECT id FROM submissions WHERE task_id = ? AND member_id = ?')
    .get(task.id, memberId);
  if (existing) return res.status(409).json({ error: 'Already submitted for this task' });

  const info = await db.prepare(
    'INSERT INTO submissions (task_id,member_id,user_id,answers_json,photo_path,lat,lng,accuracy,'
    + 'note,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
  ).run(task.id, memberId, req.user.id,
    req.body.answers || null, null,
    lat, lng, req.body.accuracy ? Number(req.body.accuracy) : null,
    req.body.note || null, 'pending', nowISO());

  await audit(req.user.id, req.user.username, 'task_submitted', 'submission',
    Number(info.lastInsertRowid), { task: task.title, member: m.code }, ip(req));
  res.status(201).json({ id: Number(info.lastInsertRowid), status: 'pending' });
}));

app.get('/api/submissions', authenticate, wrap(async (req, res) => {
  // Joined as m, so ask the scope for m-qualified columns rather than
  // rewriting the finished SQL -- it can contain a subquery of its own now.
  const scope = memberScope(req.user, { alias: 'm' });
  const where = ['(' + scope.sql + ')'];
  const params = [...scope.params];
  if (req.query.status) { where.push('s.status = ?'); params.push(req.query.status); }
  if (req.query.task_id) { where.push('s.task_id = ?'); params.push(req.query.task_id); }

  const rows = await db.prepare(
    'SELECT s.*, t.title task_title, t.points task_points, t.type task_type, '
    + 'm.code member_code, m.first_name, m.last_name, m.lga, m.ward, m.polling_unit '
    + 'FROM submissions s JOIN tasks t ON t.id = s.task_id '
    + 'JOIN members m ON m.id = s.member_id WHERE ' + where.join(' AND ')
    + ' ORDER BY s.created_at DESC LIMIT 500'
  ).all(...params);
  res.json({ rows });
}));

app.post('/api/submissions/:id/review', authenticate, wrap(async (req, res) => {
  if (!canReview(req.user)) {
    return res.status(403).json({ error: 'You cannot review submissions' });
  }
  const { status, note } = req.body || {};
  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'status must be approved or rejected' });
  }
  const s = await db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Submission not found' });
  if (!ADMIN_ROLES.has(req.user.role)) {
    const scope = memberScope(req.user);
    const member = await db.prepare('SELECT id FROM members WHERE id = ? AND (' + scope.sql + ')')
      .get(s.member_id, ...scope.params);
    if (!member) return res.status(403).json({ error: 'That submission is outside your jurisdiction' });
  }
  const task = await db.prepare('SELECT * FROM tasks WHERE id = ?').get(s.task_id);

  let awarded = 0;
  if (status === 'approved') {
    awarded = await awardTaskPoints(s, task, task.period);
  } else {
    await db.prepare("DELETE FROM points_ledger WHERE source = 'task' AND source_id = ?").run(s.id);
  }

  await db.prepare('UPDATE submissions SET status = ?, review_note = ?, reviewed_by = ?, '
    + 'reviewed_at = ?, points_awarded = ? WHERE id = ?')
    .run(status, note || null, req.user.id, nowISO(), awarded, s.id);

  await audit(req.user.id, req.user.username, 'submission_' + status, 'submission', s.id,
    { points: awarded }, ip(req));
  res.json({ ok: true, status, points_awarded: awarded });
}));

/* -------------------------------- payroll -------------------------------- */

app.get('/api/payroll', authenticate, wrap(async (req, res) => {
  const per = req.query.period || currentPeriod();
  const scope = memberScope(req.user);
  const levels = ['mobiliser'];
  const rows = await db.prepare(
    'SELECT * FROM members WHERE (' + scope.sql + ') '
    + "AND status = 'verified' AND level = 'mobiliser' "
    + 'ORDER BY lga, ward'
  ).all(...scope.params);
  const result = await payroll(rows, per);
  result.caps = LEVEL_CAPS;
  result.naira_per_point = NAIRA_PER_POINT;
  result.levels = levels;
  res.json(result);
}));

/* ------------------------------- dashboard ------------------------------- */

const wardVoterAggregates = aggregateCache();
const voterAggregates = aggregateCache();
async function projectWardVoterCounts() {
  return wardVoterAggregates.get(async()=>{
    const rows=await db.prepare('SELECT lga,ward,COUNT(*) voters FROM voter_roll GROUP BY lga,ward').all();
    return wardVoterCounts(withReferenceVoters(rows));
  });
}
async function dashboardVoterCounts() {
  return voterAggregates.get(async()=>withReferenceVoters(await db.prepare('SELECT lga,ward,polling_unit,COUNT(*) voters FROM voter_roll GROUP BY lga,ward,polling_unit').all()));
}

app.get('/api/dashboard/area-report', authenticate, reportResponses.middleware, wrap(async (req, res) => {
  if (!canSeeCompliance(req.user) && !isCandidateRole(req.user.role)) {
    return res.status(403).json({ error: 'You cannot view constituency reports' });
  }
  let owner = req.user;
  if (req.query.candidate_id) {
    if (!canSeeCompliance(req.user) && String(req.query.candidate_id) !== String(req.user.id)) {
      return res.status(403).json({ error: 'You can only view your own constituency report' });
    }
    owner = await db.prepare("SELECT * FROM users WHERE id = ? AND role = 'candidate'").get(Number(req.query.candidate_id));
    if (!owner) return res.status(404).json({ error: 'Candidate not found' });
  }
  const scope = memberScope(owner);
  const projectScope = canSeeCompliance(owner) && !req.query.candidate_id
    ? { sql: '1=1', params: [] } : { sql: 'candidate_id = ?', params: [owner.id] };
  const [registrations,projects,voters] = await Promise.all([
    db.prepare(
    "SELECT lga, ward, polling_unit, COUNT(*) people, "
    + "SUM(CASE WHEN level = 'mobiliser' THEN 1 ELSE 0 END) promoters, "
    + "SUM(CASE WHEN level IN ('mobiliser','grassroot','grassroots') THEN 1 ELSE 0 END) pdp FROM members WHERE (" + scope.sql
    + ") GROUP BY lga, ward, polling_unit"
  ).all(...scope.params),
    db.prepare('SELECT id, title, status, lga, ward, polling_unit FROM projects WHERE ' + projectScope.sql).all(...projectScope.params),
    req.query.view === 'coverage' ? Promise.resolve(referenceVoterCounts())
      : req.query.view === 'totals' ? projectWardVoterCounts().then(counts=>[...counts].map(([key,voters])=>{const [lga,ward]=JSON.parse(key);return {lga,ward,voters};}))
      : dashboardVoterCounts(),
  ]);
  const report = { ...areaReport({ units: nominationUnits(owner), registrations, projects, voters,
    expectedPollingUnits: scopeTargets(owner).polling_units,
    voterRollLoaded: voters.length > 0,
    filters: { lga: req.query.lga, ward: req.query.ward, polling_unit: req.query.polling_unit } }),
    area: owner.scope_value || 'Kwara State', candidate_name: isCandidateRole(owner.role) ? owner.full_name : null,
    nomination: isCandidateRole(owner.role) ? await nominationStatus(owner.id) : null,
  };
  attachPdpCounts(report);
  res.json(req.query.view === 'totals' ? {wards:report.wards} : report);
}));

app.get('/api/dashboard', authenticate, reportResponses.middleware, wrap(async (req, res) => {
  const scope = memberScope(req.user);
  const per = req.query.period || currentPeriod();
  const p = scope.params;

  if (req.query.view === 'summary' && canSeeCompliance(req.user)) {
    const promoterScope=memberScope(req.user,{alias:'m'});
    const [totals, byLevel, byLga, places, projectRows, promoterSources] = await Promise.all([
      db.prepare('SELECT COUNT(*) total,SUM(CASE WHEN polling_unit_resolved=1 THEN 1 ELSE 0 END) with_polling_unit FROM members WHERE ' + scope.sql).get(...p),
      db.prepare('SELECT level,COUNT(*) n FROM members WHERE ' + scope.sql + ' GROUP BY level').all(...p),
      db.prepare("SELECT lga,COUNT(*) total,SUM(CASE WHEN level='mobiliser' THEN 1 ELSE 0 END) promoters FROM members WHERE " + scope.sql + ' GROUP BY lga ORDER BY total DESC').all(...p),
      db.prepare("SELECT lga,ward,polling_unit,SUM(CASE WHEN level='mobiliser' THEN 1 ELSE 0 END) promoters FROM members WHERE " + scope.sql + ' GROUP BY lga,ward,polling_unit').all(...p),
      db.prepare('SELECT id,status,budget,item_id,project_name,quantity FROM projects').all(),
      db.prepare("SELECT u.role,u.office,COUNT(*) n FROM members m LEFT JOIN users u ON u.id=m.upline_user_id WHERE m.level='mobiliser' AND ("+promoterScope.sql+") GROUP BY u.role,u.office").all(...promoterScope.params),
    ]);
    const targets = scopeTargets(req.user);
    const coverage = coverageOf(places, targets, req.user);
    const byStatus = {};
    let cost = 0;
    for (const project of projectRows) { byStatus[project.status] = (byStatus[project.status] || 0) + 1; cost += estimatedProjectCost(project) || 0; }
    const lgaRows = lgaCoverageRows(byLga,places,req.user,targets);
    return res.json({totals,by_level:byLevel,by_lga:lgaRows.map(row=>({...row,pdp_people:pdpCount(row,'lga')})),coverage,targets,promoter_sources:promoterSourceTotals(promoterSources),
      project_overview:{total:projectRows.length,by_status:byStatus,estimated_cost_total:cost}});
  }

  const totals = await db.prepare(
    'SELECT COUNT(*) total, '
    + "SUM(CASE WHEN status='verified' THEN 1 ELSE 0 END) verified, "
    + "SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending, "
    + "SUM(CASE WHEN status='flagged' THEN 1 ELSE 0 END) flagged, "
    + "SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) rejected, "
    + "SUM(CASE WHEN polling_unit_resolved=1 THEN 1 ELSE 0 END) with_polling_unit, "
    + "SUM(CASE WHEN polling_unit_resolved=0 THEN 1 ELSE 0 END) without_polling_unit, "
    + "SUM(CASE WHEN vin_verification_status='verified' THEN 1 ELSE 0 END) vin_matched "
    + 'FROM members WHERE ' + scope.sql
  ).get(...p);

  const byLevel = await db.prepare(
    'SELECT level, COUNT(*) n FROM members WHERE ' + scope.sql + ' GROUP BY level'
  ).all(...p);

  const byLga = await db.prepare(
    'SELECT lga, COUNT(*) total, '
    + "SUM(CASE WHEN vin_verification_status='verified' THEN 1 ELSE 0 END) vin_matched, "
    + 'COUNT(DISTINCT ward) wards, COUNT(DISTINCT polling_unit) units '
    + 'FROM members WHERE ' + scope.sql + ' GROUP BY lga ORDER BY total DESC'
  ).all(...p);

  // Ward-level breakdown -- a candidate's jurisdiction can span many LGAs, so
  // "coverage by LGA" alone does not answer "where exactly are my people".
  const byWard = await db.prepare(
    'SELECT lga, ward, COUNT(*) total, '
    + "SUM(CASE WHEN status='verified' THEN 1 ELSE 0 END) verified, "
    + 'COUNT(DISTINCT polling_unit) units '
    + 'FROM members WHERE ' + scope.sql + ' GROUP BY lga, ward ORDER BY total DESC LIMIT 100'
  ).all(...p);

  // The distinct places reached, matched against the INEC register rather than
  // counted by name. COUNT(DISTINCT ward) counted ward NAMES, and never checked
  // them against anything -- which is how coverage came to read 389 of 351.
  // At most 6,364 rows, and usually a small fraction of that.
  const places = await db.prepare(
    "SELECT lga, ward, polling_unit, SUM(CASE WHEN level='mobiliser' THEN 1 ELSE 0 END) promoters FROM members WHERE (" + scope.sql + ") GROUP BY lga,ward,polling_unit"
  ).all(...p);
  const coverage = coverageOf(places, scopeTargets(req.user), req.user);

  const recent = await db.prepare(
    'SELECT id,code,first_name,last_name,phone,level,lga,ward,polling_unit,status,risk_score,risk_flags,created_at,vin_verification_status,polling_unit_resolved '
    + 'FROM members WHERE ' + scope.sql + ' ORDER BY created_at DESC LIMIT 25'
  ).all(...p);

  const peopleAdded = (isUnitPromoterRole(req.user.role) || isGrassrootRole(req.user.role))
    ? await db.prepare(
      'SELECT id,code,first_name,last_name,phone,level,lga,ward,polling_unit,status,risk_score,risk_flags,created_at '
      + 'FROM members WHERE upline_user_id = ? ORDER BY created_at DESC LIMIT 100'
    ).all(req.user.id)
    : [];

  const tasks = await db.prepare(
    'SELECT COUNT(*) total, '
    + "SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) open "
    + 'FROM tasks WHERE period = ?'
  ).get(per);
  const taskRows = await taskReport(db, {
    scope,
    period: per,
    isAdmin: ADMIN_ROLES.has(req.user.role),
    area: userArea(req.user),
  });
  const surveyTasks = taskRows
    .filter((task) => task.type === 'survey' && task.status === 'open')
    .map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      questions: task.questions,
      points: task.points,
      mandatory: task.mandatory,
      target_scope_value: task.target_scope_value,
      created_at: task.created_at,
      submissions: task.submissions,
      approved: task.approved,
      pending: task.pending,
    }));
  const recentSurveyCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Same fragment, but against the joined alias.
  const joined = memberScope(req.user, { alias: 'm' });
  const subs = await db.prepare(
    'SELECT s.status, COUNT(*) n FROM submissions s JOIN members m ON m.id = s.member_id '
    + 'WHERE ' + joined.sql
    + ' GROUP BY s.status'
  ).all(...joined.params);

  const highRisk = (await db.prepare(
    'SELECT COUNT(*) n FROM members WHERE ' + scope.sql + ' AND risk_score >= 50'
  ).get(...p)).n;

  const platformCounts = await db.prepare(
    "SELECT COUNT(*) total, "
    + "SUM(CASE WHEN role = 'candidate' THEN 1 ELSE 0 END) candidates, "
    + "SUM(CASE WHEN role IN ('unit_promoter', 'mobiliser') THEN 1 ELSE 0 END) nominees, "
    + "SUM(CASE WHEN role IN ('grassroot', 'grassroots') THEN 1 ELSE 0 END) grassroots "
    + "FROM users WHERE status = 'active'"
  ).get();

  const projectOverview = canSeeAllProjects(req.user) ? await (async () => {
    const projectRows = await db.prepare(
      "SELECT COALESCE(NULLIF(TRIM(p.lga), ''), 'Not recorded') lga, "
      + "COALESCE(NULLIF(TRIM(p.ward), ''), 'Not recorded') ward, "
      + "COALESCE(NULLIF(TRIM(p.polling_unit), ''), 'Not specified') polling_unit, "
      + 'p.id, p.title, p.project_name, p.item_id, p.quantity, p.status, p.budget, '
      + 'COALESCE(u.full_name,p.former_candidate_name) candidate_name '
      + 'FROM projects p LEFT JOIN users u ON u.id = p.candidate_id '
      + 'ORDER BY p.lga, p.ward, p.polling_unit, p.title'
    ).all();
    const units = new Map();
    const byStatus = { promised: 0, ongoing: 0, completed: 0 };
    let estimatedCostTotal = 0;
    for (const row of projectRows) {
      const key = JSON.stringify([row.lga, row.ward, row.polling_unit]);
      if (!units.has(key)) units.set(key, {
        lga: row.lga, ward: row.ward, polling_unit: row.polling_unit,
        project_count: 0, projects: [],
      });
      const unit = units.get(key);
      unit.project_count += 1;
      if (Object.hasOwn(byStatus, row.status)) byStatus[row.status] += 1;
      const cost = estimatedProjectCost(row);
      if (cost != null) estimatedCostTotal += cost;
      unit.projects.push({ id: row.id, title: row.title, status: row.status,
        quantity: row.quantity, unit_cost: unitCostForProject(row),
        budget: cost == null ? null : String(cost), candidate_name: row.candidate_name });
    }
    const byPollingUnit = [...units.values()];
    return {
      total: projectRows.length,
      by_status: byStatus,
      estimated_cost_total: estimatedCostTotal,
      by_polling_unit: byPollingUnit,
    };
  })() : null;

  res.json({
    period: per,
    nomination: isCandidateRole(req.user.role) ? await nominationStatus(req.user.id) : null,
    report: await dashboardReport(db, scope),
    totals,
    by_level: byLevel,
    by_lga: byLga,
    by_ward: byWard,
    coverage,
    // Targets are the caller's own patch, not the whole state. "2 of 351
    // wards" tells a State Assembly candidate with six wards nothing; "2 of
    // 6" tells them exactly where they stand.
    targets: scopeTargets(req.user),
    recent,
    people_added: peopleAdded,
    tasks,
    survey_tasks: surveyTasks,
    survey_notifications: surveyTasks.filter((task) => task.created_at >= recentSurveyCutoff),
    submissions: subs,
    high_risk: highRisk,
    platform_counts: platformCounts,
    project_overview: projectOverview,
    voter_roll_loaded: await voterRollSize(),
  });
}));

app.get('/api/admin/member-data-quality', authenticate, requireAdmin, wrap(async (req, res) => {
  const scope = memberScope(req.user);
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const duplicateCtes = `WITH scoped_members AS (
      SELECT id, code, first_name, last_name, lga, ward, polling_unit, status,
        created_at, phone, nin, pvc_no, account_number, risk_score, risk_flags
      FROM members WHERE (${scope.sql})
    ), raw_identifiers AS (
      SELECT id, created_at, 'Phone' identifier_type,
        regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') identifier_value
      FROM scoped_members WHERE status <> 'rejected'
      UNION ALL
      SELECT id, created_at, 'NIN',
        regexp_replace(COALESCE(nin, ''), '[^0-9]', '', 'g')
      FROM scoped_members WHERE status <> 'rejected'
      UNION ALL
      SELECT id, created_at, 'PVC/VIN',
        upper(regexp_replace(COALESCE(pvc_no, ''), '[[:space:]]', '', 'g'))
      FROM scoped_members WHERE status <> 'rejected'
      UNION ALL
      SELECT id, created_at, 'Account number',
        regexp_replace(COALESCE(account_number, ''), '[^0-9]', '', 'g')
      FROM scoped_members WHERE status <> 'rejected'
    ), normalized_identifiers AS (
      SELECT id, created_at, identifier_type,
        CASE
          WHEN identifier_type = 'Phone' AND identifier_value LIKE '234%'
            THEN '0' || substr(identifier_value, 4)
          WHEN identifier_type = 'Phone' AND length(identifier_value) = 10
            AND left(identifier_value, 1) IN ('7', '8', '9')
            THEN '0' || identifier_value
          ELSE identifier_value
        END identifier_value
      FROM raw_identifiers WHERE identifier_value <> ''
    ), ranked_identifiers AS (
      SELECT id, identifier_type, identifier_value,
        ROW_NUMBER() OVER (PARTITION BY identifier_type, identifier_value
          ORDER BY created_at, id) duplicate_rank,
        FIRST_VALUE(id) OVER (PARTITION BY identifier_type, identifier_value
          ORDER BY created_at, id) original_id
      FROM normalized_identifiers
    ), duplicates AS (
      SELECT id,
        array_agg(DISTINCT identifier_type ORDER BY identifier_type) duplicate_fields,
        array_agg(DISTINCT original_id ORDER BY original_id) duplicate_of
      FROM ranked_identifiers WHERE duplicate_rank > 1
      GROUP BY id
    )`;
  const totals = await db.prepare(duplicateCtes + `
    SELECT (SELECT COUNT(*) FROM scoped_members) total_received,
      (SELECT COUNT(*) FROM scoped_members WHERE status = 'rejected') rejected_total,
      (SELECT COUNT(*) FROM duplicates) duplicate_total,
      (SELECT COUNT(*) FROM scoped_members WHERE risk_score > 0) problem_total`
  ).get(...scope.params);
  const rows = await db.prepare(duplicateCtes + `
    SELECT m.id, m.code, m.first_name, m.last_name, m.lga, m.ward, m.polling_unit,
      m.status, d.duplicate_fields, d.duplicate_of
    FROM duplicates d JOIN scoped_members m ON m.id = d.id
    ORDER BY m.created_at DESC, m.id DESC LIMIT ? OFFSET ?`
  ).all(...scope.params, limit, offset);
  const problemRows = await db.prepare(
    'SELECT id, code, first_name, last_name, lga, ward, polling_unit, status, '
    + 'risk_score, risk_flags FROM members WHERE (' + scope.sql + ') AND risk_score > 0 '
    + 'ORDER BY risk_score DESC, created_at DESC, id DESC LIMIT ? OFFSET ?'
  ).all(...scope.params, limit, offset);
  for (const row of problemRows) {
    try { row.flags = JSON.parse(row.risk_flags || '[]'); } catch { row.flags = []; }
  }
  const totalReceived = Number(totals.total_received || 0);
  const rejectedTotal = Number(totals.rejected_total || 0);
  const duplicateTotal = Number(totals.duplicate_total || 0);
  res.json({
    total_received: totalReceived,
    rejected_total: rejectedTotal,
    duplicate_total: duplicateTotal,
    problem_total: Number(totals.problem_total || 0),
    unique_total: totalReceived - rejectedTotal - duplicateTotal,
    limit, offset, rows, problem_rows: problemRows,
  });
}));

/* --------------------------------- users --------------------------------- */

app.get('/api/users', authenticate, requireAdmin, reportResponses.middleware, wrap(async (req, res) => {
  const rows = await db.prepare(
    'SELECT u.id,u.username,u.role,u.office,u.full_name,u.phone,u.email,u.scope_type,u.scope_value,u.status,'
    + 'u.must_reset,u.last_login,u.created_at,u.is_coordinator,u.member_id,'
    + 'parent.full_name upline_name,parent.username upline_username,COALESCE(counts.registered,0) registered '
    + 'FROM users u LEFT JOIN members linked ON linked.id = u.member_id '
    + 'LEFT JOIN users parent ON parent.id = linked.upline_user_id '
    + 'LEFT JOIN (SELECT upline_user_id,COUNT(*) registered FROM members GROUP BY upline_user_id) counts ON counts.upline_user_id = u.id '
    + 'ORDER BY u.role,u.full_name'
  ).all();
  res.json({ rows });
}));

app.get('/api/users/:id/promoter-reassignment', authenticate, requireAdmin, wrap(async (req,res)=>{
  try {res.json(await promoterReassignmentPreview(db,Number(req.params.id)));}
  catch(e){if(e.status)return res.status(e.status).json({error:e.message});throw e;}
}));
app.post('/api/users/:id/promoter-reassignment', authenticate, requireAdmin, wrap(async (req,res)=>{
  try {
    const result=await reassignPromoters(db,req.user,Number(req.params.id),req.body||{});
    await audit(req.user.id,req.user.username,'promoters_reassigned','user',Number(req.params.id),result,ip(req));
    res.json(result);
  }catch(e){if(e.status)return res.status(e.status).json({error:e.message});throw e;}
}));

app.delete('/api/users/:id', authenticate, requireRole('admin', 'superadmin'), wrap(async (req, res) => {
  const userId = Number(req.params.id);
  const target = await db.prepare('SELECT id, username, role, full_name, office, scope_value FROM users WHERE id = ?').get(userId);
  if (!target) return res.status(404).json({ error: 'Login not found' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });
  if (normaliseRole(target.role) === 'superadmin') {
    return res.status(403).json({ error: 'Super administrator accounts cannot be deleted' });
  }

  await deleteAccount(db, target, nowISO());

  await audit(req.user.id, req.user.username, 'user_deleted', 'user', userId,
    { username: target.username, role: target.role }, ip(req));
  res.json({ ok: true });
}));

function usernamePart(value) {
  return String(value || 'state')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'state';
}

/**
 * A candidate's scope follows the seat they contest -- a Senator covers a
 * senatorial district, and that is not negotiable.
 *
 * Stakeholder is the exception, and the only thing separating it from Deputy
 * Governor. A Stakeholder is not contesting anything, so there is no seat to
 * derive a boundary from: the programme office assigns one, which may be a
 * single LGA, a ward, a district or the whole state. Deputy Governor runs on
 * the Governor's joint ticket and is therefore always statewide.
 *
 * Returns null for Stakeholder, meaning "use whatever was chosen".
 */
function candidateScopeType(office) {
  const value = String(office || '').trim().toLowerCase();
  if (value === 'stakeholder') return null;
  if (value.includes('governor')) return 'state';   // Governor and Deputy Governor
  if (value.includes('senator')) return 'senatorial';
  if (value.includes('representative')) return 'federal';
  if (value.includes('assembly')) return 'state_const';
  return 'state';
}

/** The scope to store: fixed by office, or the chosen one for a Stakeholder. */
function resolveCandidateScope(office, chosenType, chosenValue) {
  const fixed = candidateScopeType(office);
  if (fixed) return { scope_type: fixed, scope_value: fixed === 'state' ? null : chosenValue };
  const type = chosenType || 'state';
  return { scope_type: type, scope_value: type === 'state' ? null : (chosenValue || null) };
}

async function generatedCandidateUsername(office, scopeValue) {
  const base = 'candidate-' + usernamePart(office) + '-' + usernamePart(scopeValue);
  let username = base;
  let suffix = 2;
  while (await db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(username)) {
    username = base + '-' + suffix++;
  }
  return username;
}

app.post('/api/users', authenticate, requireAdmin, wrap(async (req, res) => {
  const b = req.body || {};
  for (const f of ['full_name', 'role']) {
    if (!String(b[f] || '').trim()) return res.status(400).json({ error: 'Missing ' + f });
  }
  const role = normaliseRole(b.role);
  b.role = role;
  if (!VALID_USER_ROLES.has(role)) {
    return res.status(400).json({ error: 'Unsupported user role' });
  }
  if (!LOGIN_CREATION_ROLES.has(role)) {
    return res.status(400).json({ error: 'Unit Promoter accounts must be created from Add network' });
  }
  const username = isCandidateRole(role)
    ? await generatedCandidateUsername(b.office, b.scope_value)
    : String(b.username || '').trim().toLowerCase();
  if (!username) return res.status(400).json({ error: 'Username is required' });
  if (!isCandidateRole(role)) {
    const exists = await db.prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)').get(username);
    if (exists) return res.status(409).json({ error: 'That username is already taken' });
  }

  const pw = b.password || tempPassword();
  if (isUnitPromoterRole(role)) {
    const phone = normalisePhone(b.phone);
    const [lga, ward, pollingUnit] = String(b.scope_value || '').split('|');
    if (!phone || !lga || !ward || !pollingUnit) {
      return res.status(400).json({
        error: 'Unit Promoter accounts require phone, LGA, ward and polling unit',
      });
    }
    const nameParts = String(b.full_name).trim().split(/\s+/);
    const firstName = nameParts.shift();
    const lastName = nameParts.join(' ') || firstName;
    const result = await db.transaction(async (tx) => {
      const member = await tx.prepare(
        'INSERT INTO members (code,first_name,last_name,phone,designation,lga,ward,polling_unit,level,'
        + 'upline_user_id,status,checks_json,risk_score,risk_flags,created_at) '
        + 'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
      ).run(referralCode('KWARA'), firstName, lastName, phone, 'Unit Promoter',
        lga, ward, pollingUnit, 'mobiliser', req.user.id, 'pending', '{}', 0, '[]', nowISO());
      const memberId = Number(member.lastInsertRowid);
      const user = await tx.prepare(
        'INSERT INTO users (username,password_hash,must_reset,role,office,full_name,phone,'
        + 'scope_type,scope_value,member_id,referral_code,status,created_at) '
        + 'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'
      ).run(username, hashPassword(pw), 1, role, null,
        b.full_name.trim(), phone, 'polling_unit', b.scope_value, memberId,
        referralCode('U'), 'active', nowISO());
      return { id: Number(user.lastInsertRowid), member_id: memberId };
    });
    await audit(req.user.id, req.user.username, 'user_created', 'user', result.id,
      { username: b.username, role, member_id: result.member_id }, ip(req));
    return res.status(201).json({ ...result, username, password: pw });
  }
  const newScope = isCandidateRole(role)
    ? resolveCandidateScope(b.office, b.scope_type, b.scope_value)
    : { scope_type: b.scope_type || 'state', scope_value: b.scope_value || null };

  if (newScope.scope_type === 'state_const' && !wardsInStateConstituency(newScope.scope_value).length) {
    return res.status(400).json({ error: 'Ward boundaries for this Kwara Assembly seat are not verified yet. Choose a verified scope.' });
  }

  const info = await db.prepare(
    'INSERT INTO users (username,password_hash,must_reset,role,office,full_name,phone,'
    + 'scope_type,scope_value,referral_code,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
  ).run(username, hashPassword(pw), 1, role,
    isCandidateRole(role) ? (b.office || null) : null, b.full_name, b.phone || null,
    newScope.scope_type, newScope.scope_value, referralCode('U'), 'active', nowISO());

  await audit(req.user.id, req.user.username, 'user_created', 'user', Number(info.lastInsertRowid),
    { username: b.username, role }, ip(req));
  res.status(201).json({ id: Number(info.lastInsertRowid), username, password: pw });
}));

app.post('/api/users/:id/reset-password', authenticate, requireAdmin, wrap(async (req, res) => {
  if (isDg(req.user)) return res.status(403).json({ error: 'DG accounts cannot reset passwords' });
  const pw = tempPassword();
  await db.prepare('UPDATE users SET password_hash = ?, must_reset = 1 WHERE id = ?')
    .run(hashPassword(pw), req.params.id);
  await audit(req.user.id, req.user.username, 'password_reset', 'user', Number(req.params.id), null, ip(req));
  res.json({ password: pw });
}));

/**
 * Reset passwords for every matching login in one call and hand back a CSV.
 *
 * This exists because a password is only ever shown once, at creation --
 * there is no way to recover it later. If accounts were created by the seed
 * script running on the server itself (SEED_ON_BOOT), the credentials.csv it
 * wrote never left that container's disk. This is the way out: reset a whole
 * group's passwords and get a fresh, downloadable, guaranteed-correct list to
 * distribute, without visiting each account one at a time.
 *
 * Defaults to only accounts that have never logged in, so it does not
 * silently invalidate a password someone has already started using.
 */
/* ----------------------- external API key management ---------------------- */

app.get('/api/admin/api-keys', authenticate, requireAdmin, wrap(async (req, res) => {
  const rows = await db.prepare(
    'SELECT id, label, key_prefix, created_at, last_used_at, revoked_at '
    + 'FROM api_keys ORDER BY created_at DESC'
  ).all();
  res.json({ rows });
}));

app.post('/api/admin/api-keys', authenticate, requireAdmin, wrap(async (req, res) => {
  const label = String(req.body?.label || '').trim();
  if (!label) return res.status(400).json({ error: 'Give this key a label, e.g. "Sigar Vote"' });
  const { key, prefix, hash } = generateApiKey();
  await db.prepare(
    'INSERT INTO api_keys (label, key_hash, key_prefix, created_by, created_at) VALUES (?,?,?,?,?)'
  ).run(label, hash, prefix, req.user.id, nowISO());
  await audit(req.user.id, req.user.username, 'api_key_created', null, null, { label }, ip(req));
  res.status(201).json({ key, label }); // full key returned once, never again
}));

app.post('/api/admin/api-keys/:id/revoke', authenticate, requireAdmin, wrap(async (req, res) => {
  const info = await db.prepare(
    'UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL'
  ).run(nowISO(), req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'That key is already revoked' });
  await audit(req.user.id, req.user.username, 'api_key_revoked', null, Number(req.params.id),
    null, ip(req));
  res.json({ ok: true });
}));

app.post('/api/admin/export-credentials', authenticate, requireAdmin, wrap(async (req, res) => {
  const role = req.body?.role || 'all';
  const onlyUnused = req.body?.only_unused !== false;

  const where = ["role != 'superadmin'", "status = 'active'"];
  const params = [];
  if (role !== 'all') { where.push('role = ?'); params.push(role); }
  if (onlyUnused) where.push('last_login IS NULL');

  const users = await db.prepare(
    'SELECT id, username, full_name, role, office, scope_value FROM users WHERE '
    + where.join(' AND ') + ' ORDER BY role, full_name'
  ).all(...params);

  if (!users.length) {
    return res.status(404).json({ error: 'No matching accounts to reset' });
  }

  const rows = [];
  for (const u of users) {
    const pw = tempPassword();
    await db.prepare('UPDATE users SET password_hash = ?, must_reset = 1 WHERE id = ?')
      .run(hashPassword(pw), u.id);
    rows.push({
      username: u.username, password: pw, role: u.role,
      office: u.office || '', full_name: u.full_name, scope: u.scope_value || '',
    });
  }

  await audit(req.user.id, req.user.username, 'credentials_bulk_exported', null, null,
    { role, count: rows.length }, ip(req));

  const cols = ['username', 'password', 'role', 'office', 'full_name', 'scope'];
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="kwarax10-credentials-' + role + '.csv"');
  res.send(toCSV(rows, cols));
}));

app.patch('/api/users/:id', authenticate, requireAdmin, wrap(async (req, res) => {
  if (isDg(req.user)) return res.status(403).json({ error: 'DG accounts cannot edit accounts' });
  const b = req.body || {};
  if (b.status !== undefined && !b.full_name) {
    if (!['active', 'suspended'].includes(b.status)) {
      return res.status(400).json({ error: 'status must be active or suspended' });
    }
    await db.prepare('UPDATE users SET status = ? WHERE id = ?').run(b.status, req.params.id);
    await audit(req.user.id, req.user.username, 'user_' + b.status, 'user', Number(req.params.id), null, ip(req));
    return res.json({ ok: true });
  }

  for (const f of ['full_name', 'role', 'scope_type']) {
    if (!String(b[f] || '').trim()) return res.status(400).json({ error: 'Missing ' + f });
  }
  const role = normaliseRole(b.role);
  b.role = role;
  if (!VALID_USER_ROLES.has(role)) {
    return res.status(400).json({ error: 'Unsupported user role' });
  }
  const existingUser = await db.prepare('SELECT role,email FROM users WHERE id = ?').get(req.params.id);
  if (!existingUser) return res.status(404).json({ error: 'Login not found' });
  if (isUnitPromoterRole(role) && !isUnitPromoterRole(existingUser.role)) {
    return res.status(400).json({ error: 'Unit Promoter accounts must be created from Add network' });
  }
  const office = isCandidateRole(role) ? (b.office || null) : null;
  const scope = isCandidateRole(role)
    ? resolveCandidateScope(office, b.scope_type, b.scope_value)
    : { scope_type: b.scope_type, scope_value: b.scope_value || null };
  if (scope.scope_type === 'state_const' && !wardsInStateConstituency(scope.scope_value).length) {
    return res.status(400).json({ error: 'Ward boundaries for this Kwara Assembly seat are not verified yet. Choose a verified scope.' });
  }
  await db.prepare(
    'UPDATE users SET full_name = ?, phone = ?, email = ?, role = ?, office = ?, scope_type = ?, scope_value = ? WHERE id = ?'
  ).run(b.full_name.trim(), b.phone || null, b.email == null ? (existingUser.email || null) : String(b.email).trim() || null, role, office,
    scope.scope_type, scope.scope_value, req.params.id);
  await audit(req.user.id, req.user.username, 'user_updated', 'user', Number(req.params.id),
    { role, scope_type: b.scope_type }, ip(req));
  res.json({ ok: true });
}));

/**
 * Promote or demote a Mobiliser to Coordinator. A Coordinator is still a
 * Mobiliser -- their visibility and
 * review rights widen from "people I personally added" to "everyone in this
 * ward/LGA without needing a separate registration step.
 */
app.post('/api/users/:id/coordinator', authenticate, requireAdmin, wrap(async (req, res) => {
  if (isDg(req.user)) return res.status(403).json({ error: 'DG accounts cannot change account permissions' });
  const target = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'Login not found' });
  if (!isUnitPromoterRole(target.role)) {
    return res.status(400).json({ error: 'Only a Unit Promoter can be appointed Coordinator' });
  }

  const makeCoordinator = req.body?.is_coordinator !== false;
  if (makeCoordinator) {
    const scopeType = req.body?.scope_type;
    const scopeValue = String(req.body?.scope_value || '').trim();
    if (!['ward', 'lga'].includes(scopeType) || !scopeValue) {
      return res.status(400).json({ error: 'Choose a ward or an LGA for this Coordinator to oversee' });
    }
    await db.prepare(
      'UPDATE users SET is_coordinator = 1, scope_type = ?, scope_value = ? WHERE id = ?'
    ).run(scopeType, scopeValue, target.id);
  } else {
    // Demote back to their own polling unit -- the area they were registered at.
    const member = target.member_id
      ? await db.prepare('SELECT lga,ward,polling_unit FROM members WHERE id = ?').get(target.member_id)
      : null;
    const scopeValue = member ? member.lga + '|' + member.ward + '|' + member.polling_unit : '';
    await db.prepare(
      'UPDATE users SET is_coordinator = 0, scope_type = ?, scope_value = ? WHERE id = ?'
    ).run(scopeValue ? 'polling_unit' : 'state', scopeValue, target.id);
  }

  await audit(req.user.id, req.user.username, makeCoordinator ? 'coordinator_appointed' : 'coordinator_removed',
    'user', target.id, { scope_type: req.body?.scope_type, scope_value: req.body?.scope_value }, ip(req));
  res.json({ ok: true });
}));

/* ------------------------------ admin / data ----------------------------- */

/** Minimal RFC4180-aware CSV parser (handles quoted fields and commas). */
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length) return [];

  const cols = rows[0].map((c) => c.trim().toLowerCase().replace(/\s+/g, '_'));
  return rows.slice(1)
    .filter((r) => r.some((c) => c.trim()))
    .map((r) => Object.fromEntries(cols.map((c, i) => [c, (r[i] || '').trim()])));
}

app.post('/api/admin/voter-roll', authenticate, requireAdmin, upload.single('file'),
  wrap(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Upload a CSV file' });
    let rows;
    try {
      rows = parseCsv(fs.readFileSync(req.file.path, 'utf8'));
    } finally {
      fs.unlink(req.file.path, () => {});
    }
    if (!rows.length) return res.status(400).json({ error: 'That CSV had no data rows' });
    if (!('vin' in rows[0] || 'VIN' in rows[0] || 'voter_id' in rows[0])) {
      return res.status(400).json({
        error: 'The CSV needs a "vin" column. Columns found: '
             + Object.keys(rows[0]).join(', '),
      });
    }

    const result = await loadVoterRoll(rows, req.file.originalname);
    await audit(req.user.id, req.user.username, 'voter_roll_loaded', null, null, result, ip(req));
    res.json({ ...result, total: await voterRollSize() });
  }));

/**
 * One slice of the register, sent from the browser.
 *
 * The state register is 3.26 million rows in a 484 MB CSV. It cannot be posted
 * in one request, and whoever needs to load it may not be able to reach the
 * database directly -- the cluster's firewall lists a handful of addresses and
 * the hosting account belongs to someone else. So the file is read in the
 * browser, a few thousand rows at a time, and each slice arrives here.
 *
 * Rows come as arrays rather than objects: [vin, name, polling unit, ward,
 * LGA]. At three million rows the field names would be most of the payload.
 */
app.post('/api/admin/voter-roll/chunk', authenticate, requireAdmin, wrap(async (req, res) => {
  const batch = String(req.body?.batch || '').slice(0, 120) || 'browser upload';
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  if (!rows) return res.status(400).json({ error: 'Send a "rows" array' });
  if (rows.length > 5000) {
    return res.status(413).json({ error: 'Send at most 5,000 rows per chunk' });
  }

  const stamp = nowISO();
  const params = [];
  let kept = 0;
  let skipped = 0;

  for (const row of rows) {
    const [vinRaw, name, pollingUnit, ward, lgaRaw] = row;
    const vin = String(vinRaw || '').toUpperCase().replace(/\s/g, '');
    if (!vin) { skipped++; continue; }
    const { first_name, last_name } = splitName(name);
    const lga = String(lgaRaw || '').trim();
    params.push(vin, last_name, first_name, matchLga(lga) || lga || null,
      String(ward || '').trim() || null, String(pollingUnit || '').trim() || null,
      stamp, batch);
    kept++;
  }

  if (kept) {
    const values = Array.from({ length: kept }, (_, r) =>
      '(' + Array.from({ length: 8 }, (_, c) => '$' + (r * 8 + c + 1)).join(',') + ')').join(',');
    await db.pool.query(
      'INSERT INTO voter_roll (vin,last_name,first_name,lga,ward,polling_unit,loaded_at,batch) '
      + 'VALUES ' + values + ' '
      + 'ON CONFLICT (vin) DO UPDATE SET last_name=excluded.last_name, '
      + 'first_name=excluded.first_name, lga=excluded.lga, ward=excluded.ward, '
      + 'polling_unit=excluded.polling_unit, loaded_at=excluded.loaded_at, batch=excluded.batch',
      params);
  }

  // This endpoint writes rows straight in, so it has to drop the cached
  // count itself -- it never goes through loadVoterRoll.
  forgetVoterRollSize();
  res.json({ loaded: kept, skipped, total: await voterRollSize() });
}));


/* ------------------------------- oversight --------------------------------- */

/**
 * Who has done what.
 *
 * Three populations, three different meanings of "done something", so they are
 * counted three different ways rather than flattened into one league table:
 *
 *   candidate  submits projects and nominates Unit Promoters
 *   promoter   registers people in their polling unit
 *   grassroot  is registered, and answers survey tasks
 *
 * The question that prompted this was "who has NOT submitted", so the zero
 * rows are the point. Candidates come back in full, least active first;
 * promoters and grassroots are paged, because there can be hundreds of
 * thousands of them.
 */
app.get('/api/admin/oversight', authenticate, wrap(async (req, res) => {
  if (!canSeeCompliance(req.user)) {
    return res.status(403).json({ error: 'You cannot view programme oversight' });
  }
  const role = ['candidate', 'promoter', 'grassroot'].includes(String(req.query.role))
    ? String(req.query.role) : 'candidate';
  const limit = Math.min(Math.max(1, Number(req.query.limit) || 100), 500);
  const offset = Math.max(0, Number(req.query.offset) || 0);

  const summary = {
    projects: Number((await db.prepare('SELECT COUNT(*) AS n FROM projects').get()).n) || 0,
    candidates: Number((await db.prepare(
      "SELECT COUNT(*) AS n FROM users WHERE role = 'candidate' AND status = 'active'").get()).n) || 0,
    candidates_with_projects: Number((await db.prepare(
      'SELECT COUNT(DISTINCT candidate_id) AS n FROM projects').get()).n) || 0,
    promoters: Number((await db.prepare(
      "SELECT COUNT(*) AS n FROM members WHERE level = 'mobiliser' AND status <> 'rejected'")
      .get()).n) || 0,
    grassroots: Number((await db.prepare(
      "SELECT COUNT(*) AS n FROM members WHERE level = 'grassroot' AND status <> 'rejected'")
      .get()).n) || 0,
  };
  summary.candidates_without_projects = Math.max(0,
    summary.candidates - summary.candidates_with_projects);

  let rows = [];
  let total = 0;

  if (role === 'candidate') {
    // Every candidate, including the ones with nothing — they are the answer
    // to the question. A LEFT JOIN, so a candidate with no projects and no
    // nominees still has a row.
    const all = await db.prepare(
      'SELECT u.id, u.full_name, u.username, u.office, u.scope_value, '
      + '(SELECT COUNT(*) FROM projects p WHERE p.candidate_id = u.id) AS projects, '
      + '(SELECT MAX(p.created_at) FROM projects p WHERE p.candidate_id = u.id) AS last_project, '
      + "(SELECT COUNT(*) FROM members m WHERE m.upline_user_id = u.id AND m.level = 'mobiliser' "
      + "AND m.status <> 'rejected') AS nominees, "
      + "(SELECT COUNT(*) FROM members m WHERE m.upline_user_id = u.id AND m.level = 'mobiliser' "
      + "AND m.status = 'verified') AS verified_nominees, "
      + "(SELECT MAX(m.created_at) FROM members m WHERE m.upline_user_id = u.id) AS last_nominee "
      + "FROM users u WHERE u.role = 'candidate' AND u.status = 'active' "
      + 'ORDER BY projects ASC, nominees ASC, u.full_name'
    ).all();
    total = all.length;
    rows = all.slice(offset, offset + limit).map((r) => ({
      id: r.id,
      name: r.full_name || r.username,
      office: r.office || 'Candidate',
      area: r.scope_value || 'Statewide',
      projects: Number(r.projects) || 0,
      nominees: Number(r.nominees) || 0,
      verified: Number(r.verified_nominees) || 0,
      last_activity: [r.last_project, r.last_nominee].filter(Boolean).sort().pop() || null,
      submitted: Number(r.projects) > 0,
    }));
  } else {
    const level = role === 'promoter' ? 'mobiliser' : 'grassroot';
    total = Number((await db.prepare(
      "SELECT COUNT(*) AS n FROM members WHERE level = ? AND status <> 'rejected'")
      .get(level)).n) || 0;

    const found = await db.prepare(
      'SELECT m.id, m.code, m.first_name, m.last_name, m.lga, m.ward, m.polling_unit, '
      + 'm.status, m.created_at, '
      + '(SELECT COUNT(*) FROM members d WHERE d.upline_member_id = m.id '
      + "AND d.status <> 'rejected') AS registered, "
      + '(SELECT COUNT(*) FROM submissions s WHERE s.member_id = m.id) AS submissions, '
      + 'u.full_name AS candidate '
      + 'FROM members m LEFT JOIN users u ON u.id = m.upline_user_id '
      + "WHERE m.level = ? AND m.status <> 'rejected' "
      // Least active first: the people who have done nothing are the point.
      + 'ORDER BY registered ASC, submissions ASC, m.created_at LIMIT ? OFFSET ?'
    ).all(level, limit, offset);

    rows = found.map((r) => ({
      id: r.id,
      code: r.code,
      name: [r.first_name, r.last_name].filter(Boolean).join(' '),
      office: role === 'promoter' ? 'Unit Promoter' : 'Grassroot',
      area: [r.polling_unit, r.ward, r.lga].filter(Boolean).join(', '),
      registered: Number(r.registered) || 0,
      submissions: Number(r.submissions) || 0,
      status: r.status,
      candidate: r.candidate || null,
      last_activity: r.created_at,
      submitted: role === 'promoter'
        ? Number(r.registered) > 0 : Number(r.submissions) > 0,
    }));
  }

  res.json({
    generated_at: nowISO(),
    role,
    summary,
    total,
    count: rows.length,
    next_offset: offset + rows.length < total ? offset + rows.length : null,
    rows,
  });
}));

/* --------------------------- GRID3 ward boundaries -------------------------- */

app.get('/api/admin/grid3', authenticate, requireAdmin, wrap(async (_req, res) => {
  res.json(await grid3Status());
}));

app.post('/api/admin/grid3/sync', authenticate, requireAdmin, wrap(async (req, res) => {
  try {
    const result = await syncFromGrid3();
    await audit(req.user.id, req.user.username, 'grid3_synced', null, null,
      { matched: result.matched, unmatched: result.unmatched.length }, ip(req));
    res.status(result.ok ? 200 : 422).json({ ...result, status: await grid3Status() });
  } catch (error) {
    res.status(502).json({ error: 'Could not reach GRID3: ' + error.message
      + '. Download the ward boundaries GeoJSON from data.grid3.org and upload it instead.' });
  }
}));

// Its own uploader: GRID3's whole-of-Nigeria ward file is far larger than the
// 8 MB evidence-photo limit, and it is read once and discarded.
const geojsonUpload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 300 * 1024 * 1024 } });

app.post('/api/admin/grid3/upload', authenticate, requireAdmin, geojsonUpload.single('file'),
  wrap(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Attach a GeoJSON file' });
    let data;
    try {
      data = JSON.parse(fs.readFileSync(req.file.path, 'utf8'));
    } catch {
      return res.status(400).json({ error: 'That file is not valid GeoJSON' });
    } finally {
      fs.rm(req.file.path, { force: true }, () => {});
    }
    const features = data.type === 'FeatureCollection' ? data.features
      : Array.isArray(data) ? data : [data];
    const result = await loadFeatures(features, 'GRID3 upload: ' + (req.file.originalname || 'file'));
    await audit(req.user.id, req.user.username, 'grid3_uploaded', null, null,
      { matched: result.matched, unmatched: result.unmatched.length }, ip(req));
    res.status(result.ok ? 200 : 422).json({ ...result, status: await grid3Status() });
  }));

app.post('/api/admin/voter-roll/clear', authenticate, requireAdmin, wrap(async (req, res) => {
  // Awaited, and awaited before the response: the browser loader clears the
  // register and then immediately starts posting slices of the new one. Left
  // unawaited this answered with a pending promise AND let the delete run on
  // past it, into the rows that were replacing it.
  const cleared = await clearVoterRoll();
  await audit(req.user.id, req.user.username, 'voter_roll_cleared', null, null,
    { rows: cleared }, ip(req));
  res.json({ cleared });
}));

/**
 * Build a sample INEC-style extract from members already registered, so the
 * matching workflow can be demonstrated before the real extract arrives.
 * Deliberately imperfect: some members are omitted and some are placed at a
 * different polling unit, which is what the matcher is meant to catch.
 */
app.get('/api/admin/voter-roll/sample.csv', authenticate, requireAdmin, wrap(async (req, res) => {
  const members = await db.prepare(
    'SELECT * FROM members WHERE pvc_no IS NOT NULL ORDER BY RANDOM() LIMIT 4000'
  ).all();

  const lines = ['vin,last_name,first_name,lga,ward,polling_unit'];
  let omitted = 0, moved = 0;
  members.forEach((m, i) => {
    if (i % 17 === 0) { omitted++; return; }            // not on the register
    const pu = i % 23 === 0                              // registered elsewhere
      ? (moved++, m.ward + ' / PU 999')
      : m.polling_unit;
    const esc = (v) => (/[",\n]/.test(String(v ?? '')) ? '"' + v + '"' : (v ?? ''));
    lines.push([m.pvc_no, m.last_name, m.first_name, m.lga, m.ward, pu].map(esc).join(','));
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="sample-inec-extract.csv"');
  res.setHeader('X-Sample-Omitted', String(omitted));
  res.setHeader('X-Sample-Moved', String(moved));
  res.send(lines.join('\n'));
}));

/**
 * Payment reconciliation — bank-confirmed account names, with no API key.
 *
 * When money is actually moved, the bank's payment-confirmation file (or a
 * downloaded statement) lists the REAL beneficiary name for every account it
 * paid. Uploading that file back gives the same answer a paid name-resolution
 * API would, sourced from the bank itself, for free.
 *
 * Expected columns: account_number, account_name  (amount and date optional).
 */
app.post('/api/admin/reconcile-bank', authenticate, requireAdmin, upload.single('file'),
  wrap(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Upload a CSV file' });
    let rows;
    try {
      rows = parseCsv(fs.readFileSync(req.file.path, 'utf8'));
    } finally {
      fs.unlink(req.file.path, () => {});
    }
    if (!rows.length) return res.status(400).json({ error: 'That CSV had no data rows' });

    const first = rows[0];
    const acctKey = ['account_number', 'accountnumber', 'account', 'nuban', 'beneficiary_account']
      .find((k) => k in first);
    const nameKey = ['account_name', 'accountname', 'beneficiary_name', 'beneficiary', 'name']
      .find((k) => k in first);
    if (!acctKey || !nameKey) {
      return res.status(400).json({
        error: 'The CSV needs an account number column and an account name column. '
             + 'Columns found: ' + Object.keys(first).join(', '),
      });
    }

    const source = req.file.originalname || 'bank-file';
    const stamp = nowISO();
    const result = { rows: rows.length, matched: 0, unmatched: 0, confirmed: 0, mismatched: [] };
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

    await db.transaction(async (tx) => {
      const find = tx.prepare('SELECT * FROM members WHERE account_number = ?');
      const save = tx.prepare(
        'UPDATE members SET bank_verified_name = ?, bank_verified_at = ?, '
        + 'bank_verified_source = ? WHERE id = ?'
      );

      for (const r of rows) {
        const acct = String(r[acctKey] || '').replace(/\D/g, '');
        const name = String(r[nameKey] || '').trim();
        if (!acct || !name) continue;

        const members = await find.all(acct);
        if (!members.length) { result.unmatched++; continue; }
        result.matched++;

        for (const m of members) {
          await save.run(name, stamp, source, m.id);
          const confirmed = norm(name);
          if (confirmed.includes(norm(m.last_name)) && confirmed.includes(norm(m.first_name))) {
            result.confirmed++;
          } else {
            result.mismatched.push({
              id: m.id, code: m.code,
              registered_as: m.first_name + ' ' + m.last_name,
              bank_says: name, account_number: acct,
            });
          }
        }
      }
    });

    await audit(req.user.id, req.user.username, 'bank_reconciled', null, null,
      { rows: result.rows, matched: result.matched, mismatched: result.mismatched.length },
      ip(req));
    res.json(result);
  }));

/** Re-run the full check pipeline over a batch of members. */
app.post('/api/admin/verify-bulk', authenticate, requireAdmin, wrap(async (req, res) => {
  const scopeFilter = req.body?.only === 'pending'
    ? "WHERE status IN ('pending','flagged')" : '';
  const limit = Math.min(Number(req.body?.limit) || 500, 5000);
  const members = await db.prepare(
    'SELECT * FROM members ' + scopeFilter + ' ORDER BY created_at DESC LIMIT ?'
  ).all(limit);

  const update = await db.prepare(
    'UPDATE members SET checks_json = ?, risk_score = ?, risk_flags = ?, '
    + "status = CASE WHEN ? >= 50 AND status = 'pending' THEN 'flagged' "
    + "WHEN ? < 50 AND status = 'flagged' THEN 'pending' ELSE status END WHERE id = ?"
  );

  const tally = { checked: 0, clean: 0, flagged: 0, by_flag: {} };
  for (const m of members) {
    const r = await runChecks(m, { excludeId: m.id, uplineUserId: m.upline_user_id });
    update.run(JSON.stringify(r.checks), r.riskScore, JSON.stringify(r.flags),
      r.riskScore, r.riskScore, m.id);
    tally.checked++;
    if (r.riskScore >= 50) tally.flagged++; else if (r.riskScore === 0) tally.clean++;
    for (const f of r.flags) tally.by_flag[f.code] = (tally.by_flag[f.code] || 0) + 1;
  }

  await audit(req.user.id, req.user.username, 'verify_bulk', null, null, tally, ip(req));
  res.json(tally);
}));

/** Members carrying verification flags, worst first. */
app.get('/api/verification/queue', authenticate, wrap(async (req, res) => {
  const scope = memberScope(req.user);
  const rows = await db.prepare(
    'SELECT id,code,first_name,last_name,phone,level,lga,ward,polling_unit,status,'
    + 'risk_score,risk_flags,created_at FROM members WHERE (' + scope.sql + ') '
    + 'AND risk_score > 0 ORDER BY risk_score DESC, created_at DESC LIMIT 300'
  ).all(...scope.params);
  for (const r of rows) r.flags = r.risk_flags ? JSON.parse(r.risk_flags) : [];

  const spread = await db.prepare(
    'SELECT '
    + ' SUM(CASE WHEN risk_score = 0 THEN 1 ELSE 0 END) clean,'
    + ' SUM(CASE WHEN risk_score BETWEEN 1 AND 49 THEN 1 ELSE 0 END) watch,'
    + ' SUM(CASE WHEN risk_score >= 50 THEN 1 ELSE 0 END) high,'
    + ' COUNT(*) total FROM members WHERE ' + scope.sql
  ).get(...scope.params);

  res.json({ rows, spread, simulated: isSimulated() });
}));

app.get('/api/admin/status', authenticate, requireAdmin, wrap(async (req, res) => {
  const rollRows = await voterRollSize();
  res.json({
    voter_roll_rows: rollRows,
    voter_roll_batches: await voterRollBatches(),
    simulated: isSimulated(),
    providers: {
      bank_resolution: process.env.PAYSTACK_SECRET_KEY ? 'configured'
        : isSimulated() ? 'simulated' : 'not_configured',
      nin_verification: (process.env.KYC_PROVIDER && process.env.KYC_API_KEY)
        ? 'configured (' + process.env.KYC_PROVIDER + ')'
        : isSimulated() ? 'simulated' : 'not_configured',
      pvc_verification: rollRows
        ? 'INEC extract loaded (' + rollRows + ' rows)'
        : 'no INEC extract loaded - no public API exists',
    },
    members_total: (await db.prepare('SELECT COUNT(*) n FROM members').get()).n,
    audit_entries: (await db.prepare('SELECT COUNT(*) n FROM audit_log').get()).n,
  });
}));

app.get('/api/admin/audit', authenticate, requireAdmin, wrap(async (req, res) => {
  res.json({
    rows: await db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200').all(),
  });
}));

/* --------------------------------- export -------------------------------- */

function toCSV(rows, columns) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [columns.join(',')]
    .concat(rows.map((r) => columns.map((c) => esc(r[c])).join(',')))
    .join('\n');
}

app.get('/api/dashboard/candidate-report', authenticate, reportResponses.middleware, wrap(async (req, res) => {
  if (!canSeeCompliance(req.user)) return res.status(403).json({ error: 'You cannot view all candidate reports' });
  const candidates = await db.prepare("SELECT id,username,full_name,phone,email,role,office,scope_type,scope_value,member_id FROM users WHERE role = 'candidate' ORDER BY full_name").all();
  const projects = await db.prepare('SELECT id,candidate_id,former_candidate_name AS candidate_name,title,project_name,item_id,budget,quantity,status,lga,ward,polling_unit FROM projects ORDER BY lga,ward,title').all();
  const voters = req.query.view === 'summary' ? [...await projectWardVoterCounts()].map(([key,voters])=>{const [lga,ward]=JSON.parse(key);return {lga,ward,voters};}) : await dashboardVoterCounts();
  const allMembers = await db.prepare('SELECT m.id,m.lga,m.ward,m.polling_unit,m.level,m.status,m.upline_user_id,m.upline_member_id,parent.upline_user_id AS parent_candidate_id FROM members m LEFT JOIN users downline ON downline.id=m.upline_user_id LEFT JOIN members parent ON parent.id=downline.member_id').all();
  const rows = [];
  for (const c of candidates) {
    const members = allMembers.filter(m => isGovernor(c) || m.upline_user_id === c.id || (c.member_id && (m.upline_member_id === c.member_id || m.id === c.member_id)) || m.parent_candidate_id === c.id);
    rows.push(candidateFollowUp(c, members, projects.filter(p => p.candidate_id === c.id), voters, new Date().toISOString(), true).summary);
  }
  if (req.query.view === 'summary') return res.json({rows});
  const wardCounts = new Map();
  for (const raw of voters) {
    const place = canonicalLocation(raw), key = JSON.stringify([place.lga,place.ward]);
    wardCounts.set(key,(wardCounts.get(key) || 0) + Number(raw.voters || 0));
  }
  res.json({ rows, voter_roll_loaded:voters.length > 0, projects:projects.map(p => {
    const place = canonicalLocation(p);
    return {...p,...place,pdp_people:pdpCount(place,'ward'),estimated_cost:estimatedProjectCost(p),polling_unit_matched:hasPollingUnit(place),
      ward_polling_units:(POLLING_UNITS[place.lga]?.[place.ward] || []).length || null,
      ward_voters:voters.length ? (wardCounts.get(JSON.stringify([place.lga,place.ward])) ?? null) : null};
  }) });
}));

app.get('/api/export/candidate-follow-up.csv', authenticate, wrap(async (req, res) => {
  if (!canSeeCompliance(req.user) && !isCandidateRole(req.user.role)) return res.status(403).json({ error: 'You cannot export candidate reports' });
  const candidateId = req.query.candidate_id;
  if (candidateId && !/^\d+$/.test(String(candidateId))) return res.status(400).json({ error: 'Choose a valid candidate' });
  if (!canSeeCompliance(req.user) && candidateId && Number(candidateId) !== req.user.id) return res.status(403).json({ error: 'You can only export your own report' });
  const selected = candidateId || (!canSeeCompliance(req.user) ? req.user.id : null);
  const candidates = await db.prepare("SELECT id, username, full_name, phone, email, role, office, scope_type, scope_value, member_id FROM users WHERE role = 'candidate'"
    + (selected ? ' AND id = ?' : '') + ' ORDER BY full_name').all(...(selected ? [Number(selected)] : []));
  if (selected && !candidates.length) return res.status(404).json({ error: 'Candidate not found' });
  const voters = await dashboardVoterCounts();
  const rows = []; const generatedAt = new Date().toISOString();
  for (const candidate of candidates) {
    const scope = memberScope(candidate);
    const members = await db.prepare('SELECT lga,ward,polling_unit,level,status,upline_user_id FROM members WHERE ' + scope.sql).all(...scope.params);
    const projects = await db.prepare('SELECT id,title,status,lga,ward,polling_unit FROM projects WHERE candidate_id = ?').all(candidate.id);
    const report = candidateFollowUp(candidate, members, projects, voters, generatedAt);
    rows.push(...(req.query.detail === 'units' ? report.units : [report.summary]));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="kwarax10-candidate-follow-up.csv"');
  await audit(req.user.id, req.user.username, 'export_candidate_follow_up', null, null, { candidates: candidates.length, rows: rows.length }, ip(req));
  res.send('\uFEFF' + toCSV(rows, rows.length ? Object.keys(rows[0]) : ['candidate_name','nominees_target','nominees_achieved','polling_units_covered','polling_units_remaining']));
}));

app.get('/api/export/members.csv', authenticate, wrap(async (req, res) => {
  const scope = memberScope(req.user, { alias: 'm' });
  const where = ['(' + scope.sql + ')'];
  const params = [...scope.params];
  if (req.query.level) {
    if (!['mobiliser', 'grassroot'].includes(req.query.level)) {
      return res.status(400).json({ error: 'Unknown registration level' });
    }
  }
  const filters = memberExportFilters(req.query);
  where.push(...filters.where); params.push(...filters.params);
  const rows = await db.prepare('SELECT m.*, u.full_name AS owner_name, u.username AS owner_username, '
    + 'u.role AS owner_role, u.office AS owner_office, u.scope_value AS owner_constituency '
    + 'FROM members m LEFT JOIN users u ON u.id = m.upline_user_id WHERE '
    + where.join(' AND ') + ' ORDER BY ' + memberListOrder(req.query)).all(...params);
  const cols = ['id', 'code', 'upline_user_id', 'upline_member_id',
    'owner_name', 'owner_username', 'owner_role', 'owner_office', 'owner_constituency',
    'first_name', 'last_name', 'phone', 'title', 'designation',
    'lga', 'ward', 'polling_unit', 'level', 'pvc_no', 'nin', 'bank_name',
    'account_number', 'account_name', 'status', 'over_quota', 'import_batch', 'risk_score', 'created_at',
    'vin_verification_status', 'vin_verification_json', 'polling_unit_resolved',
    'lat', 'lng', 'accuracy', 'captured_at', 'review_note', 'reviewed_by', 'reviewed_at',
    'checks_json', 'risk_flags', 'contact_verification_status', 'contact_verification_notes',
    'contact_verified_by', 'contact_verified_at', 'contact_verification_uploaded_at'];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const issues = req.query.issues === '1';
  const filename = issues ? 'kwarax10-members-needing-correction.csv'
    : req.query.level === 'mobiliser' ? 'kwarax10-nominees.csv' : 'kwarax10-members.csv';
  res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
  await audit(req.user.id, req.user.username, 'export_members', null, null, { rows: rows.length }, ip(req));
  await streamCsv(res, rows, issues ? ISSUE_COLUMNS : cols, issues ? memberIssueRow : undefined);
}));

app.get('/api/export/payroll.csv', authenticate, wrap(async (req, res) => {
  const per = req.query.period || currentPeriod();
  const scope = memberScope(req.user);
  const members = await db.prepare(
    'SELECT * FROM members WHERE (' + scope.sql + ") AND status = 'verified' "
    + "AND level = 'mobiliser'"
  ).all(...scope.params);
  const { rows } = await payroll(members, per);
  const cols = ['code', 'name', 'level', 'lga', 'ward', 'verified_downline',
    'raw_points', 'capped_points', 'eligible', 'amount_naira',
    'bank_name', 'account_number', 'account_name'];
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="kwarax10-payroll-' + per + '.csv"');
  await audit(req.user.id, req.user.username, 'export_payroll', null, null, { period: per }, ip(req));
  res.send(toCSV(rows, cols));
}));

/* ------------------------------ static / errors --------------------------- */

const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api|\/uploads).*/, (_req, res) =>
    res.sendFile(path.join(clientDist, 'index.html')));
}

app.use((err, req, res, _next) => {
  // The real cause (driver errors, stack traces, anything internal) is
  // never sent to the client -- only logged, tagged with a short reference
  // so a user can quote it and it's findable in the logs. Whatever page
  // rendered this becomes whatever the caller wrote as err.message, so an
  // unsanitised message here would have shown up verbatim on someone's
  // screen -- that was the "database error" users were seeing.
  const ref = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  console.error('[api] [ref ' + ref + '] ' + req.method + ' ' + req.originalUrl, err);
  res.status(500).json({
    error: 'Something went wrong on our end. Please try again — if it keeps '
         + 'happening, tell the programme office reference ' + ref + '.',
    reference: ref,
  });
});

/**
 * On hosts with an ephemeral disk the database is empty after every deploy.
 * SEED_ON_BOOT=1 repopulates it automatically so a demonstration deployment is
 * never blank. It only ever runs when there are no users at all, so it cannot
 * overwrite real data.
 */
async function maybeSeed() {
  if (process.env.SEED_ON_BOOT !== '1') return;
  if ((await db.prepare('SELECT COUNT(*) n FROM users').get()).n > 0) return;
  console.log('SEED_ON_BOOT: empty database detected, seeding...');
  await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'seed.js')], {
      env: process.env,
      stdio: 'inherit',
    });
    child.on('error', (error) => {
      console.error('SEED_ON_BOOT failed:', error.message);
      resolve();
    });
    child.on('exit', (code) => {
      if (code === 0) console.log('SEED_ON_BOOT: done.');
      else console.error('SEED_ON_BOOT failed with exit code ' + code + '.');
      resolve();
    });
  });
}

// Keep the process alive if an async error ever escapes a route. Losing one
// request is bad; losing the process drops every request in flight and
// restarts the container.
guardProcess();

// Checked before anything starts listening. The fallback secret is committed
// to this repo, so running in production without KWARA_SECRET would let anyone
// who can read GitHub mint a valid session token for any account.
if (!process.env.KWARA_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: KWARA_SECRET is not set and NODE_ENV=production.');
    console.error('Every session token would be signed with the public development key.');
    console.error("Generate one:  node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\"");
    process.exit(1);
  }
  console.warn('WARNING: KWARA_SECRET is not set. Sessions use the development '
    + 'default. Set it before exposing this to the internet.');
}

// Connect and bring the schema up to date before accepting any request, so a
// bad DATABASE_URL fails loudly at boot rather than as a 500 on the first hit.
try {
  await initSchema();
} catch (error) {
  console.error('Could not reach the database: ' + error.message);
  console.error('Check the DATABASE_URL environment variable.');
  process.exit(1);
}

app.listen(PORT, '0.0.0.0', async () => {
  console.log('KWARA X10 API listening on port ' + PORT);
  warnIfNotDurable();
  await maybeSeed();
  await importGrassrootsOnce();
  await syncGrid3IfEmpty();
  const users = (await db.prepare('SELECT COUNT(*) n FROM users').get()).n;
  if (!users) console.log('No users yet -- run:  npm run seed');
});
