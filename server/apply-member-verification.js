import { vinKey, verifyMemberLocation } from './member-vin-verification.js';
import { hasPollingUnit } from './data/geo.js';

const invalid = message => { const e = Error(message); e.reportError = true; throw e; };
export function validateVerificationReport(report) {
  if (report?.version !== 1 || !Array.isArray(report.updates) || !report.updates.length || report.updates.length > 100000) invalid('This is not a supported member verification report');
  const seen = new Set();
  return report.updates.map(r => {
    if (!/^\d+$/.test(String(r.id)) || seen.has(String(r.id)) || !r.code || !r.original || !r.verification) invalid('The report has missing or repeated member identifiers');
    seen.add(String(r.id));
    const v = verifyMemberLocation({ ...r.original, pvc_no: r.pvc_no }, r.verification.registered ? [r.verification.registered] : [], r.verification.duplicate_vin === true);
    // Conflicting roll locations have deliberately no single registered location.
    if (r.verification.status === 'needs_review' && !r.verification.registered && vinKey(r.pvc_no)) {
      v.status = 'needs_review'; v.reason = 'VIN has conflicting registered locations'; v.assignment = null;
    }
    return { id: Number(r.id), code: String(r.code), owner: r.upline_user_id ? Number(r.upline_user_id) : null,
      vin: vinKey(r.pvc_no), original: r.original, verification: v };
  });
}

export async function applyMemberVerificationReport(db, report) {
  const rows = validateVerificationReport(report);
  return db.transaction(async tx => {
    const saved = await tx.prepare('SELECT id, code, upline_user_id, pvc_no, lga, ward, polling_unit FROM members WHERE id = ANY(?::int[]) FOR UPDATE').all(rows.map(r => r.id));
    const byId = new Map(saved.map(r => [Number(r.id), r]));
    for (const r of rows) {
      const m = byId.get(r.id);
      const samePlace = place => place && ['lga','ward','polling_unit'].every(k => m?.[k] === place[k]);
      if (!m || m.code !== r.code || Number(m.upline_user_id || 0) !== Number(r.owner || 0) || vinKey(m.pvc_no) !== r.vin || (!samePlace(r.original) && !samePlace(r.verification.assignment))) invalid('A member changed since the export. Export the current nominees and verify again before applying this report.');
    }
    const stamp = new Date().toISOString();
    const changes = rows.map(r => ({ id:r.id, lga:r.verification.assignment?.lga || byId.get(r.id).lga,
      ward:r.verification.assignment?.ward || byId.get(r.id).ward, polling_unit:r.verification.assignment?.polling_unit || byId.get(r.id).polling_unit,
      resolved:Number(hasPollingUnit(r.verification.assignment || byId.get(r.id))),
      status:r.verification.status, detail:JSON.stringify({...r.verification,checked_at:stamp,sources:report.sources}) }));
    await tx.prepare(`UPDATE members m SET lga=r.lga, ward=r.ward, polling_unit=r.polling_unit,
      vin_verification_status=r.status, vin_verification_json=r.detail, polling_unit_resolved=r.resolved
      FROM jsonb_to_recordset(?::jsonb) AS r(id integer,lga text,ward text,polling_unit text,status text,detail text,resolved integer)
      WHERE m.id=r.id`).run(JSON.stringify(changes));
    await tx.prepare(`UPDATE users u SET scope_value=m.lga || '|' || m.ward || '|' || m.polling_unit
      FROM members m WHERE u.member_id=m.id AND m.id = ANY(?::int[])`).run(rows.map(r=>r.id));
    return {ok:true, updated:rows.length, assigned:changes.filter(r=>r.resolved===1).length};
  });
}
