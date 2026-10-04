// The nominee list, out and back.
//
// Two things carry most of the weight here. One is Excel eating the leading
// zero off a phone number, which it does to every list typed without quotes
// and which would otherwise reject the whole file. The other is the
// allowance: going past it must never stop a row being saved, only mark it.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  mapHeader, readRow, validateGrid, readUpload, readNomineeUpload, applyVoterRoll,
  applyRegisterDuplicates, nameKey, personKey,
} from './nominee-import.js';
import { COLUMNS, buildNomineeTemplate, nomineeTemplateCsv, templateFilename }
  from './nominee-template.js';
import { buildWorkbook } from './xlsx.js';
import { readWorkbook, columnIndex } from './xlsx-read.js';
import { POLLING_UNITS, BANKS } from './data/geo.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const LGA = 'Akinyele';
const WARD = 'IKEREKU';
const UNITS = POLLING_UNITS[LGA][WARD];
const OTHER_WARD = 'OJO-EMO/MONIYA';

const SCOPE = { lgas: [LGA], wardsByLga: { [LGA]: [WARD, OTHER_WARD] }, quota: 4 };

const HEADERS = COLUMNS.map((c) => c.header + (c.required ? ' *' : ''));
const row = (values) => COLUMNS.map((c) => values[c.key] ?? '');

const GOOD = {
  first_name: 'Adebayo', last_name: 'Ogundimu', phone: '08031234567',
  lga: LGA, ward: WARD, polling_unit: UNITS[0],
};

function ctx(extra = {}) {
  return {
    index: mapHeader(HEADERS).index,
    lgas: SCOPE.lgas, wardsByLga: SCOPE.wardsByLga,
    seen: {
      phone: new Map(), name: new Map(), nin: new Map(), pvc: new Map(), account: new Map(),
    },
    line: 2,
    ...extra,
  };
}

/** A grid of rows, run through the real pipeline. */
const grid = (values, scope = SCOPE) =>
  validateGrid([HEADERS, ...values.map(row)], scope);

const one = (values, context = ctx()) => readRow(row(values), context);
test('required-VIN imports skip absent VINs and duplicates while retaining other imperfect details',()=>{
  const scope={...SCOPE,acceptIssues:true,requireVin:true};
  const result=grid([{...GOOD,pvc_no:''},{...GOOD,phone:'08031234568',pvc_no:'N/A'},
    {...GOOD,first_name:'',phone:'bad phone',pvc_no:'VIN-TYPING-ISSUE'},
    {...GOOD,first_name:'Duplicate',pvc_no:'VIN-TYPING-ISSUE'}],scope);
  assert.equal(result.summary.missing_vin,2);assert.equal(result.summary.duplicates,1);
  assert.equal(result.summary.valid,1);assert.equal(result.summary.invalid,3);
  assert.ok(result.rows[0].errors.some(message=>message.includes('VIN is missing')));
  assert.equal(result.rows[2].nominee.first_name,'');assert.equal(result.rows[2].nominee.phone,'bad phone');
});
test('accept-issues imports retain missing names and incomplete details, but exclude duplicates',()=>{
  const scope={...SCOPE,acceptIssues:true};
  const result=grid([{phone:'08031234567',lga:LGA,ward:WARD,polling_unit:UNITS[0]},
    {phone:'08031234567',first_name:'Another',last_name:'Person',lga:LGA,ward:WARD,polling_unit:UNITS[1]},
    {first_name:'Incomplete',phone:'bad number',account_number:'12',lga:'Unknown',ward:'Unknown',polling_unit:'Unknown'}],scope);
  assert.equal(result.summary.valid,2);assert.equal(result.summary.duplicates,1);
  assert.equal(result.rows[0].nominee.first_name,'');assert.equal(result.rows[0].nominee.last_name,'');
  assert.ok(result.rows[0].warnings.includes('First name is missing'));
  assert.equal(result.rows[2].nominee.phone,'bad number');assert.equal(result.rows[2].errors.length,0);
});
test('missing names do not create false name-only duplicates, while identifier duplicates still block',()=>{
  const result=grid([{last_name:'Same',phone:'08031234567',...{lga:LGA,ward:WARD,polling_unit:UNITS[0]}},
    {last_name:'Same',phone:'08031234568',lga:LGA,ward:WARD,polling_unit:UNITS[0]}],{...SCOPE,acceptIssues:true});
  assert.equal(result.summary.valid,2);
  const lookup={phone:new Map([['08031234567',{first_name:'Existing',last_name:'Person'}]])};
  applyRegisterDuplicates(result,lookup);
  assert.equal(result.summary.valid,1);assert.equal(result.rows[0].duplicate,true);
});

