// Checking nominees against the INEC register.
//
// The rule is blunt on purpose: with a register loaded, a VIN that is not in
// it does not go on the list. Everything else the register disagrees about --
// a different polling unit, a different surname -- is raised and left to the
// candidate, because register spellings are not ours and the register is a
// snapshot that people move out of.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mapHeader, validateGrid, applyVoterRoll } from './nominee-import.js';
import { COLUMNS, buildNomineeTemplate } from './nominee-template.js';
import { readWorkbook } from './xlsx-read.js';
import { isValidVIN } from './verify.js';
import { mapHeader as mapRegisterHeader, readRow, splitName } from './load-voter-roll.js';
import { parseRow } from './xlsx-stream.js';
import { POLLING_UNITS } from './data/geo.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const LGA = 'Akinyele';
const WARD = 'IKEREKU';
const UNITS = POLLING_UNITS[LGA][WARD];
const SCOPE = { lgas: [LGA], wardsByLga: { [LGA]: [WARD] }, quota: 4 };
const HEADERS = COLUMNS.map((c) => c.header + (c.required ? ' *' : ''));
const row = (v) => COLUMNS.map((c) => v[c.key] ?? '');

const GOOD = {
  first_name: 'Adebayo', last_name: 'Ogundimu', phone: '08031234567',
  lga: LGA, ward: WARD, polling_unit: UNITS[0], pvc_no: '90F5B187F8295693903',
};
const grid = (rows) => validateGrid([HEADERS, ...rows.map(row)], SCOPE);

const register = (entries) => new Map(entries.map((e) => [e.vin, e]));
const ON_ROLL = {
  vin: '90F5B187F8295693903', first_name: 'adebayo', last_name: 'ogundimu',
  lga: 'akinyele', ward: 'ikereku', polling_unit: UNITS[0],
};

/* ------------------------------ the VIN format ------------------------------ */

test('a real VIN is accepted at 19 and at 20 characters', () => {
  // Measured over 200,000 rows of the Kwara register: 93.2% are 19 characters
  // and 6.8% are 20. Demanding exactly 19 rejected one voter in fifteen.
  assert.equal(isValidVIN('90F5B187F8295693903'), true, '19 characters');
  assert.equal(isValidVIN('90F5B187F82956939031'), true, '20 characters');
  assert.equal(isValidVIN('90F5B187F829569390'), false, '18 is still wrong');
  assert.equal(isValidVIN('90F5B187F829569390312'), false, '21 is still wrong');
});

/* ------------------------- the gate on the importer ------------------------- */

test('a VIN that is not in the register is refused', () => {
  const result = applyVoterRoll(grid([{ ...GOOD, pvc_no: 'AAAAAAAAAAAAAAAAAAA' }]),
    register([ON_ROLL]), { quota: 4 });

  assert.equal(result.ok, false);
  assert.equal(result.summary.valid, 0, 'it must not count towards the total');
  assert.equal(result.summary.unverified, 1);
  assert.equal(result.rows[0].unverified, true);
  assert.match(result.rows[0].errors.join(' '), /not in the INEC register/);
  assert.match(result.rows[0].errors.join(' '), /not added/);
});

test('a row with no VIN at all is refused once a register is loaded', () => {
  const result = applyVoterRoll(grid([{ ...GOOD, pvc_no: '' }]), register([ON_ROLL]), { quota: 4 });
  assert.equal(result.summary.valid, 0);
  assert.match(result.rows[0].errors.join(' '), /cannot be confirmed against the INEC register/);
});

test('a VIN that is in the register passes', () => {
  const result = applyVoterRoll(grid([GOOD]), register([ON_ROLL]), { quota: 4 });
  assert.equal(result.ok, true);
  assert.equal(result.summary.valid, 1);
  assert.deepEqual(result.rows[0].warnings, []);
});

test('the VIN is matched regardless of the case it was typed in', () => {
  // The register itself is lowercase; the cards are not.
  const result = applyVoterRoll(grid([{ ...GOOD, pvc_no: '90f5b187f8295693903' }]),
    register([ON_ROLL]), { quota: 4 });
  assert.equal(result.summary.valid, 1);
});

test('no register loaded means no check at all', () => {
  // The state has to degrade to what it was before the register existed,
  // rather than refusing every nominee in the system.
  const result = applyVoterRoll(grid([{ ...GOOD, pvc_no: '' }]), null, { quota: 4 });
  assert.equal(result.ok, true);
  assert.equal(result.summary.valid, 1);
});

