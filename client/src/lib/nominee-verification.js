export const VIN_LABELS={verified:'VIN/location match',not_checked:'Not checked yet',missing_vin:'Missing VIN',vin_not_found:'VIN not found',location_mismatch:'Location differs',needs_review:'Needs clarification'};
export function nomineeVerificationLabel(row) {
  if(!String(row.pvc_no||'').trim())return VIN_LABELS.missing_vin;
  return VIN_LABELS[row.vin_verification_status]||VIN_LABELS.not_checked;
}