test('an admin-uploaded location uses canonical ward and unit names for dashboard matching', () => {
  const result = one({ ...GOOD, lga: LGA.toUpperCase(), ward: WARD.toLowerCase(),
    polling_unit: UNITS[0].toLowerCase().replace(/ /g, '  ') });
  assert.equal(result.nominee.lga, LGA);
  assert.equal(result.nominee.ward, WARD);
  assert.equal(result.nominee.polling_unit, UNITS[0]);
});

test('uploaded ward numbers and unit numbers resolve through official INEC reference', () => {
  const result = one({ ...GOOD, ward: 'Ward 01', polling_unit: '002' });
  assert.equal(result.nominee.ward, WARD);
  assert.equal(result.nominee.polling_unit, 'METHODIST PRY. SCHOOL, IKEREKU I');
  assert.equal(result.warnings.length, 0);
});

/* --------------------------------- header ---------------------------------- */

test('the template\'s own header maps cleanly', () => {
  const { index, missing } = mapHeader(HEADERS);
  assert.deepEqual(missing, []);
  COLUMNS.forEach((c, i) => assert.equal(index[c.key], i));
});

test('the headings people actually type are understood', () => {
  // Lists arrive from wherever the candidate already kept them.
  const { index, missing } = mapHeader(
    ['S/N', 'Surname', 'First Name', 'Phone Number', 'LGA', 'Ward', 'PU', 'BVN']);
  assert.deepEqual(missing, []);
  assert.equal(index.last_name, 1);
  assert.equal(index.first_name, 2);
  assert.equal(index.phone, 3);
  assert.equal(index.polling_unit, 6);
});

test('a missing required column stops the file', () => {
  assert.deepEqual(mapHeader(['First name', 'Surname']).missing,
    []);
  assert.deepEqual(mapHeader(['Phone', 'LGA', 'Ward', 'Polling unit']).missing,
    ['First name', 'Surname']);
});

/* ---------------------------------- rows ----------------------------------- */

test('a good row becomes a nominee', () => {
  const { errors, nominee } = one({ ...GOOD, title: 'Mr', designation: 'Youth leader' });
  assert.deepEqual(errors, []);
  assert.equal(nominee.first_name, 'Adebayo');
  assert.equal(nominee.phone, '08031234567');
  assert.equal(nominee.polling_unit, UNITS[0]);
  assert.equal(nominee.designation, 'Youth leader');
});

test('an Ogbomoso spelling variant imports under the canonical Ogbomosho LGA', () => {
  const lga = 'Ogbomosho South';
  const ward = Object.keys(POLLING_UNITS[lga])[0];
  const pollingUnit = POLLING_UNITS[lga][ward][0];
  const context = ctx({ lgas: [lga], wardsByLga: { [lga]: [ward] } });
  const { errors, nominee } = one({
    ...GOOD, lga: 'Ogbomoso South', ward, polling_unit: pollingUnit,
  }, context);

  assert.deepEqual(errors, []);
  assert.equal(nominee.lga, lga);
});

test('an untouched row is skipped', () => {
  assert.equal(one({}).blank, true);
});

test('a name missing is an error, but a missing phone is a warning', () => {
  assert.match(one({ ...GOOD, first_name: '' }).errors.join(' '), /First name is missing/);
  assert.match(one({ ...GOOD, last_name: '' }).errors.join(' '), /Surname is missing/);
  const missingPhone = one({ ...GOOD, phone: '' });
  assert.deepEqual(missingPhone.errors, []);
  assert.match(missingPhone.warnings.join(' '), /Phone is missing/);
});

test('a phone Excel stripped the leading zero from still works', () => {
  // This is what a column of numbers typed without quotes comes back as. It
  // would otherwise fail every row in the file.
  assert.equal(one({ ...GOOD, phone: '8031234567' }).nominee.phone, '08031234567');
  assert.equal(one({ ...GOOD, phone: '2348031234567' }).nominee.phone, '08031234567');
  assert.equal(one({ ...GOOD, phone: '0803 123 4567' }).nominee.phone, '08031234567');
});

test('something that is not a phone number is kept with a warning', () => {
  const result = one({ ...GOOD, phone: '12345' });
  assert.deepEqual(result.errors, []);
  assert.equal(result.nominee.phone, '12345');
  assert.match(result.warnings.join(' '), /not a Nigerian mobile/);
});