test('a different polling unit in the register is raised, not refused', () => {
  const result = applyVoterRoll(grid([GOOD]),
    register([{ ...ON_ROLL, polling_unit: 'somewhere else' }]), { quota: 4 });

  assert.equal(result.summary.valid, 1, 'still added');
  assert.match(result.rows[0].warnings.join(' '), /requires mapping/);
});

test('a different surname does not change VIN and location verification', () => {
  const result = applyVoterRoll(grid([GOOD]),
    register([{ ...ON_ROLL, last_name: 'adeyemi' }]), { quota: 4 });
  assert.equal(result.summary.valid, 1);
  assert.equal(result.rows[0].warnings.length, 0);
});

test('an unverified row does not use up a place in the polling unit', () => {
  // Five for a unit that allows four, one of them not on the register. Four
  // real ones remain, so none of them is over.
  const people = Array.from({ length: 5 }, (_, i) => ({
    ...GOOD, first_name: 'Person' + i, phone: '0803123450' + i,
    pvc_no: i === 0 ? 'AAAAAAAAAAAAAAAAAAA' : '90F5B187F829569390' + i,
  }));
  const roll = register(people.slice(1).map((p, i) =>
    ({ ...ON_ROLL, vin: '90F5B187F829569390' + (i + 1) })));

  const result = applyVoterRoll(grid(people), roll, { quota: 4 });
  assert.equal(result.summary.unverified, 1);
  assert.equal(result.summary.valid, 4);
  assert.equal(result.summary.over_quota, 0, 'the refused row must not push anyone over');
});

test('a row already rejected is not also called unverified', () => {
  const result = applyVoterRoll(grid([{ ...GOOD, first_name: '' }]),
    register([]), { quota: 4 });
  assert.equal(result.rows[0].unverified, undefined);
  assert.equal(result.rows[0].errors.length, 1, 'one problem, reported once');
});

/* --------------------------------- the template ----------------------------- */

const template = (requireVin) => buildNomineeTemplate({
  lgas: [LGA],
  units: POLLING_UNITS[LGA][WARD].map((polling_unit) => ({ lga: LGA, ward: WARD, polling_unit })),
  who: 'Sample', office: 'Senator', quota: 4, requireVin,
});

test('the PVC column is optional until a register is loaded', () => {
  const header = readWorkbook(template(false)).rows('Nominees')[0];
  assert.equal(header[COLUMNS.findIndex((c) => c.key === 'pvc_no')], 'PVC number');
});

test('the PVC column is required once a register is loaded', () => {
  const sheets = readWorkbook(template(true));
  const header = sheets.rows('Nominees')[0];
  assert.equal(header[COLUMNS.findIndex((c) => c.key === 'pvc_no')], 'PVC number *');

  // And the sheet says why, because a required column with no explanation is
  // just an obstacle.
  const instructions = sheets.rows('How to fill this in').flat().join(' ');
  assert.match(instructions, /Every nominee needs their PVC number/);
  assert.match(instructions, /checked against the INEC register/);
});

test('either template still maps cleanly onto the importer', () => {
  for (const requireVin of [false, true]) {
    const header = readWorkbook(template(requireVin)).rows('Nominees')[0];
    assert.deepEqual(mapHeader(header).missing, [], 'requireVin=' + requireVin);
  }
});

/* ------------------------------- the register loader ------------------------ */

test('the register header is read by name, not by position', () => {
  const { index, missing } = mapRegisterHeader(['Name', 'Gender', 'Date of Birth', 'Phone no',
    'Address', 'Voter ID number', 'Polling Unit', 'Ward', 'LGA', 'State', 'Occupation',
    'Disability Type']);
  assert.deepEqual(missing, []);
  assert.equal(index.name, 0);
  assert.equal(index.vin, 5);
  assert.equal(index.polling_unit, 6);
  assert.equal(index.ward, 7);
  assert.equal(index.lga, 8);
});

test('a register missing the voter ID column is refused', () => {
  assert.deepEqual(mapRegisterHeader(['Name', 'Ward', 'LGA', 'Polling Unit']).missing, ['vin']);
});

