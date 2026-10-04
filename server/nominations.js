import { POLLING_UNITS, canonicalLocation } from './data/geo.js';
import { scopedLgas, scopedWards } from './scope.js';

export function nominationQuota(office) {
  const value = String(office || '').trim().toLowerCase();
  if (value.includes('senator')) return 4;
  if (value.includes('representative') || value.includes('assembly')) return 3;
  return null;
}
export const unlimitedNominations = (office) => ['Stakeholder', 'Deputy Governor'].includes(office);
export const unitKey = (row) => JSON.stringify([row.lga, row.ward, row.polling_unit]);
export function nominationUnits(user) {
  return scopedLgas(user).flatMap((lga) => scopedWards(user, lga).flatMap((ward) =>
    (POLLING_UNITS[lga]?.[ward] || []).map((polling_unit) => ({ lga, ward, polling_unit }))));
}
export function nominationSummary(user, nominees) {
  // Allocation depends on recorded location, not retired approval labels.
  const active = nominees;
  const overQuota = active.filter((row) => Number(row.over_quota)).length;
  const perUnit = nominationQuota(user.office);
  if (unlimitedNominations(user.office)) return {
    unlimited: true, quota: null, per_polling_unit: null, count: active.length, total_count: active.length,
    remaining: null, complete: false, units: [], over_quota: 0,
  };
  if (perUnit == null) return null;
  const counts = new Map();
  for (const row of active) {
    const key = unitKey(canonicalLocation(row));
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const units = nominationUnits(user).map((unit) => {
    const count = counts.get(unitKey(unit)) || 0;
    return { ...unit, count, quota: perUnit, remaining: Math.max(0, perUnit - count) };
  });
  const remaining = units.reduce((sum, unit) => sum + unit.remaining, 0);
  const count = units.reduce((sum, unit) => sum + unit.count, 0);
  return {
    quota: units.length * perUnit, per_polling_unit: perUnit, polling_units: units.length,
    count, total_count: active.length, remaining, complete: units.length > 0 && remaining === 0,
    // Recorded rather than refused -- see validateNomination.
    over_quota: overQuota,
    over_quota_units: units.filter((unit) => unit.count > perUnit).length,
    completed_polling_units: units.filter((unit) => unit.remaining === 0).length,
    unallocated: active.length - count, units,
  };
}
/**
 * Check a nomination's location and quota.
 *
 * Returns null when there is nothing to say, `{ error, status }` for a
 * location that cannot be accepted at all, or `{ warning, over_quota: true }`
 * for one that goes past the candidate's allowance.
 *
 * The quota is deliberately NOT a refusal. A candidate who has genuinely
 * recruited five people in a unit that allows four should be able to record
 * all five -- the register is meant to reflect what is actually on the ground,
 * and a number the campaign can see and query is worth more than a fifth
 * person left off the books or entered under a neighbouring unit to get
 * around the block. The row is stored with over_quota set so the excess is
 * visible and countable rather than hidden.
 */
export async function validateNomination(tx, user, location, excludeId = null) {
  if (user?.role !== 'candidate') return null;
  const wards = scopedWards(user, location.lga);
  const validWard = scopedLgas(user).includes(location.lga) && wards.includes(location.ward);
  // Unlimited nominators may recruit at ward level before assigning a polling unit.
  const wardOnly = unlimitedNominations(user.office)
    && (!location.polling_unit || location.polling_unit === 'Not specified');
  if (!validWard || (!wardOnly && !(POLLING_UNITS[location.lga]?.[location.ward] || []).includes(location.polling_unit))) {
    return { ok: false, status: 400, error: 'Select a valid location within the candidate area. Legislative nominees require a polling unit.' };
  }
  const quota = nominationQuota(user.office);
  if (quota == null) return null;
  const row = await tx.prepare(
    "SELECT COUNT(*) n FROM members WHERE upline_user_id = ? AND level = 'mobiliser' "
    + "AND lga = ? AND ward = ? AND polling_unit = ? AND id != ?"
  ).get(user.id, location.lga, location.ward, location.polling_unit, excludeId || -1);
  const already = Number(row?.n || 0);
  if (already >= quota) return {
    ok: true, over_quota: true,
    warning: 'This polling unit already has ' + already + ' of the ' + quota
      + ' nominees allowed. This one is being recorded as over the limit.',
  };
  return null;
}
