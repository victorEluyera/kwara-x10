// GRID3 ward boundaries.
//
// GRID3 (Geo-Referenced Infrastructure and Demographic Data for Development)
// publishes Nigeria's operational ward boundaries as open data. This module
// loads the Kwara State wards from it, matches each GRID3 polygon to one of the
// 351 ward names in geo.js, and keeps the result in the grid3_wards table so
// the project map (where a candidate pins where a project goes) can outline
// the chosen ward, open on it instead of guessing a centre from past
// registrations, and warn when a pin is dropped outside the ward.
//
// Two ways in, both from Admin -> GRID3 boundaries:
//   1. Sync live from GRID3's ArcGIS feature service (GRID3_WARDS_URL).
//   2. Upload a GRID3 ward boundaries GeoJSON downloaded from
//      https://data.grid3.org -- the whole-of-Nigeria file is fine, anything
//      outside Kwara is dropped.
//
// Names are matched per LGA. GRID3 and INEC do not always spell wards the
// same way, so after an exact match fails we fall back to the best token
// overlap (roman numerals folded to digits); anything still unmatched is
// reported rather than guessed.

import { db, nowISO } from './db.js';
import { WARDS, canonicalLga } from './data/geo.js';

// GRID3's ArcGIS Online feature layer for Nigeria operational ward boundaries.
//
// GRID3 versions the layer name, so this URL expires. The un-suffixed
// GRID3_NGA_Operational_Wards it used to name now answers "Invalid URL", which
// means every press of "Sync from GRID3" failed. When it moves again, list
// what actually exists with
//   https://services3.arcgis.com/BU6Aadhn6tbBEdyk/arcgis/rest/services?f=json
// and set GRID3_WARDS_URL rather than waiting for a deploy.
export const GRID3_WARDS_URL = process.env.GRID3_WARDS_URL
  || 'https://services3.arcgis.com/BU6Aadhn6tbBEdyk/arcgis/rest/services/'
   + 'GRID3_NGA_operational_wards_v3_0/FeatureServer/0';

// Generous box around Kwara State, used to ask the service for Kwara only.
const KWARA_ENVELOPE = [2.7, 7.7, 6.3, 10.2];

/* ------------------------------- name matching ------------------------------ */

const ROMAN = { I: '1', II: '2', III: '3', IV: '4', V: '5', VI: '6', VII: '7', VIII: '8', IX: '9', X: '10', XI: '11', XII: '12' };
const squash = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const tokens = (s) => String(s || '').toUpperCase()
  .replace(/[^A-Z0-9]+/g, ' ').trim().split(' ')
  .filter((t) => t && t !== 'WARD')
  .map((t) => ROMAN[t] || t.replace(/^0+(\d)/, '$1'));

export const matchLga = canonicalLga;

export function matchWard(lga, grid3Name) {
  const wards = WARDS[lga] || [];
  const exact = wards.find((w) => squash(w) === squash(grid3Name));
  if (exact) return exact;
  const want = new Set(tokens(grid3Name));
  if (!want.size) return null;
  let best = null;
  let bestScore = 0;
  for (const w of wards) {
    const have = new Set(tokens(w));
    const shared = [...want].filter((t) => have.has(t)).length;
    const score = shared / new Set([...want, ...have]).size;
    if (score > bestScore) { best = w; bestScore = score; }
  }
  return bestScore >= 0.5 ? best : null;
}

/* ------------------------------- geometry ---------------------------------- */

const polygonsOf = (g) => (!g ? []
  : g.type === 'Polygon' ? [g.coordinates]
  : g.type === 'MultiPolygon' ? g.coordinates : []);

function ringContains(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function geometryContains(geometry, lat, lng) {
  return polygonsOf(geometry).some(([outer, ...holes]) =>
    ringContains(outer, lng, lat) && !holes.some((h) => ringContains(h, lng, lat)));
}

/** Metres from a point to the nearest edge of the geometry (flat-earth; fine at ward scale). */
export function distanceToGeometry(geometry, lat, lng) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  const ky = 110540;
  let best = Infinity;
  for (const poly of polygonsOf(geometry)) {
    for (const ring of poly) {
      for (let i = 1; i < ring.length; i++) {
        const ax = (ring[i - 1][0] - lng) * kx; const ay = (ring[i - 1][1] - lat) * ky;
        const bx = (ring[i][0] - lng) * kx; const by = (ring[i][1] - lat) * ky;
        const dx = bx - ax; const dy = by - ay;
        const len = dx * dx + dy * dy;
        const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
        best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
      }
    }
  }
  return best;
}