test('blank location fields are saved as placeholders with warnings', () => {
  const result = one({ ...GOOD, phone: '', lga: '', ward: '', polling_unit: '' });
  assert.deepEqual(result.errors, []);
  assert.equal(result.nominee.phone, '');
  assert.equal(result.nominee.lga, 'Not specified');
  assert.equal(result.nominee.ward, 'Not specified');
  assert.equal(result.nominee.polling_unit, 'Not specified');
  assert.equal(result.warnings.length, 4);
});

test('the same phone twice in one file is caught, with the earlier row named', () => {
  const shared = ctx();
  shared.line = 2;
  assert.deepEqual(one(GOOD, shared).errors, []);
  shared.line = 9;
  assert.match(one({ ...GOOD, first_name: 'Same' }, shared).errors.join(' '),
    /appears earlier in this file, on row 2/);
});

test('the same person twice in one file is caught even with different phones', () => {
  // The common case: a list typed from paper over two sittings, the same
  // person written down twice, each time with a slightly different number.
  const result = grid([
    { ...GOOD },
    { ...GOOD, phone: '08039999999' },
  ]);
  assert.equal(result.summary.valid, 1, 'the repeat must not count');
  assert.equal(result.summary.invalid, 1);
  assert.match(result.rows[1].errors.join(' '), /same as row 2 in this file/);
});

test('same-name rows with no location are not assumed to be duplicates', () => {
  const unknown = { ...GOOD, phone: '', lga: '', ward: '', polling_unit: '' };
  const result = grid([unknown, { ...unknown, phone: '' }]);
  assert.equal(result.summary.valid, 2);
  assert.equal(result.summary.duplicates, 0);
});

test('the same name in a different polling unit is allowed', () => {
  // Names repeat. Two people called Adebayo Ogundimu in two units are two
  // people until something else says otherwise.
  const result = grid([
    { ...GOOD },
    { ...GOOD, phone: '08039999999', polling_unit: UNITS[1] },
  ]);
  assert.equal(result.summary.valid, 2);
});

test('a repeated NIN, PVC or account within the file is caught', () => {
  for (const [field, value] of [['nin', '12345678901'],
    ['pvc_no', 'ABC1234567890123456'], ['account_number', '0123456789']]) {
    const result = grid([
      { ...GOOD, [field]: value },
      { ...GOOD, first_name: 'Different', last_name: 'Person',
        phone: '08039999999', [field]: value },
    ]);
    assert.equal(result.summary.invalid, 1, field + ' repeat was not caught');
    assert.match(result.rows[1].errors.join(' '), /same as row 2 in this file/);
  }
});

/* -------------------------------- locations -------------------------------- */

test('a ward or LGA outside the candidate\'s area is saved with a warning', () => {
  const outsideLga = one({ ...GOOD, lga: 'Ibadan North' });
  assert.deepEqual(outsideLga.errors, []);
  assert.equal(outsideLga.nominee.lga, 'Ibadan North');
  assert.match(outsideLga.warnings.join(' '), /outside your area/);
  const outsideWard = one({ ...GOOD, ward: 'SOMEWHERE ELSE' });
  assert.deepEqual(outsideWard.errors, []);
  assert.equal(outsideWard.nominee.ward, 'SOMEWHERE ELSE');
  assert.match(outsideWard.warnings.join(' '), /not a ward of Akinyele/);
});

test('a polling unit from the wrong ward is saved with a warning', () => {
  const elsewhere = POLLING_UNITS[LGA][OTHER_WARD][0];
  const result = one({ ...GOOD, polling_unit: elsewhere });
  assert.deepEqual(result.errors, []);
  assert.equal(result.nominee.polling_unit, elsewhere);
  assert.match(result.warnings.join(' '), /is not a polling unit in/);
});

test('a polling unit differing only in spacing or case is accepted', () => {
  const sloppy = UNITS[0].toLowerCase().replace(/\s+/g, '  ');
  const { errors, warnings, nominee } = one({ ...GOOD, polling_unit: sloppy });
  assert.deepEqual(errors, []);
  assert.equal(nominee.polling_unit, UNITS[0], 'stored under the canonical spelling');
  assert.equal(warnings.length, 0);
});

/* ------------------------- identifiers and bank ---------------------------- */

test('a bad NIN or PVC is a warning, not a refusal', () => {
  // They are optional and often copied wrong; losing the person over a typo in
  // a field we did not require would be absurd.
  const { errors, warnings, nominee } = one({ ...GOOD, nin: '123', pvc_no: 'ABC' });
  assert.deepEqual(errors, []);
  assert.equal(warnings.length, 2);
  assert.equal(nominee.nin, '123');
});

