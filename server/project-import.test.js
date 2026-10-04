// Reading a filled-in project list back.
//
// The rows here are the shapes real submissions take: a community asking for
// three things, a whole ward getting one thing, "50 pieces" typed into a
// number box, a blank line left between wards, and a ward belonging to the
// candidate next door.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  mapHeader, readRow, validateGrid, readUpload, readProjectUpload,
  projectKey, applyRegisterDuplicates,
} from './project-import.js';
import { COLUMNS, buildProjectTemplate } from './project-template.js';
import { buildWorkbook, zip } from './xlsx.js';
import { readWorkbook, parseCsv, unzip, columnIndex, decode } from './xlsx-read.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const SCOPE = {
  lgas: ['Akinyele'],
  wardsByLga: { Akinyele: ['IKEREKU', 'OJO-EMO/MONIYA', 'OLANLA/OBODA/LABODE'] },
};

const HEADERS = [...COLUMNS.map((c) => c.header + (c.required ? ' *' : '')), 'Scale','Status'];

/** A row in template order, from a sparse object. */
const row = (values) => [...COLUMNS.map((c) => (values[c.key] ?? '')),values.scale || '',values.status || ''];

const one = (values, scope = SCOPE) =>
  readRow(row(values), { index: mapHeader(HEADERS).index, seen: new Map(), line: 2, ...scope });

test('project request metadata is retained by the new template',()=>{
  const result=one({lga:'Akinyele',ward:'IKEREKU',item:'Sewing machine',quantity:2,notes:'Equipment request',contact_person:'Test Contact',contact_phone:'08000000000',request_date:'2026-10-01',target_completion_date:'2026-12-01'});
  assert.equal(result.project.contact_person,'Test Contact');
  assert.equal(result.project.contact_phone,'08000000000');
  assert.equal(result.project.request_date,'2026-10-01');
  assert.equal(result.project.target_completion_date,'2026-12-01');
  assert.equal(result.project.need,'Equipment request');
});

/** A grid of rows, run through the real pipeline. */
const grid = (values, scope = SCOPE) =>
  validateGrid([HEADERS, ...values.map(row)], scope);

const GOOD = { lga: 'Akinyele', ward: 'IKEREKU', item: 'Solar street light', quantity: '10' };

/* --------------------------------- header ---------------------------------- */

test('the template\'s own header maps cleanly', () => {
  const { index, missing } = mapHeader(HEADERS);
  assert.deepEqual(missing, []);
  COLUMNS.forEach((c, i) => assert.equal(index[c.key], i));
});

test('columns may be reordered', () => {
  // People sort and move columns. Matching on position would silently read
  // the ward as the item.
  const shuffled = ['Notes', 'Item *', 'Ward *', 'LGA *', 'How many'];
  const { index, missing } = mapHeader(shuffled);
  assert.deepEqual(missing, []);
  assert.equal(index.item, 1);
  assert.equal(index.lga, 3);
});

test('headers are matched loosely', () => {
  const { missing } = mapHeader(['lga', '  WARD  ', 'item']);
  assert.deepEqual(missing, []);
});

test('a missing required column stops the whole file', () => {
  assert.deepEqual(mapHeader(['LGA *', 'Ward *']).missing, ['Item']);
});

test('columns of their own are tolerated and counted', () => {
  const { missing, extra } = mapHeader([...HEADERS, 'Contractor', 'My reference']);
  assert.deepEqual(missing, []);
  assert.equal(extra, 2);
});

/* ---------------------------------- rows ----------------------------------- */

test('a good row becomes a project', () => {
  const { errors, project } = one({ ...GOOD, community: 'Ikereku', requested_by: 'Community' });
  assert.deepEqual(errors, []);
  assert.equal(project.item_id, 'solar_street_light');
  assert.equal(project.sector, 'Electricity & Public Lighting');
  assert.equal(project.quantity, 10);
  assert.equal(project.unit, 'pieces', 'the unit comes from the item when blank');
  assert.equal(project.status, 'promised');
  assert.equal(project.requested_by, 'Community');
  assert.equal(project.title, 'Solar street light — Ikereku');
});

