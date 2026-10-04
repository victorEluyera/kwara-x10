// The spreadsheet handed to candidates.
//
// The failure that matters here is silent: a dropdown whose range is one row
// short, so the last item in the catalogue cannot be chosen and nobody notices
// until a candidate cannot find "Wheelchair". So the tests read the generated
// workbook back out and check the ranges against the lists they point at.

import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import express from 'express';

import {
  COLUMNS, buildProjectTemplate, projectTemplateCsv, templateFilename,
} from './project-template.js';
import { ITEMS, UNITS } from './data/project-items.js';
import { SCALES, PROJECT_STATUSES } from './data/project-framework.js';
import { columnLetter } from './xlsx.js';

/* --------------------------- reading a zip back ---------------------------- */

/** Walk the local file headers. Sound because our writer emits no descriptors. */
function unzip(buf) {
  const out = {};
  let at = 0;
  while (at + 30 <= buf.length && buf.readUInt32LE(at) === 0x04034b50) {
    const method = buf.readUInt16LE(at + 8);
    const compressed = buf.readUInt32LE(at + 18);
    const nameLen = buf.readUInt16LE(at + 26);
    const extraLen = buf.readUInt16LE(at + 28);
    const name = buf.toString('utf8', at + 30, at + 30 + nameLen);
    const start = at + 30 + nameLen + extraLen;
    const body = buf.subarray(start, start + compressed);
    out[name] = (method === 8 ? zlib.inflateRawSync(body) : body).toString('utf8');
    at = start + compressed;
  }
  return out;
}

/**
 * Cell text by reference, e.g. "B3". Good enough for inline-string sheets.
 *
 * The two forms are matched separately and the self-closing one first: with a
 * single pattern, a greedy attribute run walks straight past the `/` of an
 * empty `<c r="C2"/>` and then swallows everything up to the next `</c>` --
 * which is a cell or two later, in the following row.
 */
function cells(sheetXml) {
  const found = {};
  const re = /<c r="([A-Z]+\d+)"[^>]*?\/>|<c r="([A-Z]+\d+)"[^>]*?>([\s\S]*?)<\/c>/g;
  let m;
  while ((m = re.exec(sheetXml))) {
    if (m[1]) { found[m[1]] = ''; continue; }
    const inner = m[3] || '';
    const text = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)?.[1]
      ?? /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '';
    found[m[2]] = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  }
  return found;
}

const AKINYELE = {
  lgas: ['Akinyele'],
  wardsByLga: { Akinyele: ['IKEREKU', 'OJO-EMO/MONIYA', 'OLANLA/OBODA/LABODE'] },
  who: 'Akinyele I',
};

const sheets = (opts = AKINYELE) => {
  const files = unzip(buildProjectTemplate(opts));
  return {
    instructions: files['xl/worksheets/sheet1.xml'],
    projects: files['xl/worksheets/sheet2.xml'],
    lists: files['xl/worksheets/sheet3.xml'],
    files,
  };
};

/* --------------------------------- columns --------------------------------- */

test('column keys and headers are unique', () => {
  assert.equal(new Set(COLUMNS.map((c) => c.key)).size, COLUMNS.length);
  assert.equal(new Set(COLUMNS.map((c) => c.header)).size, COLUMNS.length);
});

test('exactly LGA, ward and item are required', () => {
  assert.deepEqual(COLUMNS.filter((c) => c.required).map((c) => c.key), ['lga', 'ward', 'item']);
});

test('every column explains itself', () => {
  const silent = COLUMNS.filter((c) => !c.help || c.help.length < 20).map((c) => c.key);
  assert.deepEqual(silent, []);
});

/* -------------------------------- the file --------------------------------- */

test('the workbook has the parts Excel requires', () => {
  const { files } = sheets();
  for (const part of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels', 'xl/styles.xml',
    'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/worksheets/sheet3.xml']) {
    assert.ok(files[part], 'missing ' + part);
  }
});

test('the same input produces the same bytes', () => {
  // No timestamps leaking in, so two candidates with the same scope get the
  // same file and a diff of the template is meaningful.
  assert.ok(buildProjectTemplate(AKINYELE).equals(buildProjectTemplate(AKINYELE)));
});

test('a candidate with no LGA gets an error, not an empty sheet', () => {
  assert.throws(() => buildProjectTemplate({ lgas: [], wardsByLga: {} }), /at least one LGA/);
});

/* ------------------------------ the grid sheet ------------------------------ */

test('the header row is the columns, with required ones starred', () => {
  const c = cells(sheets().projects);
  COLUMNS.forEach((column, i) => {
    assert.equal(c[columnLetter(i + 1) + '1'], column.header + (column.required ? ' *' : ''));
  });
});

