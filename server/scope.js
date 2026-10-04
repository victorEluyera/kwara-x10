// Who can see whose members.
//
// Its own module so it can be tested directly -- importing index.js starts a
// server. This is the function that keeps one candidate's registrants out of
// another candidate's dashboard, so it is worth testing on its own.

import { ADMIN_ROLES, normaliseRole, isUnitPromoterRole, isGrassrootRole, isCandidateRole }
  from './auth.js';
import { LGAS, WARDS, POLLING_UNITS, TOTAL_WARDS, TOTAL_POLLING_UNITS, lgasForScope, canonicalLocation }
  from './data/geo.js';
import { wardsInStateConstituency } from './data/ward-constituencies.js';

export const POLLING_UNIT_BENCHMARK = TOTAL_POLLING_UNITS;

/** The Governor sees the whole state; every other candidate sees their own. */
export const isGovernor = (user) =>
  isCandidateRole(user.role) && user.office === 'Governor';

/**
 * Build a SQL WHERE fragment limiting `members` rows to what this user may see.
 *
 *  - Admin (including the DG) and the Governor: everyone.
 *  - Plain Unit Promoter (not a Coordinator): only the people THEY personally
 *    added -- ownership, not geography. Two promoters can share a polling
 *    unit and must never see each other's registrants.
 *  - Every other candidate: their own network, and nobody else's. Wards are
 *    shared -- a Senator, a Rep and an Assembly candidate all cover the same
 *    ground -- so scoping a candidate by geography showed them their
 *    colleagues' registrants as if they were their own.
 *  - Coordinator: by geography. That is the whole point of the promotion, and
 *    it is granted deliberately by an admin rather than held by default.
 *
 * @param {object} user
 * @param {object} [options]
 * @param {string} [options.alias]  table alias to qualify the columns with,
 *   for callers that join `members` as something other than `members`.
 *   Passed in rather than patched on afterwards: the fragment can contain a
 *   subquery of its own, and a regex over the finished SQL cannot tell the
 *   subquery's columns from the outer query's.
 * @returns {{ sql: string, params: unknown[] }}
 */
export function memberScope(user, { alias = '' } = {}) {
  const col = (name) => (alias ? alias + '.' + name : name);

  if (ADMIN_ROLES.has(normaliseRole(user.role)) || isGovernor(user)) {
    return { sql: '1=1', params: [] };
  }

  if ((isUnitPromoterRole(user.role) || isGrassrootRole(user.role))
      && !Number(user.is_coordinator)) {
    return {
      sql: '(' + col('id') + ' = ? OR ' + col('upline_user_id') + ' = ? OR '
        + col('upline_member_id') + ' = ?)',
      params: [user.member_id || -1, user.id, user.member_id || -1],
    };
  }

  // A candidate sees the network they built: the people they registered, and
  // the people those people registered. Not the ward -- the ward belongs to
  // several candidates at once.
  if (isCandidateRole(user.role)) {
    return {
      sql: '(' + col('upline_user_id') + ' = ?'
        + ' OR ' + col('upline_member_id') + ' = ?'
        + ' OR ' + col('id') + ' = ?'
        + ' OR ' + col('upline_user_id') + ' IN ('
        + 'SELECT downline.id FROM users downline '
        + 'JOIN members mine ON mine.id = downline.member_id '
        + 'WHERE mine.upline_user_id = ?))',
      params: [user.id, user.member_id || -1, user.member_id || -1, user.id],
    };
  }

  if (user.scope_type === 'state') return { sql: '1=1', params: [] };

  // State Assembly seats are the only ones that cut an LGA in half: Akinyele
  // I and II share Akinyele, as do the four split Ibadan LGAs. Matching on
  // LGA alone would show each of those candidates their neighbour's members
  // as well as their own, so they are scoped by ward.
  if (user.scope_type === 'state_const') {
    const wards = wardsInStateConstituency(user.scope_value);
    if (!wards.length) return { sql: '1=0', params: [] };
    return {
      sql: '(' + col('lga') + ', ' + col('ward') + ') IN ('
        + wards.map(() => '(?,?)').join(',') + ')',
      params: wards.flatMap((w) => [w.lga, w.ward]),
    };
  }

  // Senatorial districts and federal constituencies are made of whole LGAs
  // (the geo tests assert each covers all 33 exactly once), so matching on
  // LGA is both correct and cheaper here.
  if (['senatorial', 'federal'].includes(user.scope_type)) {
    const lgas = lgasForScope(user.scope_type, user.scope_value);
    if (!lgas.length) return { sql: '1=0', params: [] };
    return {
      sql: col('lga') + ' IN (' + lgas.map(() => '?').join(',') + ')',
      params: lgas,
    };
  }

  if (user.scope_type === 'lga') return { sql: col('lga') + ' = ?', params: [user.scope_value] };
  if (user.scope_type === 'ward') return { sql: col('ward') + ' = ?', params: [user.scope_value] };
  if (user.scope_type === 'polling_unit') {
    const [lga, ward, pollingUnit] = String(user.scope_value || '').split('|');
    if (!lga || !ward || !pollingUnit) return { sql: '1=0', params: [] };
    return {
      sql: col('lga') + ' = ? AND ' + col('ward') + ' = ? AND ' + col('polling_unit') + ' = ?',
      params: [lga, ward, pollingUnit],
    };
  }

  // Fallback: own registrations plus own downline branch.
  return {
    sql: '(' + col('upline_user_id') + ' = ? OR ' + col('upline_member_id') + ' = ?)',
    params: [user.id, user.member_id || -1],
  };
}

