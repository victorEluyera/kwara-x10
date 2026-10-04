// Throwaway scale benchmark. Inserts a large batch of synthetic member rows
// the same way real registrations are shaped, then times the actual queries
// the app runs in production: dashboard aggregates, filtered listings,
// duplicate-check lookups, search.
//
// Point DATABASE_URL at a SCRATCH database -- this writes junk rows and does
// not clean them up.
//
// Run: DATABASE_URL=postgres://... TARGET_ROWS=<n> node server/scratch-bench.js

import crypto from 'node:crypto';
import { db, nowISO, initSchema } from './db.js';
import { LGAS, WARDS, POLLING_UNITS, BANKS } from './data/geo.js';
import { nubanCheckDigit, BANK_CODES } from './verify.js';

const TARGET_ROWS = Number(process.env.TARGET_ROWS || 100000);
const BATCH_SIZE = 1000;

// Host only -- never print the connection string, it carries the password.
console.log('Benchmark DB:', (process.env.DATABASE_URL || '').replace(/^.*@/, '') || '(unset)');
console.log('Target rows:', TARGET_ROWS.toLocaleString());

const FIRST = ['Adebayo', 'Folake', 'Oluwaseun', 'Ayodeji', 'Bimpe', 'Tunde', 'Yewande', 'Kunle'];
const LAST = ['Adeyemi', 'Ogunleye', 'Balogun', 'Akinwale', 'Oyelaran', 'Adigun', 'Fashola'];
const pick = (arr) => arr[crypto.randomInt(arr.length)];
const digits = (n) => Array.from({ length: n }, () => crypto.randomInt(10)).join('');

function nuban(bankName) {
  const serial = digits(9);
  const code = BANK_CODES[bankName];
  if (!code || !/^\d{3}$/.test(code)) return serial + digits(1);
  return serial + nubanCheckDigit(code, serial);
}

async function insertBatch(rows) {
  await db.transaction(async (tx) => {
    for (const r of rows) {
      await tx.prepare(
        'INSERT INTO members (code,first_name,last_name,phone,title,designation,pvc_no,nin,'
        + 'bank_name,account_number,account_name,lga,ward,polling_unit,level,upline_user_id,'
        + 'lat,lng,accuracy,captured_at,status,risk_score,risk_flags,created_at) '
        + 'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
      ).run(r.code, r.first_name, r.last_name, r.phone, r.title, r.designation, r.pvc_no, r.nin,
        r.bank_name, r.account_number, r.account_name, r.lga, r.ward, r.polling_unit, 'mobiliser',
        1, r.lat, r.lng, 10, r.created_at, r.status, 0, '[]', r.created_at);
    }
  });
}

let seq = 0;
function makeRow() {
  seq++;
  const lga = pick(LGAS);
  const wards = WARDS[lga];
  const ward = pick(wards);
  const units = POLLING_UNITS[lga][ward];
  const pu = units[crypto.randomInt(units.length)];
  const bank = pick(BANKS);
  const first = pick(FIRST), last = pick(LAST);
  const daysAgo = crypto.randomInt(90);
  const created = new Date(Date.now() - daysAgo * 86400000).toISOString();
  return {
    code: 'BENCH-' + seq.toString(36).toUpperCase().padStart(7, '0'),
    first_name: first, last_name: last,
    phone: '0' + (70 + crypto.randomInt(10)) + digits(8),
    title: pick(['Mr', 'Mrs', 'Miss']), designation: 'Community Mobiliser',
    pvc_no: ('90F' + digits(16)).slice(0, 19),
    nin: digits(11), bank_name: bank, account_number: nuban(bank),
    account_name: first + ' ' + last,
    lga, ward, polling_unit: pu,
    lat: 7.3 + Math.random() * 1.2, lng: 3.3 + Math.random() * 0.8,
    status: crypto.randomInt(100) < 85 ? 'verified' : 'pending',
    created_at: created,
  };
}

async function timeIt(label, fn) {
  const start = process.hrtime.bigint();
  const result = await fn();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  console.log('  ' + label.padEnd(46) + ms.toFixed(1) + ' ms' + (result !== undefined ? '   -> ' + result : ''));
  return ms;
}

