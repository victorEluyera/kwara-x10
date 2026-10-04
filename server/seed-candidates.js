// Creates a login for every candidate on the campaign office's official list.
//
//   node server/seed-candidates.js            # create missing accounts
//   --dry-run          print what it would do, touch nothing (needs no database)
//   --password=X       give everyone the same starting password
//   --print            also print credentials to stdout (for the App Platform
//                      console, where the CSV would vanish with the container)
//   --test-candidate   create one disposable TEST-DEMO account, nothing else
//   --test-set         create one disposable account per risky profile
//                      (split LGA, multi-LGA, senate, federal, governor)
//   --reset-passwords  reissue passwords for accounts that already exist
//
// Usernames follow the campaign's format: GOV-/SEN-/FH-/SH- + FIRSTNAME + a
// unique number, e.g. SEN-YUNUS-01.
//
// Passwords are generated, shown once, and written to
// server/data/candidate-credentials.csv. That file is gitignored -- hand it
// out, then delete it. Nobody can recover a password afterwards; an admin can
// only issue a new one.
//
// Safe to re-run: an existing username is skipped rather than duplicated.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, nowISO, initSchema } from './db.js';
import { hashPassword, tempPassword, referralCode } from './auth.js';
import { CANDIDATES } from './data/candidates.js';
import { withUsernames } from './candidate-usernames.js';
import { SENATORIAL, FEDERAL } from './data/geo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRY_RUN = process.argv.includes('--dry-run');
const RESET_PASSWORDS = process.argv.includes('--reset-passwords');
// For running somewhere with no durable filesystem (e.g. the App Platform
// console), where the CSV would vanish with the container. Prints the
// passwords to stdout so they can be copied out -- which also means they end
// up in that terminal's scrollback, so only use it when you must.
const PRINT = process.argv.includes('--print');
// --password=Password1234 gives every candidate the same starting password,
// which makes handing out 50 logins practical. It is only safe because the
// server refuses every endpoint except "change my password" while must_reset
// is set, so it cannot survive first use. Omit it to generate a unique
// password per candidate instead.
const passwordArg = process.argv.find((a) => a.startsWith('--password='));
const SHARED_PASSWORD = passwordArg ? passwordArg.slice('--password='.length) : null;
if (passwordArg && SHARED_PASSWORD.length < 8) {
  console.error('--password must be at least 8 characters (the app rejects shorter ones).');
  process.exit(1);
}

// Disposable accounts for rehearsing the real thing. Each one stands in for a
// candidate profile that exercises a different code path, so a problem shows
// up here rather than on a real candidate's first login. Delete them from
// Platform accounts when finished.
//
//   --test-candidate  one account, for checking login and the forced password
//                     change
//   --test-set        one account per risky profile (see below)
const TEST_CANDIDATE = { prefix: 'TEST', first_name: 'Demo', full_name: 'Demo Kwara Senator', office: 'Senator', scope_type: 'senatorial', scope_value: 'Kwara Central', designation: 'Demo account' };

const TEST_SET = [TEST_CANDIDATE];

const roster = process.argv.includes('--test-set') ? TEST_SET
  : process.argv.includes('--test-candidate') ? [TEST_CANDIDATE]
  : CANDIDATES;

// Usernames come from the shared module so the printable credential sheet
// and the accounts actually created can never disagree.
const withNames = withUsernames(roster);

// A dry run only reports what it would do, so it deliberately needs no
// database -- useful for reviewing the generated usernames before the
// database even exists.
if (!DRY_RUN) await initSchema();

/* ------------------------------ sanity checks ----------------------------- */

// A scope_value the app's geography does not recognise means that candidate
// signs in to an empty dashboard, so say so loudly rather than let it pass.
const warnings = [];
for (const c of roster) {
  if (c.scope_type === 'senatorial' && !SENATORIAL[c.scope_value]) {
    warnings.push('Senatorial district not in geo.js: ' + c.scope_value);
  }
  if (c.scope_type === 'federal' && !FEDERAL[c.scope_value]) {
    warnings.push('Federal constituency not in geo.js: ' + c.scope_value);
  }
}
const stateConstCount = roster.filter((c) => c.scope_type === 'state_const').length;

const seen = new Set();
for (const c of withNames) {
  if (seen.has(c.username)) warnings.push('Duplicate username generated: ' + c.username);
  seen.add(c.username);
}

if (warnings.length) {
  console.log('\nWarnings:');
  for (const w of warnings) console.log('  - ' + w);
  console.log('');
}

/* -------------------------------- creation -------------------------------- */

const issued = [];
let created = 0;
let reset = 0;
let skipped = 0;

for (const candidate of withNames) {
  const user = candidate.username;

  if (DRY_RUN) {
    issued.push({ ...candidate, username: user, password: '(dry run)' });
    created++;
    continue;
  }

  const existing = await db.prepare('SELECT id FROM users WHERE username = ?').get(user);

  if (existing && !RESET_PASSWORDS) {
    skipped++;
    continue;
  }

  const password = SHARED_PASSWORD || tempPassword();

  if (existing) {
    await db.prepare('UPDATE users SET password_hash = ?, must_reset = 1 WHERE id = ?')
      .run(hashPassword(password), existing.id);
    reset++;
  } else {
    await db.prepare(
      'INSERT INTO users (username,password_hash,must_reset,role,office,full_name,'
      + 'scope_type,scope_value,referral_code,status,created_at) '
      + 'VALUES (?,?,?,?,?,?,?,?,?,?,?)'
    ).run(user, hashPassword(password), 1, 'candidate', candidate.office,
      candidate.full_name, candidate.scope_type, candidate.scope_value,
      referralCode(), 'active', nowISO());
    created++;
  }

  issued.push({ ...candidate, username: user, password });
}

/* -------------------------------- output ---------------------------------- */

if (issued.length && !DRY_RUN && PRINT) {
  console.log('\n--- COPY EVERYTHING BELOW, IT IS NOT RECOVERABLE ---\n');
  console.log('username,password,full_name,office,constituency');
  for (const c of issued) {
    console.log([c.username, c.password, c.full_name, c.office,
      c.scope_value || 'Kwara State'].join(','));
  }
  console.log('\n--- END ---\n');
}

if (issued.length && !DRY_RUN) {
  const csvPath = path.join(__dirname, 'data', 'candidate-credentials.csv');
  const esc = (v) => (/[",\n]/.test(String(v ?? '')) ? '"' + String(v).replace(/"/g, '""') + '"' : (v ?? ''));
  fs.writeFileSync(csvPath,
    ['username,password,full_name,office,constituency']
      .concat(issued.map((c) => [c.username, c.password, c.full_name, c.office,
        c.scope_value || 'Kwara State'].map(esc).join(',')))
      .join('\n') + '\n');
  console.log('Credentials written to ' + csvPath);
  console.log('Hand them out, then delete that file -- passwords cannot be recovered.\n');
}

console.log(DRY_RUN ? 'DRY RUN -- nothing was written.' : 'Done.');
console.log('  created:  ' + created);
if (reset) console.log('  reissued: ' + reset);
if (skipped) console.log('  skipped (already exist): ' + skipped);
if (stateConstCount) {
  console.log('  state assembly candidates: ' + stateConstCount
    + ' (scoped to their own wards, not the whole LGA)');
}

if (DRY_RUN) {
  console.log('\nUsernames that would be created:\n');
  for (const c of issued) {
    console.log('  ' + c.username.padEnd(26) + c.full_name);
  }
}

process.exit(0);