/** The LGAs a user may pick from in dropdowns. */
export function scopedLgas(user) {
  if (ADMIN_ROLES.has(normaliseRole(user.role)) || user.scope_type === 'state') return LGAS;
  if (user.scope_type === 'polling_unit') {
    return [String(user.scope_value || '').split('|')[0]].filter(Boolean);
  }
  return lgasForScope(user.scope_type, user.scope_value);
}

/**
 * The wards a user may pick from inside one LGA. A State Assembly candidate
 * holds part of an LGA, not all of it, so their dropdown must not offer the
 * wards belonging to the candidate next door.
 */
export function scopedWards(user, lga) {
  if (user.scope_type !== 'state_const') return WARDS[lga] || [];
  const mine = wardsInStateConstituency(user.scope_value)
    .filter((w) => w.lga === lga)
    .map((w) => w.ward);
  return mine;
}

/** Whether a submitted registration location is inside the user's scope. */
export function locationInScope(user, location) {
  if (ADMIN_ROLES.has(normaliseRole(user.role)) || user.scope_type === 'state') return true;
  if (!scopedLgas(user).includes(location.lga)) return false;
  return scopedWards(user, location.lga).includes(location.ward);
}

/**
 * How much ground this user is responsible for -- the denominator behind
 * "wards reached". Measured against their own constituency rather than the
 * whole state, since "2 of 351" is meaningless to a candidate who only has
 * six wards to cover.
 */
export function scopeTargets(user) {
  const lgas = scopedLgas(user);
  const statewide = lgas.length === LGAS.length;

  let wards = 0;
  let pollingUnits = 0;
  for (const lga of lgas) {
    const wardNames = scopedWards(user, lga);
    wards += wardNames.length;
    for (const ward of wardNames) {
      pollingUnits += (POLLING_UNITS[lga]?.[ward] || []).length;
    }
  }

  return {
    lgas: lgas.length,
    wards: statewide ? TOTAL_WARDS : wards,
    polling_units: statewide ? POLLING_UNIT_BENCHMARK : pollingUnits,
    polling_unit_benchmark: POLLING_UNIT_BENCHMARK,
    // Programme-wide goals, unchanged: these are campaign targets, not
    // geography, so they do not shrink with a smaller constituency.
    engagements: TOTAL_WARDS * 100,
    mobilisers: TOTAL_WARDS * 10,
  };
}

/**
 * How much ground has actually been reached, counted honestly.
 *
 * Two things were wrong with counting it in SQL. `COUNT(DISTINCT ward)` counts
 * ward NAMES, and a ward is only a ward together with its LGA -- two names are
 * shared between LGAs, and polling-unit names repeat far more (6,364 units,
 * 6,263 distinct names). And nothing checked the values against the INEC list,
 * so a ward spelled some other way on the way in counted as ground covered:
 * that is how the dashboard came to show 389 of 351 wards, a coverage figure
 * larger than the thing being covered.
 *
 * So: match each place against the register, count what matches, and report
 * what does not instead of quietly folding it into the total.
 *
 * @param {Array<{lga: string, ward: string, polling_unit: string}>} places
 *   distinct rows from `members`
 * @param {{lgas: number, wards: number, polling_units: number}} targets
 */
export function coverageOf(places, targets, user = null) {
  const allowedWards = user ? new Set(scopedLgas(user).flatMap(lga=>scopedWards(user,lga).map(ward=>lga+'|'+ward))) : null;
  const wards = new Set();
  const units = new Set();
  const lgas = new Set();
  const strayWards = new Set();
  const strayUnits = new Set();

  const promoterCounts = new Map();
  for (const place of places || []) {
    const { lga, ward, polling_unit: unit } = canonicalLocation(place);
    if (!LGAS.includes(lga)) continue;
    if (allowedWards && !allowedWards.has(lga+'|'+ward)) continue;

    if (!(WARDS[lga] || []).includes(ward)) {
      if (ward) strayWards.add(lga + ' / ' + ward);
      continue;
    }

    if (!(POLLING_UNITS[lga]?.[ward] || []).includes(unit)) {
      if (unit) strayUnits.add(lga + ' / ' + ward + ' / ' + unit);
      continue;
    }
    const key = JSON.stringify([lga,ward,unit]);
    promoterCounts.set(key,(promoterCounts.get(key)||0)+Number(place.promoters||0));
  }
  for (const [key,count] of promoterCounts) {
    const [lga,ward,unit]=JSON.parse(key);
    lgas.add(lga);
    wards.add(lga + '|' + ward);
    units.add(lga + '|' + ward + '|' + unit);
  }

  const saturationExpected = Math.max(0,Number(targets.polling_units || 0));
  const saturationCompleted = Math.min(saturationExpected,[...promoterCounts.values()].filter(count=>count>=10).length);
  const share = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
  return {
    lgas: lgas.size,
    wards: wards.size,
    units: units.size,
    wards_remaining: Math.max(0, targets.wards - wards.size),
    units_remaining: Math.max(0, targets.polling_units - units.size),
    wards_percent: share(wards.size, targets.wards),
    units_percent: share(units.size, targets.polling_units),
    saturation_completed: saturationCompleted,
    saturation_expected: saturationExpected,
    saturation_remaining: Math.max(0,saturationExpected-saturationCompleted),
    saturation_percent: saturationExpected ? Math.floor(saturationCompleted/saturationExpected*100) : 0,
    // Places recorded against something that is not in the INEC register.
    // Never counted as coverage; surfaced so they can be corrected.
    unrecognised_wards: strayWards.size,
    unrecognised_units: strayUnits.size,
    unrecognised_examples: [...strayWards].slice(0, 5),
  };
}
