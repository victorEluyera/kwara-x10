import fs from 'node:fs';
import path from 'node:path';
import { parseCsv } from './xlsx-read.js';
import { eachRow, listSheets } from './xlsx-stream.js';
import { canonicalLocation, POLLING_UNITS, LGAS, WARDS } from './data/geo.js';
import { constituenciesForWard } from './data/ward-constituencies.js';
import { COLUMNS } from './nominee-template.js';

const [nomineePath, registerPath, outputPath] = process.argv.slice(2);
if (!nomineePath || !registerPath || !outputPath) throw new Error('Usage: node server/reconcile-nominees.js NOMINEES.csv REGISTER.xlsx OUTPUT_DIRECTORY');
const vinKey = (v) => String(v || '').toUpperCase().replace(/\s/g, '');
const nameKey = (v) => String(v || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
const compatibleName = (nominee, register) => {
  const a = nameKey(nominee), b = nameKey(register);
  if (a === b) return true;
  const parts = new Set(a.split(' ').filter(Boolean));
  const registerParts = new Set(b.split(' ').filter(Boolean));
  return parts.size >= 2 && [...parts].every((p) => registerParts.has(p));
};
const placeKey = (r) => JSON.stringify([r.lga, r.ward, r.polling_unit]);
const cell = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
const writeCsv = (file, rows, columns) => fs.writeFileSync(file,
  '\uFEFF' + [columns.map(cell).join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\r\n') + '\r\n');
const csv = parseCsv(fs.readFileSync(nomineePath, 'utf8'));
const headers = csv.shift();
const nominees = csv.filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] || ''])));
const targets = new Map();
const nameTargets = new Map();
const nameSuggestions = nominees.map(() => new Map());
const nomineeLocations = nominees.map(canonicalLocation);
for (let i = 0; i < nominees.length; i++) {
  const key = nameKey(nominees[i].first_name + ' ' + nominees[i].last_name);
  if (!nameTargets.has(key)) nameTargets.set(key, []);
  nameTargets.get(key).push(i);
}
for (const n of nominees) {
  const vin = vinKey(n.pvc_no);
  if (!vin) continue;
  if (!targets.has(vin)) targets.set(vin, { nominees: [], records: new Map() });
  targets.get(vin).nominees.push(n.id);
}
const counts = new Map();
const locationCache = new Map();
const sheetTotals = [];
let scanned = 0;
for (const sheet of await listSheets(registerPath)) {
  let columns;
  let dataRows = 0;
  await eachRow(registerPath, sheet, (row, number) => {
    if (number === 1) { columns = new Map(row.map((h, i) => [String(h).trim().toLowerCase(), i])); return; }
    if (!columns.has('voter id number')) return;
    const vin = vinKey(row[columns.get('voter id number')]);
    if (!vin) return;
    dataRows++; scanned++;
    const rawPlace = { lga: row[columns.get('lga')], ward: row[columns.get('ward')], polling_unit: row[columns.get('polling unit')] };
    const rawKey = placeKey(rawPlace);
    if (!locationCache.has(rawKey)) locationCache.set(rawKey, canonicalLocation(rawPlace));
    const place = locationCache.get(rawKey);
    const key = placeKey(place);
    if (!counts.has(key)) counts.set(key, { ...place, voters: 0 });
    counts.get(key).voters++;
    const target = targets.get(vin);
    const name = row[columns.get('name')] || '';
    if (target) {
      target.records.set(JSON.stringify([nameKey(name), key]), { ...place, name });
    }
    for (const index of nameTargets.get(nameKey(name)) || []) {
      const original = nomineeLocations[index];
      const knownWard = (WARDS[original.lga] || []).includes(original.ward);
      if (knownWard && (original.lga !== place.lga || original.ward !== place.ward)) continue;
      if (!knownWard && ownerScope(nominees[index], place) !== true) continue;
      const suggestions = nameSuggestions[index];
      if (suggestions.size < 3) suggestions.set(JSON.stringify([vin, key]), { ...place, name, vin });
    }
    if (scanned % 250000 === 0) console.log(JSON.stringify({ scanned_voters: scanned, matched_unique_vins: [...targets.values()].filter((t) => t.records.size > 0).length }));
  });
  sheetTotals.push({ sheet: sheet.name, voter_rows: dataRows });
  console.log(JSON.stringify({ sheet_complete: sheet.name, voter_rows: dataRows }));
}

function ownerScope(n, place) {
  const meta = constituenciesForWard(place.lga, place.ward);
  const office = n.owner_office.toLowerCase();
  if (office.includes('governor')) return true;
  const area = n.owner_constituency;
  if (office.includes('senator')) return meta?.senatorial === area;
  if (office.includes('representative')) return meta?.federal === area;
  if (office.includes('assembly')) return meta?.state === area;
  if (office === 'stakeholder') {
    if (!area) return null;
    if (LGAS.includes(area)) return place.lga === area;
    return meta && [meta.state, meta.federal, meta.senatorial].includes(area) ? true : null;
  }
  return null;
}