/** Area-weighted centroid of the largest polygon's outer ring. */
export function centroidOf(geometry) {
  let best = null;
  for (const [outer] of polygonsOf(geometry)) {
    let a = 0; let cx = 0; let cy = 0;
    for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
      const f = outer[j][0] * outer[i][1] - outer[i][0] * outer[j][1];
      a += f; cx += (outer[j][0] + outer[i][0]) * f; cy += (outer[j][1] + outer[i][1]) * f;
    }
    if (a && (!best || Math.abs(a) > best.area)) {
      best = { area: Math.abs(a), lng: cx / (3 * a), lat: cy / (3 * a) };
    }
  }
  return best ? { lat: best.lat, lng: best.lng } : null;
}

// Douglas-Peucker, so a 351-ward state stays a few hundred KB instead of the
// tens of MB GRID3 ships at full survey resolution. ~10 m tolerance.
function simplifyRing(ring, tol = 0.0001) {
  if (ring.length < 5) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = 1; keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    const [x1, y1] = ring[s]; const [x2, y2] = ring[e];
    const dx = x2 - x1; const dy = y2 - y1; const len = Math.hypot(dx, dy) || 1e-12;
    let idx = -1; let max = tol;
    for (let i = s + 1; i < e; i++) {
      const d = Math.abs(dy * ring[i][0] - dx * ring[i][1] + x2 * y1 - y2 * x1) / len;
      if (d > max) { max = d; idx = i; }
    }
    if (idx > 0) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  const out = ring.filter((_, i) => keep[i]).map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)]);
  return out.length >= 4 ? out : ring;
}

function simplify(geometry) {
  const polys = polygonsOf(geometry).map((p) => p.map((r) => simplifyRing(r)));
  return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] }
    : { type: 'MultiPolygon', coordinates: polys };
}

/* ------------------------------- loading ----------------------------------- */

const pick = (props, keys) => {
  const lower = Object.fromEntries(Object.entries(props || {}).map(([k, v]) => [k.toLowerCase(), v]));
  for (const k of keys) if (lower[k] != null && String(lower[k]).trim()) return String(lower[k]).trim();
  return null;
};

/**
 * Match GRID3 features to geo.js wards and replace the grid3_wards table.
 * Returns a report of what matched and what did not.
 */
export async function loadFeatures(features, source) {
  const matched = new Map();
  const unmatched = [];
  for (const f of features || []) {
    const p = f.properties || {};
    const state = pick(p, ['statename', 'state_name', 'state']);
    if (state && !/kwara/i.test(state)) continue;
    const lga = matchLga(pick(p, ['lganame', 'lga_name', 'lga', 'admin2name']));
    const name = pick(p, ['wardname', 'ward_name', 'ward', 'name', 'admin3name']);
    if (!lga || !name || !polygonsOf(f.geometry).length) {
      if (lga || state) unmatched.push((lga || '?') + ' / ' + (name || '?'));
      continue;
    }
    // v3 of the layer carries the other spellings GRID3 knows a ward by
    // ("Akinmorin/Jobele" for "Akinmorin", "Basorun" for "Bashorun"), and the
    // alternative is often the one INEC uses. Worth trying before giving up.
    let ward = matchWard(lga, name);
    if (!ward) {
      for (const alt of String(pick(p, ['ward_alt_names', 'ward_alt', 'alt_names']) || '').split(',')) {
        ward = matchWard(lga, alt.trim());
        if (ward) break;
      }
    }
    if (!ward) { unmatched.push(lga + ' / ' + name); continue; }
    const key = lga + '|' + ward;
    const geometry = simplify(f.geometry);
    // Two GRID3 pieces for one ward (split polygons) become one multipolygon.
    const prev = matched.get(key);
    if (prev) {
      prev.geometry = { type: 'MultiPolygon',
        coordinates: [...polygonsOf(prev.geometry), ...polygonsOf(geometry)] };
    } else {
      matched.set(key, { lga, ward, grid3_name: name,
        grid3_code: pick(p, ['wardcode', 'ward_code', 'code']), geometry });
    }
  }
  if (!matched.size) {
    return { ok: false, error: 'No Kwara State wards found in that data', matched: 0, unmatched };
  }

  await db.transaction(async (tx) => {
    await tx.prepare('DELETE FROM grid3_wards').run();
    for (const w of matched.values()) {
      const c = centroidOf(w.geometry);
      await tx.prepare(
        'INSERT INTO grid3_wards (lga,ward,grid3_name,grid3_code,geometry,lat,lng,source,loaded_at) '
        + 'VALUES (?,?,?,?,?,?,?,?,?)'
      ).run(w.lga, w.ward, w.grid3_name, w.grid3_code, JSON.stringify(w.geometry),
        c?.lat ?? null, c?.lng ?? null, source, nowISO());
    }
  });
  cache.clear();
  return { ok: true, matched: matched.size, unmatched };
}

