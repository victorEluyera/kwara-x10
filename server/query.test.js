// The console SQL runner. What matters here is that it is safe to point at
// production by accident: read-only unless asked, and honest about it.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  csv, csvCell, has, opt, readSql, show, table,
  PRESET_TABLES, PRESET_DESCRIBE, USAGE,
} from './query.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIELDS = [{ name: 'id' }, { name: 'ward' }, { name: 'quantity' }];
const ROWS = [
  { id: 1, ward: 'IKEREKU', quantity: 12 },
  { id: 2, ward: 'SABI GANA II', quantity: null },
];

test('importing the module opens no connection and runs nothing', () => {
  // The guard at the bottom keys off argv[1]; under the test runner that is
  // the test file, so main() must not have fired on import.
  assert.ok(USAGE.includes('--tables'));
});

test('flags are read without swallowing the sql', () => {
  const argv = ['SELECT 1', '--csv', '--max=200'];
  assert.equal(has(argv, 'csv'), true);
  assert.equal(has(argv, 'write'), false);
  assert.equal(opt(argv, 'max'), '200');
  assert.equal(opt(argv, 'out'), null);
  assert.equal(readSql(argv).sql, 'SELECT 1');
});

test('an --out= path containing = survives', () => {
  assert.equal(opt(['--out=a=b.csv'], 'out'), 'a=b.csv');
});

test('sql split across arguments by the shell is rejoined', () => {
  // Unquoted on the command line, `SELECT * FROM projects` arrives as words.
  const argv = ['SELECT', 'id', 'FROM', 'projects', '--csv'];
  assert.equal(readSql(argv).sql, 'SELECT id FROM projects');
});

test('-f reads the file and does not treat the path as sql', () => {
  const file = path.join(here, '..', 'node_modules', '.query-test.sql');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'SELECT 42 AS answer;\n');
  try {
    const input = readSql(['-f', file, '--csv']);
    assert.match(input.sql, /SELECT 42/);
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('--describe passes the table name as a parameter, never interpolated', () => {
  // Interpolating it would make `--describe="x; DROP TABLE users"` a live
  // statement. It is bound instead, so the worst case is zero rows.
  const input = readSql(["--describe=users; DROP TABLE users"]);
  assert.equal(input.sql, PRESET_DESCRIBE);
  assert.deepEqual(input.params, ['users; DROP TABLE users']);
  assert.equal(/\$\{|\+ *describe/.test(PRESET_DESCRIBE), false);
});

test('--tables needs no parameters', () => {
  assert.deepEqual(readSql(['--tables']), { sql: PRESET_TABLES, params: [] });
});

test('nothing to run reports nothing to run', () => {
  const was = process.stdin.isTTY;
  process.stdin.isTTY = true;   // so it does not try to read a piped statement
  try {
    assert.equal(readSql(['--csv']), null);
  } finally {
    process.stdin.isTTY = was;
  }
});

test('null prints as empty, not as the word null', () => {
  assert.equal(show(null), '');
  assert.equal(show(undefined), '');
  assert.equal(show(0), '0');
  assert.equal(show(false), 'false');
});

test('a timestamp prints as an ISO string and JSON as JSON', () => {
  assert.equal(show(new Date('2026-09-29T08:00:00Z')), '2026-09-29T08:00:00.000Z');
  assert.equal(show({ a: 1 }), '{"a":1}');
});

test('columns line up and the row count is reported', () => {
  const out = table(ROWS, FIELDS);
  const lines = out.split('\n');
  assert.equal(lines[0], 'id  ward          quantity');
  assert.equal(lines[1], '--  ------------  --------');
  assert.match(out, /2 rows$/);
  // A null cell leaves a gap rather than printing "null".
  assert.equal(/null/.test(out), false);
});

test('a long cell is truncated so one row cannot destroy the table', () => {
  const rows = [{ id: 1, ward: 'W'.repeat(400), quantity: 1 }];
  for (const line of table(rows, FIELDS).split('\n')) {
    assert.ok(line.length < 120, 'a line ran away: ' + line.length);
  }
});

test('a newline inside a value does not become a second row', () => {
  const rows = [{ id: 1, ward: 'first\nsecond', quantity: 1 }];
  const body = table(rows, FIELDS).split('\n');
  assert.equal(body.length, 5, 'header, rule, one row, blank, count');
  assert.match(body[2], /first second/);
});

test('printing is capped, and says what it capped', () => {
  const many = Array.from({ length: 500 }, (_, i) => ({ id: i, ward: 'W', quantity: i }));
  const out = table(many, FIELDS, 5);
  assert.match(out, /5 of 500 rows/);
  assert.equal(out.split('\n').length, 5 + 4);
});

test('no rows is a sentence, not a bare header', () => {
  assert.equal(table([], FIELDS), '(no rows)');
});

test('CSV quotes commas, quotes and newlines', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('two\nlines'), '"two\nlines"');
  assert.equal(csvCell(null), '');
});

test('CSV is not truncated the way the screen is', () => {
  // The whole point of --out is getting the real value into a spreadsheet.
  const long = 'W'.repeat(400);
  assert.ok(csv([{ id: 1, ward: long, quantity: 1 }], FIELDS).includes(long));
});

test('CSV has a header row and one line per row', () => {
  const lines = csv(ROWS, FIELDS).trim().split('\n');
  assert.equal(lines[0], 'id,ward,quantity');
  assert.equal(lines.length, 3);
  assert.equal(lines[2], '2,SABI GANA II,');
});

test('the default is a rollback, and --write is the only way past it', () => {
  const src = fs.readFileSync(path.join(here, 'query.js'), 'utf8');
  assert.match(src, /client\.query\('BEGIN'\)/);
  assert.match(src, /client\.query\(write \? 'COMMIT' : 'ROLLBACK'\)/);
  assert.match(src, /const write = has\(argv, 'write'\)/);
  // And it must say so, or a silently discarded UPDATE looks like it worked.
  assert.match(src, /Rolled back/);
});

test('the sql goes to the driver raw, not through the app placeholder rewrite', () => {
  // db.all() turns every `?` into $1. A question mark in a LIKE pattern or a
  // string literal would come out as a bind parameter and fail.
  const src = fs.readFileSync(path.join(here, 'query.js'), 'utf8');
  assert.equal(/toPositional/.test(src), false);
  assert.match(src, /client\.query\(\{ text: input\.sql, values: input\.params \}\)/);
});