test('imports may save a nominee without a voter-roll match when allowed', () => {
  const input = one({ ...GOOD, pvc_no: '' });
  const result = { rows: [{ line: 2, ...input }], summary: {} };
  applyVoterRoll(result, { byVin: new Map(), byName: new Map() }, { allowUnverified: true });
  assert.deepEqual(result.rows[0].errors, []);
  assert.equal(result.rows[0].unverified, true);
  assert.match(result.rows[0].warnings.join(' '), /will be saved with verified status/);
});

test('a bank not on the list is kept with a warning', () => {
  const { errors, warnings } = one({ ...GOOD, bank_name: 'Village Cooperative' });
  assert.deepEqual(errors, []);
  assert.match(warnings.join(' '), /not on the bank list/);
});

test('a bank on the list passes quietly', () => {
  assert.deepEqual(one({ ...GOOD, bank_name: BANKS[0], account_number: '0123456789',
    account_name: 'Adebayo Ogundimu' }).warnings, []);
});

test('an account number with no bank is flagged as unpayable', () => {
  assert.match(one({ ...GOOD, account_number: '0123456789' }).warnings.join(' '),
    /cannot be paid/);
});

/* --------------------------------- the quota -------------------------------- */

const people = (count, extra = {}) => Array.from({ length: count }, (_, i) => ({
  ...GOOD, first_name: 'Person' + i, phone: '080312345' + String(60 + i).padStart(2, '0'),
  ...extra,
}));

test('going past the allowance is a warning, and the row is still produced', () => {
  const result = grid(people(6));
  assert.equal(result.summary.invalid, 0, 'nobody may be refused for being over');
  assert.equal(result.summary.valid, 6, 'every row must still be saveable');
  assert.deepEqual(result.rows.map((r) => r.over_quota),
    [false, false, false, false, true, true]);
  assert.match(result.rows[4].warnings.join(' '), /makes 5 in a polling unit that allows 4/);
});

test('the allowance counts people already on the register', () => {
  // Four saved last week and one more today is the fifth, not the first.
  const result = validateGrid([HEADERS, row(GOOD)], {
    ...SCOPE, existingCounts: new Map([[[LGA, WARD, UNITS[0]].join('|'), 4]]),
  });
  assert.equal(result.rows[0].over_quota, true);
  assert.deepEqual(result.rows[0].errors, []);
});

test('the allowance is counted per polling unit, not per ward', () => {
  const result = grid([...people(4), { ...GOOD, first_name: 'Elsewhere',
    phone: '08031234599', polling_unit: UNITS[1] }]);
  assert.equal(result.rows[4].over_quota, false, 'a different unit starts again at zero');
});

test('an office with no allowance never flags anyone', () => {
  const result = grid(people(12), { ...SCOPE, quota: null });
  assert.equal(result.summary.over_quota, 0);
  assert.equal(result.summary.invalid, 0);
});

/* ---------------------------------- grids ----------------------------------- */

test('an over-allowance file is still saveable', () => {
  const result = grid(people(6));
  assert.equal(result.ok, true, 'over the allowance is not a reason to refuse the file');
  assert.equal(result.summary.valid, 6);
  assert.equal(result.summary.invalid, 0);
  assert.equal(result.summary.over_quota, 2);
  assert.deepEqual(result.rows.filter((r) => r.over_quota).map((r) => r.line), [6, 7]);
});

/* ------------------- already on the register -------------------------------- */

const onRegister = (member, fields = {}) => {
  const lookup = { phone: new Map(), nin: new Map(), pvc: new Map(),
    account: new Map(), name: new Map(), person: new Map() };
  for (const [field, value] of Object.entries(fields)) lookup[field].set(value, member);
  return lookup;
};

const EXISTING = { id: 4, code: 'KWARA123', first_name: 'Adebayo', last_name: 'Ogundimu',
  polling_unit: UNITS[0] };

test('somebody already on the register is not added again', () => {
  const result = applyRegisterDuplicates(grid([GOOD]),
    onRegister(EXISTING, { phone: '08031234567' }), { quota: 4 });

  assert.equal(result.ok, false);
  assert.equal(result.summary.valid, 0, 'a duplicate must not count towards the total');
  assert.equal(result.summary.duplicates, 1);
  assert.equal(result.rows[0].duplicate, true);
  assert.match(result.rows[0].errors.join(' '),
    /already registered to Adebayo Ogundimu \(KWARA123\)/);
  assert.match(result.rows[0].errors.join(' '), /not added again/);
});

