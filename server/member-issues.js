import { hasPollingUnit } from './data/geo.js';
import { memberDataFilters, memberDateFilters } from './member-list-filters.js';
export const ISSUE_STATUSES = ['missing_vin', 'vin_not_found', 'needs_review', 'location_mismatch'];
export const ISSUE_COLUMNS = ['id', 'code', 'candidate_name', 'candidate_username', 'candidate_id',
  'first_name', 'last_name', 'phone', 'vin', 'issue', 'action_required',
  'submitted_lga', 'submitted_ward', 'submitted_polling_unit',
  'current_lga', 'current_ward', 'current_polling_unit',
  'registered_lga', 'registered_ward', 'registered_polling_unit',
  'polling_unit_corrected', 'polling_unit_source', 'corrected_vin', 'corrected_lga', 'corrected_ward', 'corrected_polling_unit', 'correction_notes'];

export function memberIssueRow(member) {
  let v = {};
  try { v = JSON.parse(member.vin_verification_json || '{}') || {}; } catch { /* use saved status */ }
  const status = member.vin_verification_status;
  const submitted = v.submitted || member;
  const registered = v.registered || {};
  const assigned = Boolean(v.assignment) && hasPollingUnit(member) && ['lga','ward','polling_unit'].every(k => member[k] === v.assignment[k]);
  const actions = {
    missing_vin: 'Supply the VIN exactly as printed on the PVC.',
    vin_not_found: 'Check the VIN against the PVC and correct any typing error. If correct, provide the relevant voter record.',
    needs_review: v.reason || 'Confirm the VIN and registered location with the responsible officer.',
    location_mismatch: assigned ? 'Registered location has been assigned. Confirm the correction; the original submission is shown for reference.'
      : 'Check the submitted location against the registered location and supply the correct ward and polling unit.',
  };
  return {id:member.id, code:member.code, candidate_name:member.owner_name || member.upline_name || '',
    candidate_username:member.owner_username || member.upline_username || '', candidate_id:member.upline_user_id,
    first_name:member.first_name,last_name:member.last_name,phone:member.phone,vin:member.pvc_no,
    issue:status,action_required:actions[status] || 'Verification has not been completed.',
    submitted_lga:submitted.lga,submitted_ward:submitted.ward,submitted_polling_unit:submitted.polling_unit,
    current_lga:member.lga,current_ward:member.ward,current_polling_unit:member.polling_unit,
    registered_lga:registered.lga,registered_ward:registered.ward,registered_polling_unit:registered.polling_unit,
    polling_unit_corrected:assigned ? 'Yes' : 'No', polling_unit_source:v.assignment_source || '', corrected_vin:'',corrected_lga:'',corrected_ward:'',corrected_polling_unit:'',correction_notes:''};
}

// The same supported filters are applied to the downloadable report and the list.
export function memberExportFilters(query) {
  const where=[],params=[];
  where.push(...memberDataFilters(query));
  const dates = memberDateFilters(query);
  where.push(...dates.where); params.push(...dates.params);
  for (const key of ['level','status','lga','ward','upline_user_id','vin_verification_status','contact_verification_status']) {
    if (query[key]) { where.push('m.'+key+' = ?'); params.push(query[key]); }
  }
  if (query.q) {
    where.push('(m.first_name ILIKE ? OR m.last_name ILIKE ? OR m.phone ILIKE ? OR m.code ILIKE ? OR m.polling_unit ILIKE ?)');
    params.push(...Array(5).fill('%'+query.q+'%'));
  }
  if(query.issues==='1') where.push("m.vin_verification_status IN ('missing_vin','vin_not_found','needs_review','location_mismatch')");
  if(query.polling_unit_presence==='with') where.push('m.polling_unit_resolved = 1');
  if(query.polling_unit_presence==='without') where.push('m.polling_unit_resolved = 0');
  return {where,params};
}