async function main() {
  await initSchema();

  // members.upline_user_id is a FK into users(id) -- a scratch DB has no
  // users yet, so seed one row to satisfy the constraint.
  const existingUser = await db.prepare('SELECT id FROM users LIMIT 1').get();
  if (!existingUser) {
    await db.prepare(
      'INSERT INTO users (username,password_hash,must_reset,role,full_name,created_at) VALUES (?,?,?,?,?,?)'
    ).run('bench-seed', 'x', 0, 'mobiliser', 'Bench Seed', nowISO());
  }

  console.log('\n--- Insert throughput ---');
  const insertStart = process.hrtime.bigint();
  let inserted = 0;
  while (inserted < TARGET_ROWS) {
    const n = Math.min(BATCH_SIZE, TARGET_ROWS - inserted);
    const rows = Array.from({ length: n }, makeRow);
    await insertBatch(rows);
    inserted += n;
    if (inserted % 20000 === 0 || inserted === TARGET_ROWS) {
      const elapsed = Number(process.hrtime.bigint() - insertStart) / 1e9;
      console.log('  ' + inserted.toLocaleString().padStart(9) + ' rows in ' + elapsed.toFixed(1)
        + 's  (' + Math.round(inserted / elapsed).toLocaleString() + ' rows/sec)');
    }
  }
  const totalInsertSec = Number(process.hrtime.bigint() - insertStart) / 1e9;
  console.log('Total insert time: ' + totalInsertSec.toFixed(1) + 's for '
    + TARGET_ROWS.toLocaleString() + ' rows ('
    + Math.round(TARGET_ROWS / totalInsertSec).toLocaleString() + ' rows/sec sustained)');

  const total = (await db.prepare('SELECT COUNT(*) n FROM members').get()).n;
  console.log('\nRows now in table: ' + Number(total).toLocaleString());

  console.log('\n--- Query performance at this scale ---');

  await timeIt('Dashboard totals (COUNT + 4x SUM, full table)', async () => {
    const r = await db.prepare(
      "SELECT COUNT(*) total, SUM(CASE WHEN status='verified' THEN 1 ELSE 0 END) verified "
      + 'FROM members'
    ).get();
    return JSON.stringify(r);
  });

  await timeIt('Coverage by LGA (GROUP BY, full table)', async () => {
    const r = await db.prepare(
      "SELECT lga, COUNT(*) total, SUM(CASE WHEN status='verified' THEN 1 ELSE 0 END) verified, "
      + 'COUNT(DISTINCT ward) wards FROM members GROUP BY lga ORDER BY total DESC'
    ).all();
    return r.length + ' LGA rows';
  });

  await timeIt('Ward breakdown (GROUP BY lga,ward, full table)', async () => {
    const r = await db.prepare(
      'SELECT lga, ward, COUNT(*) total FROM members GROUP BY lga, ward ORDER BY total DESC LIMIT 100'
    ).all();
    return r.length + ' ward rows';
  });

  await timeIt('Members list, filtered + paginated (indexed lga+ward)', async () => {
    const lga = LGAS[5];
    const r = await db.prepare(
      'SELECT * FROM members WHERE lga = ? ORDER BY created_at DESC LIMIT 100 OFFSET 0'
    ).all(lga);
    return r.length + ' rows for ' + lga;
  });

  const deepOffset = Math.min(50000, Math.max(0, Number(total) - 100));
  await timeIt('Deep pagination (OFFSET ' + deepOffset + ')', async () => {
    const r = await db.prepare(
      'SELECT id FROM members ORDER BY created_at DESC LIMIT 100 OFFSET ?'
    ).all(deepOffset);
    return r.length + ' rows';
  });

  const sampleOffset = Math.floor(Number(total) / 2);
  await timeIt('Duplicate check: exact phone match (indexed)', async () => {
    const sample = await db.prepare('SELECT phone FROM members LIMIT 1 OFFSET ?').get(sampleOffset);
    const r = await db.prepare('SELECT id FROM members WHERE phone = ?').all(sample.phone);
    return r.length + ' match(es)';
  });

  await timeIt('Duplicate check: exact PVC match (indexed)', async () => {
    const sample = await db.prepare('SELECT pvc_no FROM members LIMIT 1 OFFSET ?').get(sampleOffset);
    const r = await db.prepare('SELECT id FROM members WHERE pvc_no = ?').all(sample.pvc_no);
    return r.length + ' match(es)';
  });

  await timeIt('Free-text search (LIKE, unindexed, full scan)', async () => {
    const r = await db.prepare(
      "SELECT id FROM members WHERE first_name LIKE ? OR last_name LIKE ? OR phone LIKE ? LIMIT 100"
    ).all('%Ade%', '%Ade%', '%080%');
    return r.length + ' rows (capped at 100)';
  });

  await timeIt('Single member registration insert (real shape)', async () => {
    const row = makeRow();
    await db.prepare(
      'INSERT INTO members (code,first_name,last_name,phone,title,designation,pvc_no,nin,'
      + 'bank_name,account_number,account_name,lga,ward,polling_unit,level,upline_user_id,'
      + 'lat,lng,accuracy,captured_at,status,risk_score,risk_flags,created_at) '
      + 'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    ).run(row.code, row.first_name, row.last_name, row.phone, row.title, row.designation,
      row.pvc_no, row.nin, row.bank_name, row.account_number, row.account_name, row.lga,
      row.ward, row.polling_unit, 'mobiliser', 1, row.lat, row.lng, 10, row.created_at,
      row.status, 0, '[]', row.created_at);
    return 'ok';
  });

  console.log('\nDone.');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