const statuses = {};
const owners = new Map();
const output = nominees.map((n, index) => {
  const original = { original_lga: n.lga, original_ward: n.ward, original_polling_unit: n.polling_unit };
  const normalized = canonicalLocation(n);
  const target = targets.get(vinKey(n.pvc_no));
  const register = target?.records.size === 1 ? [...target.records.values()][0] : null;
  const flags = [];
  if (n.status === 'rejected') flags.push('rejected_nominee');
  if (!target) flags.push('missing_vin');
  else if (!target.records.size) flags.push('vin_not_found');
  else if (target.records.size > 1) flags.push('ambiguous_register_vin');
  if (target?.nominees.length > 1) flags.push('duplicate_nominee_vin');
  if (register) {
    if (!compatibleName(n.first_name + ' ' + n.last_name, register.name)) flags.push('name_differs_from_register');
    if (!(POLLING_UNITS[register.lga]?.[register.ward] || []).includes(register.polling_unit)) flags.push('register_location_unrecognised');
    const scope = ownerScope(n, register);
    if (scope === false) flags.push('register_location_outside_candidate_area');
    if (scope == null) flags.push('candidate_scope_needs_review');
  }
  const status = flags.length ? flags[0] : 'confirmed';
  statuses[status] = (statuses[status] || 0) + 1;
  const confirmed = status === 'confirmed';
  const suggestions = nameSuggestions[index];
  const suggestion = !confirmed && suggestions.size === 1 ? [...suggestions.values()][0] : null;
  const row = { ...n, ...normalized, ...(confirmed ? { lga: register.lga, ward: register.ward, polling_unit: register.polling_unit } : {}),
    ...original, reconciliation_status: status, review_reasons: flags.join('; '),
    register_name: register?.name || '', register_lga: register?.lga || '', register_ward: register?.ward || '', register_polling_unit: register?.polling_unit || '',
    name_only_match: !confirmed && suggestions.size === 1 ? 'unique_suggestion_needs_identity_confirmation' : !confirmed && suggestions.size > 1 ? 'multiple_possible_voters' : '',
    suggested_pvc_no: suggestion?.vin || '', suggested_lga: suggestion?.lga || '', suggested_ward: suggestion?.ward || '', suggested_polling_unit: suggestion?.polling_unit || '' };
  if (!owners.has(n.upline_user_id)) owners.set(n.upline_user_id, { owner_id: n.upline_user_id, owner_name: n.owner_name,
    owner_username: n.owner_username, office: n.owner_office, constituency: n.owner_constituency, nominees: 0, confirmed: 0, needs_review: 0 });
  const owner = owners.get(n.upline_user_id);
  owner.nominees++; owner.confirmed += Number(confirmed); owner.needs_review += Number(!confirmed);
  return row;
});
fs.mkdirSync(outputPath, { recursive: true });
fs.copyFileSync(nomineePath, path.join(outputPath, 'original-nominees.csv'));
const columns = [...headers, 'original_lga', 'original_ward', 'original_polling_unit', 'reconciliation_status', 'review_reasons',
  'register_name', 'register_lga', 'register_ward', 'register_polling_unit', 'name_only_match', 'suggested_pvc_no', 'suggested_lga', 'suggested_ward', 'suggested_polling_unit'];
writeCsv(path.join(outputPath, 'reconciled-nominees.csv'), output, columns);
writeCsv(path.join(outputPath, 'nominees-needing-review.csv'), output.filter((r) => r.reconciliation_status !== 'confirmed'), columns);
writeCsv(path.join(outputPath, 'confirmed-nominees.csv'), output.filter((r) => r.reconciliation_status === 'confirmed'), columns);
writeCsv(path.join(outputPath, 'name-matches-for-review.csv'), output.filter((r) => r.name_only_match), columns);
writeCsv(path.join(outputPath, 'candidate-summary.csv'), [...owners.values()], Object.keys([...owners.values()][0]));
writeCsv(path.join(outputPath, 'voters-by-location.csv'), [...counts.values()], ['lga', 'ward', 'polling_unit', 'voters']);
const batchDirectory = path.join(outputPath, 'confirmed-import-batches');
fs.mkdirSync(batchDirectory, { recursive: true });
let batches = 0;
for (const [id] of owners) {
  const ready = output.filter((r) => r.upline_user_id === id && r.reconciliation_status === 'confirmed');
  for (let at = 0; at < ready.length; at += 5000) {
    const importColumns = [...COLUMNS.map((c) => c.key), 'original_member_id', 'original_code', 'upline_user_id', 'owner_username'];
    const records = ready.slice(at, at + 5000).map((r) => ({ ...r, original_member_id: r.id, original_code: r.code }));
    writeCsv(path.join(batchDirectory, `candidate-${id}-part-${Math.floor(at / 5000) + 1}.csv`), records, importColumns);
    batches++;
  }
}
const summary = { input_nominees: nominees.length, owners: owners.size, voter_rows_scanned: scanned, sheets: sheetTotals,
  with_vin: nominees.filter((n) => vinKey(n.pvc_no)).length,
  matched_unique_vins: [...targets.values()].filter((t) => t.records.size > 0).length,
  statuses, confirmed: statuses.confirmed || 0, needs_review: nominees.length - (statuses.confirmed || 0), import_batches: batches,
  unique_name_only_suggestions: output.filter((r) => r.name_only_match === 'unique_suggestion_needs_identity_confirmation').length,
  ambiguous_name_only_suggestions: output.filter((r) => r.name_only_match === 'multiple_possible_voters').length,
  ownership_preserved: output.every((r, i) => r.upline_user_id === nominees[i].upline_user_id && r.id === nominees[i].id),
  note: 'No live database changes. Names differing from the register, duplicate VINs, and boundary conflicts require review. Import batches require selecting their stated candidate and resolving existing duplicate records first.' };
fs.writeFileSync(path.join(outputPath, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary));
