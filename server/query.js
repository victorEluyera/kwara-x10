#!/usr/bin/env node
// A SQL console for the places this app actually runs.
//
// DigitalOcean's panel has no query editor for managed Postgres, and the
// container is node:24-alpine -- no psql, and `apt-get install postgresql-client`
// is not a command that exists there. What the container does have is node and
// the `pg` module this app already depends on. So that is the console:
//
//   node server/query.js --tables
//   node server/query.js "SELECT * FROM projects LIMIT 5"
//   node server/query.js -f report.sql --out=report.csv
//
// Read-only by default. Everything runs inside a transaction that is rolled
// back unless --write is passed, because this points at production and an
// UPDATE without a WHERE has no undo.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';

export const has = (argv, name) => argv.includes('--' + name);
export const opt = (argv, name) => {
  const hit = argv.find((a) => a.startsWith('--' + name + '='));
  return hit === undefined ? null : hit.slice(name.length + 3);
};

export const USAGE = `
Usage: node server/query.js [sql | -f FILE] [options]

  --tables            every table with its approximate row count
  --describe=TABLE    the columns of one table
  --csv               print CSV instead of an aligned table
  --out=FILE          write CSV to FILE instead of the screen
  --max=N             rows to print, default 50 (ignored for --csv/--out)
  --write             COMMIT instead of rolling back (needed to change data)
  --help

With no sql and no -f, the statement is read from standard input.
`.trim();

export const PRESET_TABLES = `SELECT relname AS table_name, n_live_tup AS approx_rows,
       pg_size_pretty(pg_total_relation_size(relid)) AS size
  FROM pg_stat_user_tables
 ORDER BY n_live_tup DESC`;

export const PRESET_DESCRIBE = `SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = $1
 ORDER BY ordinal_position`;

export function readSql(argv) {
  const fileAt = argv.findIndex((a) => a === '-f' || a === '--file');
  if (fileAt !== -1) {
    const path = argv[fileAt + 1];
    if (!path) throw new Error('-f needs a file path');
    return { sql: fs.readFileSync(path, 'utf8'), params: [] };
  }

  if (has(argv, 'tables')) return { sql: PRESET_TABLES, params: [] };

  const describe = opt(argv, 'describe');
  if (describe) return { sql: PRESET_DESCRIBE, params: [describe] };

  const positional = argv.filter((a, i) =>
    !a.startsWith('-') && argv[i - 1] !== '-f' && argv[i - 1] !== '--file');
  if (positional.length) return { sql: positional.join(' '), params: [] };

  // Piped in: node server/query.js < report.sql
  if (!process.stdin.isTTY) {
    const piped = fs.readFileSync(0, 'utf8').trim();
    if (piped) return { sql: piped, params: [] };
  }

  return null;
}

/* ------------------------------ formatting -------------------------------- */

const CELL_LIMIT = 60;

export function show(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function table(rows, fields, max = 50) {
  if (!rows.length) return '(no rows)';
  const cols = fields.map((f) => f.name);
  const shown = rows.slice(0, max);
  const text = shown.map((row) => cols.map((c) => {
    const s = show(row[c]).replace(/\s*\n\s*/g, ' ');
    return s.length > CELL_LIMIT ? s.slice(0, CELL_LIMIT - 1) + '…' : s;
  }));

  const width = cols.map((c, i) =>
    Math.max(c.length, ...text.map((r) => r[i].length)));
  const line = (cells) => cells.map((s, i) => s.padEnd(width[i])).join('  ').trimEnd();

  return [
    line(cols),
    width.map((w) => '-'.repeat(w)).join('  '),
    ...text.map(line),
    '',
    rows.length > shown.length
      ? `${shown.length} of ${rows.length} rows (--max=${rows.length} for all)`
      : `${rows.length} row${rows.length === 1 ? '' : 's'}`,
  ].join('\n');
}

export const csvCell = (v) => {
  const s = show(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export function csv(rows, fields) {
  const cols = fields.map((f) => f.name);
  return [cols.map(csvCell).join(',')]
    .concat(rows.map((row) => cols.map((c) => csvCell(row[c])).join(',')))
    .join('\n') + '\n';
}

/* --------------------------------- main ----------------------------------- */

export async function main(argv) {
  if (has(argv, 'help') || argv.includes('-h') || !argv.length) {
    console.log(USAGE);
    return;
  }

  const input = readSql(argv);
  if (!input || !input.sql.trim()) {
    console.error('Nothing to run.\n\n' + USAGE);
    process.exitCode = 2;
    return;
  }

  const write = has(argv, 'write');
  const client = await db.pool.connect();
  let results;
  try {
    await client.query('BEGIN');
    // A raw query, not db.all() -- that rewrites `?` into $1 for the app's own
    // statements, which would corrupt a question mark typed in a WHERE clause.
    const answer = await client.query({ text: input.sql, values: input.params });
    results = Array.isArray(answer) ? answer : [answer];
    await client.query(write ? 'COMMIT' : 'ROLLBACK');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* keep the real error */ }
    throw error;
  } finally {
    client.release();
  }

  const out = opt(argv, 'out');
  const max = Number(opt(argv, 'max') || 50);

  for (const result of results) {
    if (!result.fields?.length) {
      console.log(`${result.command || 'OK'}: ${result.rowCount ?? 0} row(s)`);
      continue;
    }
    if (out) {
      fs.writeFileSync(out, csv(result.rows, result.fields));
      console.log(`${result.rows.length} rows -> ${out}`);
    } else if (has(argv, 'csv')) {
      process.stdout.write(csv(result.rows, result.fields));
    } else {
      console.log(table(result.rows, result.fields, Number.isFinite(max) ? max : 50));
    }
  }

  if (!write && results.some((r) => r.command && !/^(SELECT|SHOW|EXPLAIN)$/i.test(r.command))) {
    console.log('\nRolled back -- nothing was saved. Add --write to keep it.');
  }
}

export function run(argv) {
  return main(argv)
    .catch((error) => {
      console.error('\n' + (error.message || error));
      if (error.hint) console.error('hint: ' + error.hint);
      if (error.position) console.error('at character ' + error.position);
      process.exitCode = 1;
    })
    .finally(() => db.pool.end().catch(() => {}));
}

// Only when this file is what was run. Guarded so that importing it opens no
// connection -- and NODE_TEST_CONTEXT because `node --test server/` executes
// every .js in the directory as a test file, this one included, which would
// otherwise have it connect to production and print a table mid-suite.
const invoked = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked && !process.env.NODE_TEST_CONTEXT) run(process.argv.slice(2));
