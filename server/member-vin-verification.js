import { canonicalLocation, POLLING_UNITS, hasPollingUnit, WARDS } from './data/geo.js';

export const vinKey = value => String(value || '').toUpperCase().replace(/\s/g, '');
export const placeKey = place => JSON.stringify(['lga', 'ward', 'polling_unit'].map(k => place[k] || ''));
export function verifyMemberLocation(member, locations, duplicate = false) {
  const submitted = canonicalLocation(member);
  const rawSubmitted = Object.fromEntries(['lga','ward','polling_unit'].map(k => [k,String(member[k] || '')]));
  const unitKnown=hasPollingUnit(submitted);
  const wardKnown=(WARDS[submitted.lga] || []).includes(submitted.ward);
  const result = { status: 'not_checked', submitted:rawSubmitted, normalized_submitted:submitted, registered: null, differences: [], duplicate_vin: duplicate,
    assignment: unitKnown || wardKnown ? submitted : null,
    assignment_source: unitKnown ? 'submitted_official_directory' : wardKnown ? 'submitted_official_ward' : null,
    submitted_location_corrections: ['lga','ward','polling_unit'].filter(k=>rawSubmitted[k]!==submitted[k]) };
  if (!vinKey(member.pvc_no)) return { ...result, status: 'missing_vin' };
  if (!locations.length) return { ...result, status: 'vin_not_found' };
  const unique = [...new Map(locations.map(p => { const c = canonicalLocation(p); return [placeKey(c), c]; })).values()];
  if (unique.length !== 1) return { ...result, status: 'needs_review', reason: 'VIN has conflicting registered locations' };
  result.registered = unique[0];
  result.differences = ['lga', 'ward', 'polling_unit'].filter(k => submitted[k] !== result.registered[k]);
  const real = (POLLING_UNITS[result.registered.lga]?.[result.registered.ward] || []).includes(result.registered.polling_unit);
  if (!real) return { ...result, status: 'needs_review', reason: 'Registered polling unit requires mapping' };
  // Duplicate nominees stay visible but need review before changing their locations.
  if (duplicate) return { ...result, status: 'needs_review', reason: 'VIN occurs on multiple nominee records' };
  result.assignment = result.registered;
  result.assignment_source = 'vin_register';
  result.status = result.differences.length ? 'location_mismatch' : 'verified';
  return result;
}
