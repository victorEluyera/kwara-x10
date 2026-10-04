// Load the INEC voter register into the voter_roll table.
//
//   node server/load-voter-roll.js <register.xlsx> [options]
//
//     --csv=PATH      write a COPY-ready CSV instead of inserting, so the
//                     whole register can be loaded with one psql command in
//                     about two minutes rather than three million round trips
//     --batch=NAME    label this load (default: the file name and date)
//     --truncate      empty voter_roll first, rather than merging
//     --limit=N       stop after N voters, for a trial run
//     --dry-run       parse and report, write nothing
//
// The register is 3.27 million rows in a 235 MB workbook that expands to
// 2.4 GB of XML, so it is streamed a chunk at a time (see xlsx-stream.js) and
// written in batches. Expect roughly fifteen minutes end to end.
//
// ONLY FIVE FIELDS ARE KEPT: the voter ID, the name, and the LGA, ward and
// polling unit. The register also carries date of birth, phone number, home
// address, occupation and disability status for every voter in the state.
// None of that is needed to answer "is this VIN real and is it in the unit
// this person claims", so none of it is imported. Do not add columns to this
// loader without a reason that survives being read aloud.

import fs from 'node:fs';
import path from 'node:path';
import { db, nowISO } from './db.js';
import { listSheets, eachRow } from './xlsx-stream.js';
import { matchLga } from './grid3.js';

/**
 * Rows per INSERT.
 *
 * 5,000 x 8 columns is 40,000 parameters, comfortably inside Postgres' cap of
 * 65,535. At 1,000 the register took 3,276 round trips and the time was almost
 * entirely latency rather than work -- over a home connection to the cluster
 * that is the difference between fifteen minutes and three.
 */
const BATCH = Number(process.env.LOAD_BATCH) || 5000;

/** Header spellings we accept, in the order the columns are stored. */
const FIELDS = [
  { key: 'vin', headers: ['voter id number', 'voter id', 'vin', 'voterid'] },
  { key: 'name', headers: ['name', 'full name', 'voter name'] },
  { key: 'polling_unit', headers: ['polling unit', 'pollingunit', 'pu'] },
  { key: 'ward', headers: ['ward'] },
  { key: 'lga', headers: ['lga', 'local government', 'local government area'] },
];

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const key = (v) => clean(v).toLowerCase();

/** Which column each field sits in, from the header row. */
export function mapHeader(headerRow) {
  const seen = new Map();
  (headerRow || []).forEach((cell, index) => {
    const k = key(cell);
    if (k && !seen.has(k)) seen.set(k, index);
  });

  const index = {};
  const missing = [];
  for (const field of FIELDS) {
    const at = field.headers.map((h) => seen.get(h)).find((v) => v !== undefined);
    if (at === undefined) missing.push(field.key);
    else index[field.key] = at;
  }
  return { index, missing };
}

/**
 * Split one register name into the two columns voter_roll holds.
 *
 * The register gives a single lowercase field, "chika ezeobi". Nigerian
 * registers list given names first and the surname last, and the surname is
 * what the VIN check compares against, so the last word is the surname and
 * everything before it is the rest of the name. Nothing is discarded.
 */
export function splitName(full) {
  const parts = clean(full).split(' ').filter(Boolean);
  if (!parts.length) return { first_name: null, last_name: null };
  if (parts.length === 1) return { first_name: null, last_name: parts[0] };
  return { first_name: parts.slice(0, -1).join(' '), last_name: parts[parts.length - 1] };
}

/** The five fields we keep, or null if the row has no usable VIN. */
export function readRow(cells, index) {
  const vin = clean(cells[index.vin]).toUpperCase().replace(/\s/g, '');
  if (!vin) return null;
  const { first_name, last_name } = splitName(cells[index.name]);
  // The register writes "ogbomoso north" and "oorelope" where we write
  // "Ogbomosho North" and "Orelope". Left alone, 7.7% of rows sit under an LGA
  // name nothing else in the system uses. grid3.js already knows the aliases.
  const rawLga = clean(cells[index.lga]);
  return {
    vin,
    first_name,
    last_name,
    lga: matchLga(rawLga) || rawLga || null,
    ward: clean(cells[index.ward]) || null,
    polling_unit: clean(cells[index.polling_unit]) || null,
  };
}

const PLACEHOLDERS = (rows) => Array.from({ length: rows }, (_, r) =>
  '(' + Array.from({ length: 8 }, (_, c) => '$' + (r * 8 + c + 1)).join(',') + ')').join(',');

async function writeBatch(rows, stamp, batch) {
  if (!rows.length) return;
  const params = [];
  for (const r of rows) {
    params.push(r.vin, r.last_name, r.first_name, r.lga, r.ward, r.polling_unit, stamp, batch);
  }
  await db.pool.query(
    'INSERT INTO voter_roll (vin,last_name,first_name,lga,ward,polling_unit,loaded_at,batch) '
    + 'VALUES ' + PLACEHOLDERS(rows.length) + ' '
    + 'ON CONFLICT (vin) DO UPDATE SET last_name=excluded.last_name, '
    + 'first_name=excluded.first_name, lga=excluded.lga, ward=excluded.ward, '
    + 'polling_unit=excluded.polling_unit, loaded_at=excluded.loaded_at, batch=excluded.batch',
    params);
}

