// Check everyone already on the register against the INEC roll.
//
//   node server/audit-voter-roll.js [--out=report.csv] [--level=mobiliser] [--limit=N]
//
// READ-ONLY. It changes nothing: no statuses, no flags, no deletions. The
// point is to find out how many existing entries would fail before deciding
// how strict to be, and who to go back to. Nobody should be removed from a
// list of real people on the strength of a report nobody has read.
//
// Run it after loading the register (see load-voter-roll.js).

import fs from 'node:fs';
import { db } from './db.js';
import { voterRollSize } from './verify.js';
import { rollNameKey, maskVin } from './nominee-import.js';
import { toCsv } from './xlsx.js';

/** One verdict per member, in the order they matter. */
export const OUTCOMES = {
  ok: 'In the register, at the right unit',
  no_vin: 'No PVC/VIN recorded',
  not_found: 'VIN is not in the register',
  unit_mismatch: 'In the register, but at another polling unit',
  name_mismatch: 'In the register, but under another surname',
};

const surname = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
const clean = (s) => String(s || '').trim().toLowerCase();

/**
 * Judge one member against their register entry.
 * @param {object} member
 * @param {object|null} hit       the voter_roll row for their VIN
 * @param {object[]} [nameHits]   register entries with that surname in that unit
 */
export function verdictFor(member, hit, nameHits = []) {
  const suggest = () => {
    if (nameHits.length !== 1) return '';
    const [only] = nameHits;
    return [only.first_name, only.last_name].filter(Boolean).join(' ')
      + ' / ' + maskVin(only.vin);
  };

  if (!member.pvc_no) return { outcome: 'no_vin', detail: '', suggestion: suggest() };
  if (!hit) return { outcome: 'not_found', detail: '', suggestion: suggest() };

  if (clean(hit.polling_unit) && clean(member.polling_unit)
      && clean(hit.polling_unit) !== clean(member.polling_unit)) {
    return { outcome: 'unit_mismatch', detail: 'register says: ' + hit.polling_unit,
      suggestion: '' };
  }
  if (hit.last_name && surname(hit.last_name) !== surname(member.last_name)) {
    return { outcome: 'name_mismatch', detail: 'register says: ' + hit.last_name,
      suggestion: '' };
  }
  return { outcome: 'ok', detail: '', suggestion: '' };
}

const CHUNK = 500;