test('only the five fields we need are taken from a row', () => {
  // The register also carries date of birth, phone, home address, occupation
  // and disability status for 3.27 million people. None of it is imported.
  const cells = ['chika ezeobi', 'female', '1988-6-10', '08064238302', 'alausa area',
    '90f5b187f8295693903', 'elekaara comm. bank o/space', 'ilora ii', 'afijio', 'kwara',
    'civil servant', 'none'];
  const { index } = mapRegisterHeader(['Name', 'Gender', 'Date of Birth', 'Phone no', 'Address',
    'Voter ID number', 'Polling Unit', 'Ward', 'LGA', 'State', 'Occupation', 'Disability Type']);

  const kept = readRow(cells, index);
  assert.deepEqual(Object.keys(kept).sort(),
    ['first_name', 'last_name', 'lga', 'polling_unit', 'vin', 'ward']);
  assert.equal(kept.vin, '90F5B187F8295693903', 'stored uppercase, for matching');
  assert.equal(kept.ward, 'ilora ii');

  const asText = JSON.stringify(kept);
  for (const leaked of ['08064238302', '1988-6-10', 'alausa area', 'civil servant', 'female']) {
    assert.ok(!asText.includes(leaked), 'imported ' + leaked + ' — it must not be');
  }
});

test('a row with no voter ID is skipped rather than stored blank', () => {
  const { index } = mapRegisterHeader(['Name', 'Voter ID number', 'Polling Unit', 'Ward', 'LGA']);
  assert.equal(readRow(['someone', '', 'a', 'b', 'c'], index), null);
});

test('the name is split so nothing is lost', () => {
  assert.deepEqual(splitName('chika ezeobi'), { first_name: 'chika', last_name: 'ezeobi' });
  assert.deepEqual(splitName('promise jimmy adeola'),
    { first_name: 'promise jimmy', last_name: 'adeola' });
  assert.deepEqual(splitName('ezeobi'), { first_name: null, last_name: 'ezeobi' });
  assert.deepEqual(splitName('  '), { first_name: null, last_name: null });
});

test('a streamed row is parsed like any other', () => {
  const cells = parseRow('<row r="2">'
    + '<c r="A2" t="inlineStr"><is><t>chika ezeobi</t></is></c>'
    + '<c r="F2" t="inlineStr"><is><t>90f5b187f8295693903</t></is></c>'
    + '<c r="L2" t="inlineStr" />');
  assert.equal(cells[0], 'chika ezeobi');
  assert.equal(cells[5], '90f5b187f8295693903', 'the gap between A and F must not shift F left');
  assert.equal(cells.length, 12);
});

/* ----------------------------------- wiring --------------------------------- */

test('a VIN that is not on the register is a hard failure, not a risk score', () => {
  const src = fs.readFileSync(path.join(here, 'index.js'), 'utf8');
  assert.match(src, /f\.code === 'voter_roll_missing'/,
    'registerMemberRow must refuse a nominee who is not in the register');
});

test('a register mismatch is kept separate from a missing VIN', () => {
  const src = fs.readFileSync(path.join(here, 'verify.js'), 'utf8');
  assert.match(src, /code: 'voter_roll_missing'/);
  assert.match(src, /code: 'voter_roll', weight: 45/);
});

/* --------------------- the surname fallback, when a VIN misses -------------- */

import { applyVoterRoll as applyRoll, rollNameKey, maskVin } from './nominee-import.js';
import { verdictFor, OUTCOMES } from './audit-voter-roll.js';

const withNames = (byVin, entries) => ({
  byVin: register(byVin),
  byName: entries.reduce((map, e) => {
    const k = rollNameKey(e.last_name, e.polling_unit);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(e);
    return map;
  }, new Map()),
});

test('a VIN is shown as a hint, never in full', () => {
  // The suggestion is there so somebody who transposed two characters can see
  // they had the right person. Printed in full, a whole list could be filled
  // in from the suggestions with no card in anyone's hand.
  assert.equal(maskVin('90F5B187F8295693903'), '…3903');
  assert.equal(maskVin(''), '');
  assert.equal(maskVin('ABC'), 'ABC');
});

test('a mistyped VIN is told who the register thinks was meant', () => {
  const result = applyRoll(grid([{ ...GOOD, pvc_no: 'AAAAAAAAAAAAAAAAAAA' }]),
    withNames([], [ON_ROLL]), { quota: 4 });

  assert.equal(result.summary.valid, 0, 'still refused — a hint is not a pass');
  const message = result.rows[0].errors.join(' ');
  assert.match(message, /not in the INEC register/);
  assert.match(message, /does have a adebayo ogundimu in that polling unit/);
  assert.match(message, /…3903/);
  assert.doesNotMatch(message, /90F5B187F8295693903/, 'the full VIN must not appear');
});

test('a missing VIN gets the same hint', () => {
  const result = applyRoll(grid([{ ...GOOD, pvc_no: '' }]),
    withNames([], [ON_ROLL]), { quota: 4 });
  assert.match(result.rows[0].errors.join(' '), /may be a typing slip|does have a/);
});