test('an untouched row is skipped, not rejected', () => {
  assert.equal(one({}).blank, true);
  assert.equal(readRow([], { index: mapHeader(HEADERS).index, ...SCOPE }).blank, true);
});

test('a ward from the next constituency is refused', () => {
  const { errors } = one({ ...GOOD, ward: 'ARULOGUN/ENIOSA/ARORO' });
  assert.match(errors.join(' '), /not a ward of Akinyele|outside your constituency/);
});

test('an LGA outside the candidate\'s area is refused', () => {
  assert.match(one({ ...GOOD, lga: 'Ibadan North' }).errors.join(' '), /not one of your local governments/);
});

test('an item nobody can match is refused, with a way out', () => {
  const { errors } = one({ ...GOOD, item: 'Helicopter' });
  assert.match(errors.join(' '), /not on the item list/);
  assert.match(errors.join(' '), /Something else/);
});

test('an alias is accepted, because that is what people type', () => {
  assert.equal(one({ ...GOOD, item: 'okada' }).project.item_id, 'motorcycle');
  assert.equal(one({ ...GOOD, item: 'NPK' }).project.item_id, 'fertiliser');
});

test('"Something else" must say what it is', () => {
  const chosen = { ...GOOD, item: 'Something else (describe it)' };
  assert.match(one(chosen).errors.join(' '), /say what it is/);
  assert.deepEqual(one({ ...chosen, notes: 'Renovation of the palace' }).errors, []);
});

/* -------------------------------- quantities -------------------------------- */

test('a quantity with its unit typed in is still a number', () => {
  assert.equal(one({ ...GOOD, quantity: '50 pieces' }).project.quantity, 50);
  assert.equal(one({ ...GOOD, quantity: '1,220' }).project.quantity, 1220);
});

test('a quantity with no number in it is an error', () => {
  assert.match(one({ ...GOOD, quantity: 'plenty' }).errors.join(' '), /not a number/);
});

test('no quantity is allowed — a promise without a figure is still a promise', () => {
  const { errors, project } = one({ ...GOOD, quantity: '' });
  assert.deepEqual(errors, []);
  assert.equal(project.quantity, 1);
});

test('an absurd quantity is refused', () => {
  assert.match(one({ ...GOOD, quantity: '9999999' }).errors.join(' '), /too large/);
});

/* --------------------------- classification --------------------------------- */

test('scale and status are read by their labels', () => {
  const { project } = one({ ...GOOD, scale: 'Large', status: 'Completed' });
  assert.equal(project.scale, 'large');
  assert.equal(project.status, 'completed');
});

test('a scale nobody recognises is an error, not a silent default', () => {
  assert.match(one({ ...GOOD, scale: 'Huge' }).errors.join(' '), /not a scale/);
});

test('an unstated scale is inferred from how specific the place is', () => {
  assert.equal(one({ ...GOOD, community: 'Ikereku' }).project.scale, 'small');
  assert.equal(one({ ...GOOD, polling_unit: 'Unit 3' }).project.scale, 'small');
  assert.equal(one(GOOD).project.scale, 'medium', 'a bare ward is a ward-sized job');
});

test('an unknown unit is a warning, and the item\'s own unit wins', () => {
  const { errors, warnings, project } = one({ ...GOOD, unit: 'cartons' });
  assert.deepEqual(errors, []);
  assert.match(warnings.join(' '), /not a unit we know/);
  assert.equal(project.unit, 'pieces');
});

/* -------------------------------- communities ------------------------------- */

test('a known community is placed on the map', () => {
  const { project, warnings } = one({ ...GOOD, community: 'Ikereku' });
  assert.deepEqual(warnings, []);
  assert.ok(project.community_lat > 7 && project.community_lat < 9, 'no coordinates attached');
});

test('an unknown community is kept, with a warning', () => {
  // Refusing it would be wrong: GRID3's gazetteer is good, not complete, and
  // the candidate knows their own area better than it does.
  const { errors, warnings, project } = one({ ...GOOD, community: 'Behind the new market' });
  assert.deepEqual(errors, []);
  assert.match(warnings.join(' '), /not in the GRID3 list/);
  assert.equal(project.community, 'Behind the new market');
  assert.equal(project.community_lat, null);
});