/** Pull Kwara's wards from the GRID3 ArcGIS feature service, page by page. */
export async function syncFromGrid3(url = GRID3_WARDS_URL) {
  const features = [];
  const pageSize = 500;
  for (let offset = 0; offset < 20000; offset += pageSize) {
    const q = new URLSearchParams({
      where: '1=1', outFields: '*', outSR: '4326', f: 'geojson', returnGeometry: 'true',
      geometry: KWARA_ENVELOPE.join(','), geometryType: 'esriGeometryEnvelope', inSR: '4326',
      spatialRel: 'esriSpatialRelIntersects',
      resultOffset: String(offset), resultRecordCount: String(pageSize),
    });
    const res = await fetch(url.replace(/\/$/, '') + '/query?' + q, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error('GRID3 service answered HTTP ' + res.status);
    const page = await res.json();
    if (page.error) throw new Error('GRID3 service error: ' + (page.error.message || JSON.stringify(page.error)));
    features.push(...(page.features || []));
    const more = page.exceededTransferLimit || page.properties?.exceededTransferLimit;
    if (!more && (page.features || []).length < pageSize) break;
  }
  return loadFeatures(features, 'GRID3 live: ' + url);
}

/* ------------------------------- lookups ----------------------------------- */

// Approximate LGA headquarters, so the project map can fly to an LGA even
// before GRID3 boundaries are loaded. Only used to position the map.
export const LGA_HQ = {};

/**
 * Where to point the map for an LGA: the bounding box of its GRID3 wards
 * when loaded, otherwise its headquarters town.
 */
export async function lgaView(lga) {
  const rows = await db.prepare('SELECT geometry FROM grid3_wards WHERE lga = ?').all(lga);
  if (rows.length) {
    let s = 90; let w = 180; let n = -90; let e = -180;
    for (const r of rows) {
      for (const poly of polygonsOf(JSON.parse(r.geometry))) {
        for (const [x, y] of poly[0]) {
          if (y < s) s = y; if (y > n) n = y; if (x < w) w = x; if (x > e) e = x;
        }
      }
    }
    return { bounds: [[s, w], [n, e]], from: 'grid3' };
  }
  const hq = LGA_HQ[lga];
  return hq ? { centre: { lat: hq[0], lng: hq[1] }, from: 'hq' } : { from: 'none' };
}

const cache = new Map();

export async function wardBoundary(lga, ward) {
  const key = lga + '|' + ward;
  if (cache.has(key)) return cache.get(key);
  const row = await db.prepare(
    'SELECT lga, ward, grid3_name, grid3_code, geometry, lat, lng, source FROM grid3_wards '
    + 'WHERE lga = ? AND ward = ?'
  ).get(lga, ward);
  const value = row ? { ...row, geometry: JSON.parse(row.geometry) } : null;
  if (cache.size > 500) cache.clear();
  cache.set(key, value);
  return value;
}

/**
 * Where a GPS fix sits relative to the GRID3 ward. null when either the fix
 * or the boundary is missing -- "we cannot tell", never a pass or a fail.
 */
export async function wardPosition(lga, ward, lat, lng) {
  if (lat == null || lng == null || !lga || !ward) return null;
  const b = await wardBoundary(lga, ward);
  if (!b) return null;
  const inside = geometryContains(b.geometry, Number(lat), Number(lng));
  return { inside, distance_m: inside ? 0 : Math.round(distanceToGeometry(b.geometry, Number(lat), Number(lng))) };
}

export async function grid3Status() {
  const row = await db.prepare(
    'SELECT COUNT(*) n, MAX(loaded_at) loaded_at, MAX(source) source FROM grid3_wards'
  ).get();
  const total = Object.values(WARDS).reduce((a, w) => a + w.length, 0);
  return { wards_loaded: Number(row.n), total_wards: total, loaded_at: row.loaded_at,
    source: row.source, service_url: GRID3_WARDS_URL };
}

/** Boot hook: try a live sync once if nothing is loaded yet. Never fatal. */
export async function syncGrid3IfEmpty() {
  if (process.env.GRID3_SYNC_ON_BOOT === '0') return;
  if ((await grid3Status()).wards_loaded) return;
  try {
    const r = await syncFromGrid3();
    console.log('GRID3: loaded ' + r.matched + ' Kwara ward boundaries'
      + (r.unmatched.length ? ' (' + r.unmatched.length + ' GRID3 wards not matched)' : '') + '.');
  } catch (error) {
    console.warn('GRID3: could not sync ward boundaries (' + error.message + '). '
      + 'Upload a GRID3 GeoJSON under Admin -> GRID3 boundaries, or set GRID3_WARDS_URL.');
  }
}