test('two people of that surname in the unit means no guess is offered', () => {
  const result = applyRoll(grid([{ ...GOOD, pvc_no: 'AAAAAAAAAAAAAAAAAAA' }]),
    withNames([], [ON_ROLL, { ...ON_ROLL, vin: 'B'.repeat(19), first_name: 'kunle' }]),
    { quota: 4 });
  const message = result.rows[0].errors.join(' ');
  assert.match(message, /2 people of that surname/);
  assert.doesNotMatch(message, /…/, 'no VIN may be offered when it is ambiguous');
});

test('no fallback entry means no hint, and no crash', () => {
  const result = applyRoll(grid([{ ...GOOD, pvc_no: 'AAAAAAAAAAAAAAAAAAA' }]),
    withNames([], []), { quota: 4 });
  assert.match(result.rows[0].errors.join(' '), /not in the INEC register/);
  assert.equal(result.summary.valid, 0);
});

test('the fallback key ignores LGA and ward spelling', () => {
  // The register writes "ogbomoso" for our "Ogbomosho" and suffixes Ibadan
  // wards with "(part i)". Keying on those loses one row in eight.
  assert.equal(rollNameKey('Ogundimu', UNITS[0]), rollNameKey('ogundimu ', UNITS[0]));
  assert.notEqual(rollNameKey('Ogundimu', UNITS[0]), rollNameKey('Ogundimu', UNITS[1]));
});

test('a plain Map still works as the lookup', () => {
  // The route passes { byVin, byName }; the tests and older callers pass a Map.
  assert.equal(applyRoll(grid([GOOD]), register([ON_ROLL]), { quota: 4 }).summary.valid, 1);
});

/* ---------------------------------- the audit ------------------------------- */

const member = (extra = {}) => ({
  code: 'KWARA1', first_name: 'Adebayo', last_name: 'Ogundimu',
  pvc_no: '90F5B187F8295693903', polling_unit: UNITS[0], ...extra,
});

test('the audit names every outcome it can return', () => {
  for (const key of ['ok', 'no_vin', 'not_found', 'unit_mismatch', 'name_mismatch']) {
    assert.ok(OUTCOMES[key], 'no label for ' + key);
  }
});

test('a member in the register at the right unit passes the audit', () => {
  assert.equal(verdictFor(member(), ON_ROLL).outcome, 'ok');
});

test('the audit separates no VIN from a VIN that is not there', () => {
  assert.equal(verdictFor(member({ pvc_no: null }), null).outcome, 'no_vin');
  assert.equal(verdictFor(member(), null).outcome, 'not_found');
});

test('the audit reports a unit or surname difference without calling it missing', () => {
  assert.equal(verdictFor(member(), { ...ON_ROLL, polling_unit: 'elsewhere' }).outcome,
    'unit_mismatch');
  assert.equal(verdictFor(member(), { ...ON_ROLL, last_name: 'adeyemi' }).outcome,
    'name_mismatch');
});

test('the audit offers the same single-match hint, masked', () => {
  const v = verdictFor(member({ pvc_no: null }), null, [ON_ROLL]);
  assert.match(v.suggestion, /…3903/);
  assert.doesNotMatch(v.suggestion, /90F5B187F8295693903/);

  assert.equal(verdictFor(member({ pvc_no: null }), null, [ON_ROLL, ON_ROLL]).suggestion, '',
    'no guess when it is ambiguous');
});

test('the audit changes nothing', () => {
  // It exists to be read before anyone decides what to do. A report that
  // quietly rejected people would be the opposite of useful.
  const src = fs.readFileSync(path.join(here, 'audit-voter-roll.js'), 'utf8');
  for (const write of ['UPDATE ', 'DELETE ', 'INSERT ', 'TRUNCATE ']) {
    assert.ok(!src.includes(write), 'the audit must not ' + write.trim());
  }
});

/* ------------------- the browser loader parses the real file ---------------- */