test('the candidate\'s own wards are typed in for them', () => {
  const c = cells(sheets().projects);
  assert.equal(c.A2, 'Akinyele');
  assert.equal(c.B2, 'IKEREKU');
  assert.equal(c.B3, 'OJO-EMO/MONIYA');
  assert.equal(c.B4, 'OLANLA/OBODA/LABODE');
  assert.equal(c.C2, '', 'only the location is pre-filled, never the content');
});

test('a statewide holder gets no pre-fill', () => {
  // 351 pre-typed rows is not help, it is a wall.
  const wardsByLga = { Akinyele: Array.from({ length: 250 }, (_, i) => 'W' + i) };
  const c = cells(sheets({ lgas: ['Akinyele'], wardsByLga }).projects);
  assert.equal(c.A2, undefined);
});

/* ------------------------------- the dropdowns ------------------------------ */

const validationFor = (xml, key) => {
  const letter = columnLetter(COLUMNS.findIndex((c) => c.key === key) + 1);
  const re = new RegExp(`sqref="${letter}2:${letter}\\d+"[^>]*>` + '<formula1>(.*?)</formula1>');
  return re.exec(xml)?.[1] ?? null;
};

test('every column that should be a dropdown is one', () => {
  const xml = sheets().projects;
  for (const key of ['lga', 'ward', 'item', 'unit']) {
    assert.ok(validationFor(xml, key), key + ' has no dropdown');
  }
});

test('free-text columns are left free', () => {
  const xml = sheets().projects;
  for (const key of ['community', 'polling_unit', 'quantity', 'requested_by', 'notes']) {
    assert.equal(validationFor(xml, key), null, key + ' should not be constrained');
  }
});

// The regression that matters: a list grows, its range does not, and the last
// entry silently becomes unpickable.
for (const [key, list] of [
  ['item', () => ITEMS],
  ['unit', () => UNITS],
]) {
  test(`the ${key} dropdown reaches the last entry in its list`, () => {
    const { projects, lists } = sheets();
    const formula = validationFor(projects, key);
    const [, letter, last] = /Lists!\$([A-Z]+)\$2:\$[A-Z]+\$(\d+)/.exec(formula);
    assert.equal(Number(last), list().length + 1, 'range does not cover the whole list');

    const c = cells(lists);
    assert.ok(c[letter + last], `Lists!${letter}${last} is empty -- the range overshoots`);
    assert.equal(c[letter + (Number(last) + 1)] ?? '', '', 'the range stops short of the list');
  });
}

test('the item dropdown lists every item, in catalogue order', () => {
  const { projects, lists } = sheets();
  const letter = /Lists!\$([A-Z]+)\$/.exec(validationFor(projects, 'item'))[1];
  const c = cells(lists);
  ITEMS.forEach((item, i) => {
    assert.equal(c[letter + (i + 2)], item.label);
  });
});

test('the ward dropdown offers only this candidate\'s wards', () => {
  const { projects, lists } = sheets();
  const [, letter, last] = /Lists!\$([A-Z]+)\$2:\$[A-Z]+\$(\d+)/
    .exec(validationFor(projects, 'ward'));
  const c = cells(lists);
  const offered = [];
  for (let r = 2; r <= Number(last); r++) offered.push(c[letter + r]);
  assert.deepEqual(offered, AKINYELE.wardsByLga.Akinyele);
});

/* --------------------------------- the rest -------------------------------- */

test('the instructions name every column', () => {
  const xml = sheets().instructions;
  for (const column of COLUMNS) assert.ok(xml.includes(column.header), 'unexplained: ' + column.header);
});

test('the CSV fallback has the same headers', () => {
  const headers = projectTemplateCsv().split(',').map((h) => h.replace(/^"|"$/g, ''));
  assert.equal(headers.length, COLUMNS.length);
  assert.equal(headers[0], 'LGA *');
});

test('the filename cannot escape its directory', () => {
  assert.equal(templateFilename('../../etc/passwd'), 'project-list-etc-passwd.xlsx');
  assert.equal(templateFilename(''), 'project-list-kwarax10.xlsx');
  assert.equal(templateFilename('Sen. Alli', 'csv'), 'project-list-Sen-Alli.csv');
});

test('the download route matches xlsx and csv, and nothing else', async () => {
  // The path carries an extension, which is unusual enough to be worth
  // pinning: Express must not treat ".xlsx" as part of a parameter.
  const app = express();
  app.get('/api/projects/template.:extension(xlsx|csv)',
    (req, res) => res.json({ extension: req.params.extension }));
  app.use((_req, res) => res.status(404).end());

  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/api/projects/template.';
  try {
    assert.equal((await (await fetch(base + 'xlsx')).json()).extension, 'xlsx');
    assert.equal((await (await fetch(base + 'csv')).json()).extension, 'csv');
    assert.equal((await fetch(base + 'exe')).status, 404);
  } finally {
    server.close();
  }
});