test('the same name in the same polling unit counts as the same person', () => {
  // The case with nothing else to match on: no NIN, no PVC, and the phone
  // written differently the second time.
  const result = applyRegisterDuplicates(grid([{ ...GOOD, phone: '08039999999' }]),
    onRegister(EXISTING, { name: nameKey('Adebayo', 'Ogundimu', UNITS[0]) }), { quota: 4 });

  assert.equal(result.summary.valid, 0);
  assert.match(result.rows[0].errors.join(' '), /That name, in that polling unit/);
});

test('the same name in another unit is a question, not a refusal', () => {
  const result = applyRegisterDuplicates(grid([{ ...GOOD, polling_unit: UNITS[1] }]),
    onRegister({ ...EXISTING, polling_unit: UNITS[0] },
      { person: personKey('Adebayo', 'Ogundimu') }), { quota: 4 });

  assert.equal(result.summary.valid, 1, 'it must still be saveable');
  assert.equal(result.rows[0].duplicate, false);
  assert.match(result.rows[0].warnings.join(' '), /check this is not the same person/);
});

test('a NIN, PVC or account already on the register is caught', () => {
  for (const [field, key, value] of [
    ['nin', 'nin', '12345678901'],
    ['pvc_no', 'pvc', 'ABC1234567890123456'],
    ['account_number', 'account', '0123456789'],
  ]) {
    const result = applyRegisterDuplicates(grid([{ ...GOOD, [field]: value }]),
      onRegister(EXISTING, { [key]: value }), { quota: 4 });
    assert.equal(result.summary.valid, 0, field + ' was not caught');
    assert.equal(result.rows[0].duplicate, true);
  }
});

test('a duplicate does not use up a place in the polling unit', () => {
  // Five people for a unit that allows four, but the first is already on the
  // register. That leaves four new ones, so none of them is over.
  const result = applyRegisterDuplicates(grid(people(5)),
    onRegister(EXISTING, { phone: '08031234560' }), { quota: 4 });

  assert.equal(result.summary.duplicates, 1);
  assert.equal(result.summary.valid, 4);
  assert.equal(result.summary.over_quota, 0,
    'the duplicate must not push the last one over the allowance');
});

test('the rest of the file survives a duplicate', () => {
  const result = applyRegisterDuplicates(grid(people(3)),
    onRegister(EXISTING, { phone: '08031234561' }), { quota: 4 });
  assert.equal(result.summary.valid, 2);
  assert.equal(result.summary.duplicates, 1);
  assert.deepEqual(result.rows.filter((r) => !r.errors.length).map((r) => r.line), [2, 4]);
});

test('an empty lookup changes nothing', () => {
  const before = grid(people(3));
  const after = applyRegisterDuplicates(grid(people(3)), onRegister(EXISTING, {}), { quota: 4 });
  assert.equal(after.summary.valid, before.summary.valid);
  assert.equal(after.summary.duplicates, 0);
  assert.equal(after.ok, true);
});

test('line numbers are the ones Excel shows', () => {
  const grid = [HEADERS, row(GOOD), [], row({ ...GOOD, phone: 'nonsense' })];
  const result = validateGrid(grid, SCOPE);
  assert.deepEqual(result.rows.map((r) => r.line), [2, 4]);
  assert.equal(result.summary.blank, 1);
});

test('one bad row does not cost the good ones', () => {
  const result = grid([
    { ...GOOD, first_name: 'Ade', phone: '08031111111' },
    { ...GOOD, first_name: '', phone: '08039999999' },
    { ...GOOD, first_name: 'Bisi', phone: '08032222222' }]);
  assert.equal(result.summary.valid, 2);
  assert.equal(result.summary.invalid, 1);
});

