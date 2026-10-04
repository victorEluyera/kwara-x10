// Which places a task covers, and who may target which places.
//
// A task's target is (target_scope_type, target_scope_value):
//   state                          everyone
//   lga          'Egbeda'          one LGA
//   ward         'Egbeda|ERUNMU'   one ward (a bare ward name is still read,
//                                  for tasks created before wards carried
//                                  their LGA)
//   senatorial / federal / state_const
//                <constituency>    a candidate's whole jurisdiction
//
// Constituency targets exist so a candidate can set work for "everyone in my
// constituency" without the task going stale if they would otherwise have to
// pick every LGA or ward one by one. They are resolved here, in JS, rather
// than in SQL, because a State Assembly seat is a list of wards that only
// ward-constituencies.js knows.

import { ADMIN_ROLES, normaliseRole } from './auth.js';
import { WARDS, lgasForScope } from './data/geo.js';
import { wardsInStateConstituency } from './data/ward-constituencies.js';

const ALL = Object.freeze({ all: true });

/** { all: true } or { places: [{ lga, ward|null }] } -- ward null means the whole LGA. */
export function taskArea(type, value) {
  if (!type || type === 'state') return ALL;
  if (type === 'lga') return { places: value ? [{ lga: value, ward: null }] : [] };
  if (type === 'ward') {
    const [a, b] = String(value || '').split('|');
    if (b) return { places: [{ lga: a, ward: b }] };
    return { places: Object.entries(WARDS)
      .filter(([, wards]) => wards.includes(a)).map(([lga]) => ({ lga, ward: a })) };
  }
  if (type === 'state_const') return { places: wardsInStateConstituency(value) };
  if (type === 'senatorial' || type === 'federal') {
    return { places: lgasForScope(type, value).map((lga) => ({ lga, ward: null })) };
  }
  return { places: [] };
}

/** The area a signed-in user works in, in the same shape. */
export function userArea(user) {
  if (ADMIN_ROLES.has(normaliseRole(user.role)) || user.scope_type === 'state' || !user.scope_type) return ALL;
  if (user.scope_type === 'polling_unit') {
    const [lga, ward] = String(user.scope_value || '').split('|');
    return { places: lga ? [{ lga, ward: ward || null }] : [] };
  }
  return taskArea(user.scope_type, user.scope_value);
}

const placeIn = (lga, ward, area) => area.all
  || area.places.some((p) => p.lga === lga && (p.ward == null || ward == null || p.ward === ward));

/** Does a task apply to someone in this LGA and ward? */
export function taskAppliesTo(task, lga, ward) {
  const area = taskArea(task.target_scope_type, task.target_scope_value);
  return area.all || area.places.some((p) => p.lga === lga && (p.ward == null || p.ward === ward));
}

/** Do two areas share any ground? Used to decide which tasks a user sees. */
export function areasOverlap(a, b) {
  if (a.all || b.all) return true;
  return a.places.some((p) => placeIn(p.lga, p.ward, b));
}

/** Is every place in `inner` inside `outer`? */
function within(inner, outer) {
  if (outer.all) return true;
  if (inner.all || !inner.places.length) return false;
  return inner.places.every((p) => outer.places.some((o) =>
    o.lga === p.lga && (o.ward == null || (p.ward != null && o.ward === p.ward))));
}

/**
 * May this user create or edit a task with this target? Administrators may
 * target anywhere; a candidate only inside their own jurisdiction.
 */
export function canTarget(user, type, value) {
  if (ADMIN_ROLES.has(normaliseRole(user.role))) return true;
  if (!['state', 'lga', 'ward', 'senatorial', 'federal', 'state_const'].includes(type)) return false;
  return within(taskArea(type, value), userArea(user));
}
