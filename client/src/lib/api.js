import { createRequestCache } from './request-cache.js';
const responseCache = createRequestCache();
const TOKEN_KEY = 'kwarax10.token';

// When the frontend and backend are the same origin (single-server deploy, or
// local dev via the Vite proxy), this stays empty and requests go to relative
// paths. When they are split across two hosts (e.g. Vercel + Render), set
// VITE_API_URL at build time to the backend's full origin, no trailing slash.
export const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

/** Turn a server-relative path (e.g. an uploaded photo) into an absolute one. */
export const assetUrl = (path) => (!path ? path : API_BASE + path);

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => { responseCache.clear(); localStorage.setItem(TOKEN_KEY, t); };
export const clearToken = () => { responseCache.clear(); localStorage.removeItem(TOKEN_KEY); };

/**
 * Whether a server-supplied error string looks like an internal/technical
 * leak (a driver error, a stack trace, a bare exception name) rather than a
 * message someone deliberately wrote for a user to read. The app's own
 * hand-authored errors read as plain sentences ("Incorrect username or
 * password") and never match these patterns -- this is defense in depth
 * for the rare case something internal slips through unsanitised.
 */
function looksTechnical(msg) {
  if (!msg || typeof msg !== 'string') return true;
  return /sqlite|libsql|stack trace|\bat \S+\(|TypeError|ReferenceError|SyntaxError|ENOENT|ECONN|undefined is not|cannot read propert|node_modules|\.js:\d+:\d+/i
    .test(msg);
}

/** A plain-language fallback keyed by HTTP status, used whenever the server
 * didn't send a safe, specific message of its own. */
function fallbackForStatus(status) {
  if (status === 400) return "That didn't go through. Please check the form and try again.";
  if (status === 401) return 'You need to sign in again.';
  if (status === 403) return 'You do not have permission to do that.';
  if (status === 404) return "That couldn't be found. It may have been moved or removed.";
  if (status === 409) return 'That conflicts with something already saved — please refresh and try again.';
  if (status === 413) return 'That file is too large.';
  if (status === 429) return 'Too many requests — please wait a moment and try again.';
  if (status >= 500) return 'Something went wrong on our end. Please try again in a moment.';
  return 'Something went wrong. Please try again.';
}

/** The message shown to the user for a failed request: the server's own
 * message when it's a genuine, human-readable one, otherwise a friendly
 * fallback for the status code. Never exposes raw technical detail. */
function safeErrorMessage(status, serverMessage) {
  if (serverMessage && !looksTechnical(serverMessage)) return serverMessage;
  return fallbackForStatus(status);
}

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getToken();
  if (token) headers.Authorization = 'Bearer ' + token;

  const isForm = options.body instanceof FormData;
  if (!isForm && options.body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(API_BASE + '/api' + path, {
      ...options,
      headers,
      body: isForm ? options.body
          : options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    // The request never reached the server at all -- offline, DNS, CORS,
    // the server is down. Nothing technical to show, just what happened.
    throw new Error("Can't reach the server right now. Check your connection and try again.");
  }

  if (res.status === 401 && getToken()) {
    clearToken();
    if (!location.pathname.startsWith('/login')) location.href = '/login';
    throw new Error('Your session has expired. Please sign in again.');
  }

  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }

  if (!res.ok) {
    const err = new Error(safeErrorMessage(res.status, data.error));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const mutate = async (p, options) => {
  responseCache.clear();
  try { return await request(p, options); } finally { responseCache.clear(); }
};
export const api = {
  get: (p) => /^(\/dashboard(?:[/?]|$)|\/users$|\/geo(?:\?|$)|\/nominations$)/.test(p)
    ? responseCache.get(getToken() + ':' + p, () => request(p)) : request(p),
  refresh: () => responseCache.clear(),
  post: (p, body) => mutate(p, { method: 'POST', body }),
  patch: (p, body) => mutate(p, { method: 'PATCH', body }),
  delete: (p) => mutate(p, { method: 'DELETE' }),
  form: (p, formData) => mutate(p, { method: 'POST', body: formData }),
};

export async function publicRequest(path, options = {}) {
  let res;
  try {
    res = await fetch(API_BASE + path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new Error("Can't reach the server right now. Check your connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(safeErrorMessage(res.status, data.error));
    err.data = data; err.status = res.status;
    throw err;
  }
  return data;
}

async function triggerCsvDownload(res, filename) {
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(safeErrorMessage(res.status, data.error));
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser time to start reading the download before releasing it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Download a file from an authenticated GET endpoint. Works for anything --
 * the body is read as a blob, so a spreadsheet survives it as well as a CSV.
 */
export async function downloadFile(path, filename) {
  const res = await fetch(API_BASE + '/api' + path, {
    headers: { Authorization: 'Bearer ' + getToken() },
  });
  await triggerCsvDownload(res, filename);
}

/** Trigger a CSV download through the authenticated GET endpoint. */
export const downloadCsv = downloadFile;

/** Trigger a CSV download through an authenticated POST (for exports that also change data). */
export async function downloadCsvPost(path, body, filename) {
  const res = await fetch(API_BASE + '/api' + path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + getToken(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  await triggerCsvDownload(res, filename);
}

export const naira = (n) =>
  '₦' + Number(n || 0).toLocaleString('en-NG', { maximumFractionDigits: 0 });

export const num = (n) => Number(n || 0).toLocaleString('en-NG');

export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

export function timeAgo(iso) {
  if (!iso) return '--';
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return Math.floor(secs / 60) + 'm ago';
  if (secs < 86400) return Math.floor(secs / 3600) + 'h ago';
  if (secs < 2592000) return Math.floor(secs / 86400) + 'd ago';
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
}

export const LEVEL_LABEL = {
  mobiliser: 'Unit Promoter',
};

export const ROLE_ALIASES = Object.freeze({
  superadmin: 'superadmin',
  admin: 'admin',
  campaign_admin: 'campaign_admin',
  'campaign administrator': 'campaign_admin',
  dg: 'campaign_admin',
  'd.g.': 'campaign_admin',
  'd.g': 'campaign_admin',
  candidate: 'candidate',
  mobiliser: 'unit_promoter',
  'unit promoter': 'unit_promoter',
  unit_promoter: 'unit_promoter',
  grassroots: 'grassroot',
  grassroot: 'grassroot',
  'grass root': 'grassroot',
});

export const normalizeRole = (role) => {
  const raw = String(role ?? '').trim().toLowerCase();
  if (!raw) return '';
  return ROLE_ALIASES[raw] || raw.replace(/[.\s-]+/g, '_');
};

export const isCandidateRole = (role) => normalizeRole(role) === 'candidate';
export const isUnitPromoterRole = (role) => ['unit_promoter', 'mobiliser'].includes(normalizeRole(role));

export const ROLE_LABEL = {
  superadmin: 'Super Admin',
  admin: 'Admin',
  campaign_admin: 'D.G. (Campaign Administrator)',
  candidate: 'Candidate',
  unit_promoter: 'Unit Promoter',
  grassroots: 'Grassroot',
  grassroot: 'Grassroot',
  mobiliser: 'Unit Promoter',
};