test('a file with no headings is refused with a useful message', () => {
  assert.match(validateGrid([['a', 'b'], ['1', '2']], SCOPE).error, /must be the template's headings/);
});

/* -------------------------------- the template ------------------------------ */

const TEMPLATE = () => buildNomineeTemplate({
  lgas: [LGA],
  units: [WARD, OTHER_WARD].flatMap((w) =>
    POLLING_UNITS[LGA][w].map((polling_unit) => ({ lga: LGA, ward: w, polling_unit }))),
  who: 'Sample Candidate', office: 'Senator', quota: 4,
});

test('the template has the parts Excel requires', () => {
  const workbook = readWorkbook(TEMPLATE());
  assert.deepEqual(workbook.sheetNames, ['How to fill this in', 'Nominees', 'Lists']);
});

test('the template\'s header is exactly what the importer expects', () => {
  const rows = readWorkbook(TEMPLATE()).rows('Nominees');
  assert.deepEqual(mapHeader(rows[0]).missing, []);
  assert.deepEqual(rows[0], HEADERS);
});

test('the template offers only this candidate\'s wards and units', () => {
  const rows = readWorkbook(TEMPLATE()).rows('Lists');
  const column = (letter) => rows.slice(1)
    .map((r) => r[columnIndex(letter) - 1]).filter(Boolean);
  assert.deepEqual(column('B').sort(), [WARD, OTHER_WARD].sort());
  assert.equal(column('C').includes(UNITS[0]), true);
  assert.equal(column('C').includes(POLLING_UNITS['Egbeda']?.[Object.keys(POLLING_UNITS.Egbeda)[0]]?.[0]),
    false, 'no units from outside the constituency');
});

test('the instructions say plainly that going over is allowed', () => {
  // The candidates this is aimed at have been told "four per unit" for months.
  // If the sheet does not say otherwise they will leave the fifth person off.
  const xml = readWorkbook(TEMPLATE()).rows('How to fill this in').flat().join(' ');
  assert.match(xml, /put them in anyway/i);
  assert.match(xml, /still saved/i);
  assert.match(xml, /4 nominees in each polling unit/);
});

test('a filled-in template reads back', () => {
  const buffer = buildWorkbook([
    { name: 'How to fill this in', rows: [['ignore']] },
    { name: 'Nominees', rows: [HEADERS, row(GOOD), row({ ...GOOD, phone: '08039999999',
      first_name: 'Folake', last_name: 'Adeyemi' })] },
    { name: 'Lists', rows: [['LGA']] },
  ]);
  const result = readNomineeUpload(buffer, 'nominees.xlsx', SCOPE);
  assert.equal(result.sheet, 'Nominees');
  assert.equal(result.ok, true);
  assert.equal(result.summary.valid, 2);
});

test('an untouched template imports as nothing', () => {
  const result = readNomineeUpload(TEMPLATE(), 'nominees.xlsx', SCOPE);
  assert.equal(result.ok, false);
  assert.match(result.error, /no filled-in rows/);
  assert.equal(result.summary.invalid, 0);
});

test('a CSV works too', () => {
  const csv = [HEADERS.join(','),
    ['Adebayo', 'Ogundimu', '08031234567', LGA, WARD, UNITS[0]].join(',')].join('\r\n');
  const result = readNomineeUpload(Buffer.from(csv), 'n.csv', SCOPE);
  assert.equal(result.ok, true);
});

test('the CSV fallback has the same headers', () => {
  assert.equal(nomineeTemplateCsv().split(',').length, COLUMNS.length);
});

test('the filename cannot escape its directory', () => {
  assert.equal(templateFilename('../../etc/passwd'), 'nominees-etc-passwd.xlsx');
  assert.equal(templateFilename(''), 'nominees-kwarax10.xlsx');
});

/* --------------------------------- wiring ----------------------------------- */

test('the member INSERT lists as many values as columns', () => {
  const src = fs.readFileSync(path.join(here, 'index.js'), 'utf8');
  const start = src.indexOf('INSERT INTO members (');
  assert.ok(start > 0);
  const block = src.slice(start, src.indexOf('lastInsertRowid', start));
  const columns = /INSERT INTO members \(([\s\S]*?)\) '/.exec(block)[1]
    .replace(/['+\n\s]/g, '').split(',').filter(Boolean);
  const placeholders = (/VALUES \(([^)]*)\)/.exec(block)[1].match(/\?/g) || []).length;
  assert.equal(placeholders, columns.length, 'placeholders do not match the column list');
  assert.ok(columns.includes('over_quota'), 'the over-allowance flag must be stored');
});

test('the nominee routes are registered before /api/members/:id', () => {
  const src = fs.readFileSync(path.join(here, 'index.js'), 'utf8');
  assert.ok(src.indexOf("app.get('/api/members/template.")
    < src.indexOf("app.get('/api/members/:id'"));
});

test('over_quota is declared on the members table', () => {
  const schema = fs.readFileSync(path.join(here, 'db.js'), 'utf8');
  assert.match(schema, /\['members', 'over_quota'/);
  assert.match(schema, /\['members', 'import_batch'/);
});
