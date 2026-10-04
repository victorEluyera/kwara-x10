// Loads the BSA-YV members master list as Grassroot logins.
//
//   node server/seed-grassroots.js             # create missing accounts
//   --dry-run          print what it would do, touch nothing (needs no database)
//   --reset-passwords  put existing BSA-YV accounts back on the starting password
//
// It also runs by itself, once, when the server boots (see index.js), so a
// deploy is enough to get the accounts onto the live database. An audit_log
// row marks that it has run; after that, boot never touches these accounts
// again, so a login an admin deletes stays deleted.
//
// Every account starts on the same password (GRASSROOT_PASSWORD, default
// Password1234) with must_reset set, so the server refuses everything except
// "change my password" until the member picks their own. Usernames are in
// server/data/bsa-yv-members.js -- the member's phone number where it is valid
// and unique on the sheet, otherwise bsayv-<S/N>.
//
// Safe to re-run: an existing username is skipped rather than duplicated.

import { fileURLToPath } from 'node:url';
import { db, nowISO, initSchema, audit } from './db.js';
import { hashPassword, referralCode } from './auth.js';
import { BSA_YV_MEMBERS } from './data/bsa-yv-members.js';

export const GRASSROOT_PASSWORD = process.env.GRASSROOT_PASSWORD || 'Password1234';
const MARKER = 'grassroot_import_bsa_yv';
const DESIGNATION = 'BSA-YV';

/**
 * Create every BSA-YV member that does not have a login yet: one members row
 * (level grassroot) and one users row (role grassroot) linked to it, locked to
 * their LGA|ward|polling unit exactly as a Grassroot registered in the app is.
 */
export async function importGrassroots({ resetPasswords = false, log = console.log } = {}) {
  const existing = new Map((await db.prepare(
    'SELECT id, username FROM users'
  ).all()).map((u) => [String(u.username).toLowerCase(), u.id]));

  // One hash shared by every new account: scrypt is deliberately slow, and
  // hashing 2,000 copies of the same starting password would stall boot for
  // minutes. It is replaced by a per-user hash the moment each member sets
  // their own password.
  const hash = hashPassword(GRASSROOT_PASSWORD);
  let created = 0;
  let reset = 0;
  const skipped = [];

  await db.transaction(async (tx) => {
    for (const m of BSA_YV_MEMBERS) {
      const userId = existing.get(m.username.toLowerCase());
      if (userId) {
        if (resetPasswords) {
          await tx.prepare('UPDATE users SET password_hash = ?, must_reset = 1 WHERE id = ?')
            .run(hash, userId);
          reset++;
        } else {
          skipped.push(m.username);
        }
        continue;
      }
      const member = await tx.prepare(
        'INSERT INTO members (code,first_name,last_name,phone,designation,lga,ward,polling_unit,level,'
        + 'status,checks_json,risk_score,risk_flags,created_at) '
        + 'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
      ).run(referralCode('KWARA'), m.first_name, m.last_name, m.phone, DESIGNATION,
        m.lga, m.ward, m.polling_unit, 'grassroot', 'pending', '{}', 0, '[]', nowISO());
      await tx.prepare(
        'INSERT INTO users (username,password_hash,must_reset,role,full_name,phone,'
        + 'scope_type,scope_value,member_id,referral_code,status,created_at) '
        + 'VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
      ).run(m.username, hash, 1, 'grassroot', m.first_name + ' ' + m.last_name, m.phone || null,
        'polling_unit', m.lga + '|' + m.ward + '|' + m.polling_unit,
        Number(member.lastInsertRowid), referralCode('U'), 'active', nowISO());
      created++;
    }
  });

  await audit(null, 'system', MARKER, null, null,
    { total: BSA_YV_MEMBERS.length, created, reset, skipped: skipped.length });
  log('BSA-YV grassroots: ' + created + ' created, ' + reset + ' reset, '
    + skipped.length + ' already existed (of ' + BSA_YV_MEMBERS.length + ').');
  if (skipped.length && !resetPasswords) {
    log('  Existing usernames left untouched: ' + skipped.slice(0, 20).join(', ')
      + (skipped.length > 20 ? ' ...' : ''));
  }
  return { created, reset, skipped };
}

/** Boot hook: import once per database, then never again. */
export async function importGrassrootsOnce() {
  if (process.env.GRASSROOT_IMPORT_ON_BOOT === '0') return;
  const done = await db.prepare('SELECT id FROM audit_log WHERE action = ? LIMIT 1').get(MARKER);
  if (done) return;
  try {
    await importGrassroots();
  } catch (error) {
    // Rolled back as a whole by the transaction; the next boot retries.
    console.error('BSA-YV grassroot import failed: ' + error.message);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--dry-run')) {
    const byLga = {};
    for (const m of BSA_YV_MEMBERS) byLga[m.lga] = (byLga[m.lga] || 0) + 1;
    console.log(BSA_YV_MEMBERS.length + ' grassroot accounts would be created:');
    for (const [lga, n] of Object.entries(byLga)) console.log('  ' + lga.padEnd(20) + n);
    process.exit(0);
  }
  await initSchema();
  await importGrassroots({ resetPasswords: process.argv.includes('--reset-passwords') });
  process.exit(0);
}