/** Postgres CSV quoting: double the quotes, wrap anything that needs it. */
const csvCell = (value) => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? '"' + text.split('"').join('""') + '"' : text;
};

export async function loadRegister(file, options = {}) {
  const { limit = Infinity, dryRun = false, truncate = false, csv = null } = options;
  const stamp = nowISO();
  const batch = options.batch || path.basename(file, '.xlsx').slice(0, 60) + ' ' + stamp.slice(0, 10);

  const sheets = (await listSheets(file)).filter((s) => !/^index$/i.test(s.name));
  if (!sheets.length) throw new Error('No data sheets in that workbook');

  // Writing a file instead of talking to the database at all.
  let out = null;
  if (csv) {
    out = fs.createWriteStream(csv, { encoding: 'utf8' });
    out.write('vin,last_name,first_name,lga,ward,polling_unit,loaded_at,batch\n');
  }

  if (truncate && !dryRun && !csv) {
    process.stderr.write('Emptying voter_roll first...\n');
    await db.pool.query('TRUNCATE voter_roll');
  }

  const totals = { sheets: sheets.length, read: 0, kept: 0, skipped: 0 };
  const started = Date.now();
  let pending = [];

  for (const sheet of sheets) {
    let index = null;
    process.stderr.write(`\n${sheet.name} (${(sheet.entry.size / 1e6).toFixed(0)} MB)\n`);

    try {
      await eachRow(file, sheet, async (cells, rowNumber) => {
        if (rowNumber === 1) {
          const header = mapHeader(cells);
          if (header.missing.length) {
            throw new Error(`${sheet.name} is missing column(s): ${header.missing.join(', ')}`);
          }
          index = header.index;
          return;
        }

        totals.read++;
        const row = readRow(cells, index);
        if (!row) { totals.skipped++; return; }

        totals.kept++;
        if (out) {
          const line = [row.vin, row.last_name, row.first_name, row.lga, row.ward,
            row.polling_unit, stamp, batch].map(csvCell).join(',') + '\n';
          // Respect back-pressure: at three million rows an unbounded buffer
          // is the difference between 200 MB of memory and 2 GB.
          if (!out.write(line)) {
            await new Promise((resolve) => out.once('drain', resolve));
          }
        } else if (!dryRun) {
          pending.push(row);
          if (pending.length >= BATCH) {
            const chunk = pending;
            pending = [];
            await writeBatch(chunk, stamp, batch);
          }
        }

        if (totals.kept % 50000 === 0) {
          const seconds = (Date.now() - started) / 1000;
          process.stderr.write(`  ${totals.kept.toLocaleString()} voters`
            + `  (${Math.round(totals.kept / seconds).toLocaleString()}/s)\n`);
        }
        if (totals.kept >= limit) throw new Error('__LIMIT__');
      });
    } catch (error) {
      if (error.message !== '__LIMIT__') throw error;
      break;
    }
  }

  if (out) {
    await new Promise((resolve) => out.end(resolve));
    process.stderr.write('\nWrote ' + csv + '\n');
  } else if (!dryRun && pending.length) {
    await writeBatch(pending, stamp, batch);
  }

  totals.batch = batch;
  totals.seconds = Math.round((Date.now() - started) / 1000);
  return totals;
}

/* ----------------------------------- cli ----------------------------------- */

const invokedDirectly = String(process.argv[1] || '').endsWith('load-voter-roll.js');
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const flag = (name) => args.find((a) => a.startsWith('--' + name + '='))?.split('=').slice(1).join('=');

  if (!file) {
    process.stderr.write('Usage: node server/load-voter-roll.js <register.xlsx> '
      + '[--batch=NAME] [--truncate] [--limit=N] [--dry-run]\n');
    process.exit(1);
  }

  const totals = await loadRegister(file, {
    batch: flag('batch'),
    csv: flag('csv') || null,
    limit: Number(flag('limit')) || Infinity,
    dryRun: args.includes('--dry-run'),
    truncate: args.includes('--truncate'),
  });

  process.stderr.write('\n'
    + `Read    ${totals.read.toLocaleString()} rows across ${totals.sheets} sheet(s)\n`
    + `Kept    ${totals.kept.toLocaleString()} voters\n`
    + `Skipped ${totals.skipped.toLocaleString()} rows with no voter ID\n`
    + `Batch   ${totals.batch}\n`
    + `Took    ${totals.seconds}s\n`);
  if (flag('csv')) {
    process.stderr.write('\nLoad it with:\n'
      + '  psql "$DATABASE_URL" -c "TRUNCATE voter_roll"\n'
      + '  psql "$DATABASE_URL" -c "' + String.raw`\copy voter_roll FROM '`
      + flag('csv') + String.raw`' CSV HEADER` + '"\n');
  }
  await db.pool.end();
}