test('the browser loader reads the register CSV the same way the server does', async () => {
  // The loader in the admin page has its own CSV splitter, because it runs in
  // a browser with no server code available. If the two disagree about which
  // column is which, the register loads into the wrong fields silently.
  const source = fs.readFileSync(
    path.join(here, '..', 'client', 'src', 'components', 'VoterRollLoader.jsx'), 'utf8');

  // Pull the two pure functions out and actually run them, rather than
  // eyeballing the source and hoping.
  const body = source
    .slice(source.indexOf('function splitLine'), source.indexOf('export default'))
    .replace('export function mapHeader', 'function mapHeader');
  const { splitLine, mapHeader: browserHeader } =
    new Function(body + '\nreturn { splitLine, mapHeader };')();

  const header = 'Name,Gender,"Date of Birth","Phone no",Address,"Voter ID number",'
    + '"Polling Unit",Ward,LGA,State,Occupation,"Disability Type"';
  const line = '"chika ezeobi",female,1988-6-10,08064238302,'
    + '"alausa area, idi-igba ilora",90f5b187f8295693903,'
    + '"elekaara comm. bank o/space","ilora ii",afijio,kwara,"civil servant",';

  const index = browserHeader(splitLine(header));
  assert.equal(index.vin, 5);
  assert.equal(index.name, 0);
  assert.equal(index.polling_unit, 6);
  assert.equal(index.ward, 7);
  assert.equal(index.lga, 8);

  const cells = splitLine(line);
  assert.equal(cells.length, 12, 'a comma inside a quoted address must not split the row');
  assert.equal(cells[index.vin], '90f5b187f8295693903');
  assert.equal(cells[index.polling_unit], 'elekaara comm. bank o/space');
  assert.equal(cells[4], 'alausa area, idi-igba ilora');

  // And the five it sends are the five the server stores.
  const sent = [cells[index.vin], cells[index.name], cells[index.polling_unit],
    cells[index.ward], cells[index.lga]];
  assert.deepEqual(sent, ['90f5b187f8295693903', 'chika ezeobi',
    'elekaara comm. bank o/space', 'ilora ii', 'afijio']);
});

test('the browser loader sends only the five fields we keep', () => {
  const source = fs.readFileSync(
    path.join(here, '..', 'client', 'src', 'components', 'VoterRollLoader.jsx'), 'utf8');
  // The payload is built in exactly two places; both must push the same five.
  const pushes = [...source.matchAll(/pending\.push\(\[([\s\S]*?)\]\)/g)];
  assert.equal(pushes.length, 2, 'the rows are built in two places — keep them identical');
  for (const [, fields] of pushes) {
    for (const forbidden of ['phone', 'address', 'birth', 'occupation', 'disability', 'gender']) {
      assert.ok(!fields.toLowerCase().includes(forbidden),
        'the browser must not upload ' + forbidden);
    }
    assert.equal((fields.match(/cells\[/g) || []).length, 5, 'five fields, no more');
  }
});

test('the chunk endpoint is admin-only and bounded', () => {
  const src = fs.readFileSync(path.join(here, 'index.js'), 'utf8');
  const start = src.indexOf("app.post('/api/admin/voter-roll/chunk'");
  assert.ok(start > 0, 'the chunk endpoint has moved');
  const block = src.slice(start, src.indexOf('\napp.', start + 1));
  assert.match(block, /authenticate, requireAdmin/);
  assert.match(block, /rows\.length > 5000/, 'an unbounded chunk would be a memory hole');
  assert.match(block, /ON CONFLICT \(vin\) DO UPDATE/, 're-sending a slice must not duplicate');
});

/* --------------------------- the COPY-ready export -------------------------- */

test('the CSV export quotes what Postgres needs quoted', () => {
  // Polling unit labels contain commas ("open space adesakin layout, beside
  // transformer"). Unquoted, every one of those shifts the rest of the row by
  // a column and the register loads into the wrong fields.
  const src = fs.readFileSync(path.join(here, 'load-voter-roll.js'), 'utf8');
  const start = src.indexOf('const csvCell =');
  assert.ok(start > 0, 'the CSV cell writer has moved');

  const csvCell = new Function('return ' + src.slice(start + 'const csvCell = '.length,
    src.indexOf('};', start) + 1))();

  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('open space, beside transformer'),
    '"open space, beside transformer"');
  assert.equal(csvCell('say "hello"'), '"say ""hello"""');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
});

test('the export writes the columns voter_roll actually has, in order', () => {
  const src = fs.readFileSync(path.join(here, 'load-voter-roll.js'), 'utf8');
  assert.match(src, /'vin,last_name,first_name,lga,ward,polling_unit,loaded_at,batch/);

  // And the row it writes lines up with that header.
  const row = /\[row\.vin, row\.last_name, row\.first_name, row\.lga, row\.ward,\s*row\.polling_unit, stamp, batch\]/;
  assert.match(src, row, 'the row order must match the header exactly');
});

test('the export respects back-pressure', () => {
  // Three million rows written without waiting for drain is the difference
  // between 200 MB of memory and running out of it.
  const src = fs.readFileSync(path.join(here, 'load-voter-roll.js'), 'utf8');
  assert.match(src, /once\('drain'/);
});