export async function audit({ level = null, limit = Infinity } = {}) {
  if (await voterRollSize() === 0) {
    throw new Error('No register loaded. Run load-voter-roll.js first.');
  }

  const where = ["m.status <> 'rejected'"];
  const params = [];
  if (level) { where.push('m.level = ?'); params.push(level); }

  const members = await db.prepare(
    'SELECT m.id, m.code, m.first_name, m.last_name, m.phone, m.pvc_no, '
    + 'm.lga, m.ward, m.polling_unit, m.status, m.created_at, '
    + 'u.full_name AS candidate, u.office '
    + 'FROM members m LEFT JOIN users u ON u.id = m.upline_user_id '
    + 'WHERE ' + where.join(' AND ') + ' ORDER BY m.created_at'
  ).all(...params);

  const rows = members.slice(0, limit === Infinity ? undefined : limit);

  // The register entries for the VINs these people claim.
  const vins = [...new Set(rows.map((r) => String(r.pvc_no || '').toUpperCase()).filter(Boolean))];
  const byVin = new Map();
  for (let i = 0; i < vins.length; i += CHUNK) {
    const slice = vins.slice(i, i + CHUNK);
    for (const hit of await db.prepare(
      'SELECT vin, first_name, last_name, lga, ward, polling_unit FROM voter_roll '
      + 'WHERE vin IN (' + slice.map(() => '?').join(',') + ')'
    ).all(...slice)) byVin.set(String(hit.vin).toUpperCase(), hit);
  }

  // And, for the ones it could not answer for, who the register has of that
  // surname in that unit -- the same fallback the importer offers.
  const unmatched = rows.filter((r) =>
    !r.pvc_no || !byVin.has(String(r.pvc_no).toUpperCase()));
  const byName = new Map();
  if (unmatched.length) {
    const surnames = [...new Set(unmatched.map((r) => clean(r.last_name)).filter(Boolean))];
    const units = [...new Set(unmatched.map((r) => r.polling_unit).filter(Boolean))];
    for (let i = 0; i < surnames.length && units.length; i += CHUNK) {
      const slice = surnames.slice(i, i + CHUNK);
      for (const hit of await db.prepare(
        'SELECT vin, first_name, last_name, polling_unit FROM voter_roll '
        + 'WHERE LOWER(last_name) IN (' + slice.map(() => '?').join(',') + ') '
        + 'AND polling_unit IN (' + units.map(() => '?').join(',') + ') LIMIT 20000'
      ).all(...slice, ...units)) {
        const key = rollNameKey(hit.last_name, hit.polling_unit);
        if (!byName.has(key)) byName.set(key, []);
        byName.get(key).push(hit);
      }
    }
  }

  const tally = Object.fromEntries(Object.keys(OUTCOMES).map((k) => [k, 0]));
  const byCandidate = new Map();
  const report = [];

  for (const m of rows) {
    const hit = byVin.get(String(m.pvc_no || '').toUpperCase()) || null;
    const nameHits = byName.get(rollNameKey(m.last_name, m.polling_unit)) || [];
    const { outcome, detail, suggestion } = verdictFor(m, hit, nameHits);

    tally[outcome]++;
    const who = m.candidate || '(no candidate)';
    if (!byCandidate.has(who)) byCandidate.set(who, { total: 0, failed: 0 });
    byCandidate.get(who).total++;
    if (outcome !== 'ok') byCandidate.get(who).failed++;

    report.push({
      code: m.code,
      name: [m.first_name, m.last_name].filter(Boolean).join(' '),
      candidate: who,
      office: m.office || '',
      lga: m.lga, ward: m.ward, polling_unit: m.polling_unit,
      // Masked: the report is a working document that gets emailed around, and
      // a full VIN is the one thing that would let someone else's list be
      // filled in from it.
      pvc: maskVin(m.pvc_no),
      status: m.status,
      outcome,
      verdict: OUTCOMES[outcome],
      detail,
      suggestion,
    });
  }

  return { checked: rows.length, tally, byCandidate, report };
}

/* ----------------------------------- cli ----------------------------------- */

const invokedDirectly = String(process.argv[1] || '').endsWith('audit-voter-roll.js');
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const flag = (name) => args.find((a) => a.startsWith('--' + name + '='))?.split('=').slice(1).join('=');

  const result = await audit({
    level: flag('level') || null,
    limit: Number(flag('limit')) || Infinity,
  });

  const pct = (x) => (result.checked ? ((100 * x) / result.checked).toFixed(1) : '0.0') + '%';
  process.stderr.write(`\nChecked ${result.checked.toLocaleString()} people already registered\n\n`);
  for (const [key, label] of Object.entries(OUTCOMES)) {
    process.stderr.write(`  ${String(result.tally[key]).padStart(8)}  ${pct(result.tally[key]).padStart(6)}  ${label}\n`);
  }

  const worst = [...result.byCandidate.entries()]
    .filter(([, v]) => v.failed > 0)
    .sort((a, b) => b[1].failed - a[1].failed)
    .slice(0, 15);
  if (worst.length) {
    process.stderr.write('\nMost entries that would not pass, by candidate:\n');
    for (const [who, v] of worst) {
      process.stderr.write(`  ${String(v.failed).padStart(6)} of ${String(v.total).padEnd(6)} ${who}\n`);
    }
  }

  const out = flag('out');
  if (out) {
    const columns = Object.keys(result.report[0] || { code: '' });
    fs.writeFileSync(out, toCsv([columns, ...result.report.map((r) => columns.map((c) => r[c]))]));
    process.stderr.write(`\nWrote ${out}\n`);
  } else {
    process.stderr.write('\nPass --out=report.csv for the row-by-row list.\n');
  }

  process.stderr.write('\nNothing was changed. This is a report.\n');
  await db.pool.end();
}
