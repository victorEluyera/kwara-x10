export function nomineeVerificationSummary(rows) {
  const counts={verified:0,not_checked:0,missing_vin:0,vin_not_found:0,location_mismatch:0,needs_review:0};
  for(const row of rows){
    const status=!String(row.pvc_no||'').trim()?'missing_vin':Object.hasOwn(counts,row.vin_verification_status)?row.vin_verification_status:'not_checked';
    counts[status]++;
  }
  return {total:rows.length,...counts,needs_correction:counts.missing_vin+counts.vin_not_found+counts.location_mismatch+counts.needs_review};
}