/* ---------------------------------- grids ----------------------------------- */

test('line numbers are the ones the candidate sees in Excel', () => {
  const grid = [
    HEADERS,
    row({ ...GOOD }),                                    // line 2
    [],                                                  // line 3, left blank
    row({ ...GOOD, ward: 'NOWHERE' }),                   // line 4
  ];
  const result = validateGrid(grid, SCOPE);
  assert.equal(result.ok, false);
  assert.deepEqual(result.rows.map((r) => r.line), [2, 4]);
  assert.equal(result.summary.blank, 1);
  assert.equal(result.summary.valid, 1);
  assert.equal(result.summary.invalid, 1);
});

test('one bad row does not cost the good ones', () => {
  // Distinct places, so the two good rows are not duplicates of each other.
  const result = grid([
    { ...GOOD, community: 'Ikereku' },
    { ...GOOD, item: 'Spaceship' },
    { ...GOOD, community: 'Yejuade' }]);
  assert.equal(result.summary.valid, 2);
  assert.equal(result.rows.filter((r) => r.project).length, 2);
});

test('a file with no headings is refused with a useful message', () => {
  const result = validateGrid([['a', 'b'], ['1', '2']], SCOPE);
  assert.equal(result.ok, false);
  assert.match(result.error, /must be the template's headings/);
});

test('a file with only a header is refused', () => {
  assert.match(validateGrid([HEADERS], SCOPE).error, /no filled-in rows/);
});

/* ------------------------- already on the list ------------------------------ */

test('the same item in the same place twice in one sheet is caught', () => {
  // A row copied down and half-edited: the community changed but not the item,
  // or the other way round.
  const result = grid([
    { ...GOOD, community: 'Ikereku' },
    { ...GOOD, community: 'Ikereku', quantity: '5' },
  ]);
  assert.equal(result.summary.valid, 1, 'the repeat must not count');
  assert.equal(result.summary.invalid, 1);
  assert.match(result.rows[1].errors.join(' '), /already on row 2 of this file/);
});

test('the same item in a different community is not a duplicate', () => {
  const result = grid([
    { ...GOOD, community: 'Ikereku' },
    { ...GOOD, community: 'Yejuade' },
  ]);
  assert.equal(result.summary.valid, 2);
});

test('the same item in a different ward is not a duplicate', () => {
  const result = grid([
    { ...GOOD, ward: 'IKEREKU' },
    { ...GOOD, ward: 'OJO-EMO/MONIYA' },
  ]);
  assert.equal(result.summary.valid, 2);
});

test('a different item in the same place is not a duplicate', () => {
  const result = grid([
    { ...GOOD, item: 'Solar street light' },
    { ...GOOD, item: 'Borehole' },
  ]);
  assert.equal(result.summary.valid, 2);
});

test('re-uploading the same sheet adds nothing', () => {
  // The way these actually arrive: a candidate adds one ward and sends the
  // whole file again. Without this, every upload would double the register.
  const first = grid([
    { ...GOOD, community: 'Ikereku' },
    { ...GOOD, ward: 'OJO-EMO/MONIYA' },
  ]);
  assert.equal(first.summary.valid, 2);

  const saved = new Map(first.rows.map((r) => [projectKey(r.project),
    { id: 1, title: r.project.title, quantity: r.project.quantity }]));

  const again = applyRegisterDuplicates(grid([
    { ...GOOD, community: 'Ikereku' },
    { ...GOOD, ward: 'OJO-EMO/MONIYA' },
    { ...GOOD, ward: 'OLANLA/OBODA/LABODE' },      // the one genuinely new row
  ]), saved);

  assert.equal(again.summary.duplicates, 2);
  assert.equal(again.summary.valid, 1, 'only the new ward may be added');
  assert.equal(again.rows[2].errors.length, 0);
});

test('a duplicate says what it matched and what to do instead', () => {
  const saved = new Map([[projectKey({ item_id: 'solar_street_light', lga: 'Akinyele',
    ward: 'IKEREKU', community: '', polling_unit: '' }),
  { id: 4, title: 'Solar street light — IKEREKU', quantity: 10 }]]);

  const result = applyRegisterDuplicates(grid([GOOD]), saved);
  assert.equal(result.rows[0].duplicate, true);
  assert.match(result.rows[0].errors.join(' '), /Already on your list as "Solar street light — IKEREKU" \(10\)/);
  assert.match(result.rows[0].errors.join(' '), /change the quantity on the one you have/);
});

test('an empty register changes nothing', () => {
  const before = grid([GOOD]);
  const after = applyRegisterDuplicates(grid([GOOD]), new Map());
  assert.equal(after.summary.valid, before.summary.valid);
  assert.equal(after.summary.duplicates, 0);
  assert.equal(after.ok, true);
});

test('a row that already failed is not also called a duplicate', () => {
  const saved = new Map([[projectKey({ item_id: 'solar_street_light', lga: 'Akinyele',
    ward: 'IKEREKU', community: '', polling_unit: '' }), { id: 4, title: 'x', quantity: 1 }]]);
  const result = applyRegisterDuplicates(grid([{ ...GOOD, item: 'Spaceship' }]), saved);
  assert.equal(result.rows[0].duplicate, false);
  assert.equal(result.rows[0].errors.length, 1, 'one problem, reported once');
});

/* ------------------------------- whole files -------------------------------- */

/** What the template looks like once somebody has typed in it. */
const filled = (rows) => buildWorkbook([
  { name: 'How to fill this in', rows: [['ignore me']] },
  { name: 'Projects', rows: [HEADERS, ...rows] },
  { name: 'Lists', rows: [['Item']] },
]);

test('a filled-in template reads back', () => {
  const buffer = filled([
    row({ ...GOOD, community: 'Ikereku', quantity: '10' }),
    row({ lga: 'Akinyele', ward: 'OJO-EMO/MONIYA', item: 'Borehole', quantity: '1' }),
  ]);
  const result = readProjectUpload(buffer, 'list.xlsx', SCOPE);
  assert.equal(result.sheet, 'Projects');
  assert.equal(result.ok, true);
  assert.equal(result.summary.valid, 2);
  assert.equal(result.rows[1].project.item_id, 'borehole');
});

test('the Projects sheet is found wherever it sits in the workbook', () => {
  const buffer = buildWorkbook([
    { name: 'Notes', rows: [['something else entirely']] },
    { name: 'Projects', rows: [HEADERS, row(GOOD)] },
  ]);
  assert.equal(readUpload(buffer, 'x.xlsx').sheet, 'Projects');
});

test('a workbook with one renamed sheet still reads', () => {
  // Candidates export "just the projects" and it arrives called Sheet1.
  const buffer = buildWorkbook([{ name: 'Sheet1', rows: [HEADERS, row(GOOD)] }]);
  const result = readProjectUpload(buffer, 'x.xlsx', SCOPE);
  assert.equal(result.ok, true);
});

test('an untouched template imports as nothing, not as errors', () => {
  // Its wards are pre-typed. Uploading it unchanged must say "there is nothing
  // here", not "item is missing" once per ward.
  const buffer = buildProjectTemplate({ ...SCOPE, who: 'Test' });
  const result = readProjectUpload(buffer, 'template.xlsx', SCOPE);
  assert.equal(result.ok, false);
  assert.match(result.error, /no filled-in rows/);
  assert.equal(result.summary.invalid, 0, 'a pre-filled ward is not a broken row');
});

test('a ward that was filled in is still read, next to ones that were not', () => {
  const buffer = buildProjectTemplate({ ...SCOPE, who: 'Test' });
  const workbook = readWorkbook(buffer);
  const rows = workbook.rows('Projects');
  const { index } = mapHeader(rows[0]);
  rows[2][index.item] = 'Borehole';           // the second pre-filled ward only
  rows[2][index.quantity] = '1';

  const result = validateGrid(rows, SCOPE);
  assert.equal(result.summary.read, 1, 'only the row with something in it counts');
  assert.equal(result.summary.valid, 1);
  assert.equal(result.rows[0].line, 3);
  assert.equal(result.rows[0].project.ward, 'OJO-EMO/MONIYA');
});

test('a CSV works too', () => {
  const csv = [HEADERS.join(','), row({lga:'Akinyele',ward:'IKEREKU',community:'Ikereku',item:'Sewing machine',quantity:2,requested_by:'Community'}).join(',')]
    .join('\r\n');
  const result = readProjectUpload(Buffer.from(csv), 'list.csv', SCOPE);
  assert.equal(result.ok, true);
  assert.equal(result.rows[0].project.item_id, 'sewing_machine');
});

/* ------------------------ what Excel does to our file ----------------------- */

test('shared strings are read, because Excel rewrites inline ones on save', () => {
  // Our template writes inline strings. The moment a candidate saves, Excel
  // moves every one of them into sharedStrings.xml -- so the reader has to
  // handle a file it never wrote.
  const values = ['LGA *', 'Ward *', 'Item *', 'Akinyele', 'IKEREKU', 'Borehole (new)'];
  const si = values.map((v) => `<si><t>${v}</t></si>`).join('');
  const cell = (ref, i) => `<c r="${ref}" t="s"><v>${i}</v></c>`;

  const buffer = zip([
    { name: '[Content_Types].xml',
      data: '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' },
    { name: 'xl/workbook.xml',
      data: '<workbook><sheets><sheet name="Projects" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels',
      data: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: 'xl/sharedStrings.xml', data: `<sst count="${values.length}">${si}</sst>` },
    { name: 'xl/worksheets/sheet1.xml',
      data: '<worksheet><sheetData>'
        + `<row r="1">${cell('A1', 0)}${cell('B1', 1)}${cell('C1', 2)}</row>`
        + `<row r="2">${cell('A2', 3)}${cell('B2', 4)}${cell('C2', 5)}</row>`
        + '</sheetData></worksheet>' },
  ]);

  const rows = readWorkbook(buffer).rows('Projects');
  assert.deepEqual(rows[0], ['LGA *', 'Ward *', 'Item *']);
  assert.deepEqual(rows[1], ['Akinyele', 'IKEREKU', 'Borehole (new)']);
});

test('a styled cell keeps all of its text', () => {
  // Excel splits a cell whose text was partly reformatted into runs.
  const buffer = zip([
    { name: 'xl/workbook.xml',
      data: '<workbook><sheets><sheet name="S" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels',
      data: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: 'xl/sharedStrings.xml',
      data: '<sst><si><r><t>Solar </t></r><r><t>street light</t></r></si></sst>' },
    { name: 'xl/worksheets/sheet1.xml',
      data: '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>' },
  ]);
  assert.equal(readWorkbook(buffer).rows()[0][0], 'Solar street light');
});

test('a gap in the middle of a row does not shift the values left', () => {
  // Excel omits untouched cells entirely, so C and E arrive with nothing
  // between them. Reading positionally would put E's value under D.
  const buffer = zip([
    { name: 'xl/workbook.xml',
      data: '<workbook><sheets><sheet name="S" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels',
      data: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: 'xl/worksheets/sheet1.xml',
      data: '<worksheet><sheetData><row r="1">'
        + '<c r="A1" t="inlineStr"><is><t>a</t></is></c>'
        + '<c r="E1" t="inlineStr"><is><t>e</t></is></c>'
        + '</row></sheetData></worksheet>' },
  ]);
  assert.deepEqual(readWorkbook(buffer).rows()[0], ['a', '', '', '', 'e']);
});

test('a number is read as its value, not as a blank', () => {
  const buffer = zip([
    { name: 'xl/workbook.xml',
      data: '<workbook><sheets><sheet name="S" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels',
      data: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: 'xl/worksheets/sheet1.xml',
      data: '<worksheet><sheetData><row r="1">'
        + '<c r="A1"><v>50</v></c><c r="B1" t="str"><f>1+1</f><v>2</v></c><c r="C1"/>'
        + '</row></sheetData></worksheet>' },
  ]);
  assert.deepEqual(readWorkbook(buffer).rows()[0], ['50', '2', '']);
});

/* --------------------------- hostile or broken files ------------------------ */

test('something that is not a zip is refused politely', () => {
  assert.throws(() => readWorkbook(Buffer.from('this is a text file, not a spreadsheet')),
    /not a zip archive|empty or truncated/);
});

test('an empty upload is refused', () => {
  assert.throws(() => unzip(Buffer.alloc(0)), /empty or truncated/);
});

test('a zip that is not a workbook is refused', () => {
  const buffer = zip([{ name: 'readme.txt', data: 'hello' }]);
  assert.throws(() => readWorkbook(buffer), /not an Excel workbook/);
});

test('only the parts we need are inflated', () => {
  // A crafted archive should not be able to make us expand something large
  // and irrelevant just by naming it in the directory.
  const buffer = zip([
    { name: 'xl/workbook.xml',
      data: '<workbook><sheets><sheet name="S" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels',
      data: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: 'xl/worksheets/sheet1.xml', data: '<worksheet><sheetData/></worksheet>' },
    { name: 'payload.bin', data: 'x'.repeat(200000) },
  ]);
  assert.equal(Object.keys(unzip(buffer)).includes('payload.bin'), false);
});

/* --------------------------------- oddments --------------------------------- */

test('column references convert past Z', () => {
  assert.equal(columnIndex('A1'), 1);
  assert.equal(columnIndex('Z9'), 26);
  assert.equal(columnIndex('AA1'), 27);
  assert.equal(columnIndex('BC12'), 55);
});

test('xml entities come back as themselves', () => {
  assert.equal(decode('Water &amp; Sanitation'), 'Water & Sanitation');
  assert.equal(decode('a &#65; &#x42;'), 'a A B');
});

test('csv quoting survives commas and quotes', () => {
  const rows = parseCsv('a,"b,c","say ""hi"""\r\nd,e,f');
  assert.deepEqual(rows[0], ['a', 'b,c', 'say "hi"']);
  assert.deepEqual(rows[1], ['d', 'e', 'f']);
});

/* ------------------------------- wiring ------------------------------------ */

test('the import INSERT lists as many values as columns', () => {
  // Structural, because a mismatch here is not a failed request -- it is every
  // import failing, and only once there is a database to fail against. The
  // column list is long enough that adding one and forgetting a placeholder is
  // the obvious mistake.
  const src = fs.readFileSync(path.join(here, 'index.js'), 'utf8');
  const start = src.indexOf("app.post('/api/projects/import'");
  assert.ok(start > 0, 'the import route has moved');
  const block = src.slice(start, src.indexOf('projects_imported', start));

  const columns = /INSERT INTO projects \(([\s\S]*?)\) '/.exec(block)[1]
    .replace(/['+\n\s]/g, '').split(',').filter(Boolean);
  const placeholders = (/VALUES \(([^)]*)\)/.exec(block)[1].match(/\?/g) || []).length;
  const args = /\)\.run\(([\s\S]*?)\);/.exec(block)[1]
    .split(/,(?![^(]*\))/).map((a) => a.trim()).filter(Boolean);

  assert.equal(placeholders, columns.length, 'placeholders do not match the column list');
  assert.equal(args.length, columns.length, 'arguments do not match the column list');
});

test('the import routes are registered before /api/projects/:id', () => {
  // Otherwise Express hands "import" to the :id handler as an id.
  const src = fs.readFileSync(path.join(here, 'index.js'), 'utf8');
  assert.ok(src.indexOf("app.delete('/api/projects/import/:batch'")
    < src.indexOf("app.delete('/api/projects/:id'"));
  assert.ok(src.indexOf("app.get('/api/projects/template.") < src.indexOf("app.get('/api/projects'"));
});

test('every column the importer produces exists in the projects table', () => {
  // The additive migrations in db.js are the only place these get created.
  const schema = fs.readFileSync(path.join(here, 'db.js'), 'utf8');
  const { project } = one({ ...GOOD, community: 'Ikereku' });
  const declared = new Set([
    ...[...schema.matchAll(/^\s{2}([a-z_]+)\s+(?:TEXT|INTEGER|SERIAL|DOUBLE)/gm)].map((m) => m[1]),
    ...[...schema.matchAll(/\['projects', '([a-z_]+)'/g)].map((m) => m[1]),
  ]);
  const missing = Object.keys(project).filter((k) => !declared.has(k));
  assert.deepEqual(missing, []);
});
