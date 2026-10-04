// Creates an administrator login.
//
//   node server/create-admin.js --username=x --role=admin --name="Full Name"
//
//   --username=      required, lowercase
//   --role=          admin | superadmin | campaign_admin   (default: admin)
//   --name=          required, the person's real name
//   --phone=         optional, but needed for self-service password recovery
//   --password=      optional; one is generated and printed if omitted
//   --no-must-change the account keeps this password instead of being forced
//                    to choose a new one on first sign-in
//
// Superadmin can only be created here on purpose -- the role is left out of
// the app's own "Create login" dropdown so it cannot be handed out by an
// admin clicking around the interface.
//
// Safe to re-run: an existing username is reported, never overwritten.

import { db, nowISO, initSchema } from './db.js';
import { hashPassword, tempPassword, referralCode } from './auth.js';

const arg = (name) => {
  const found = process.argv.find((a) => a.startsWith('--' + name + '='));
  return found ? found.slice(name.length + 3) : null;
};

const username = (arg('username') || '').trim().toLowerCase();
const role = (arg('role') || 'admin').trim();
const fullName = (arg('name') || '').trim();
const phone = (arg('phone') || '').trim() || null;
const chosenPassword = arg('password');
const mustChange = !process.argv.includes('--no-must-change');

const ALLOWED_ROLES = new Set(['admin', 'superadmin', 'campaign_admin']);

const fail = (message) => { console.error(message); process.exit(1); };

if (!username) fail('--username is required, e.g. --username=kwarax10.office');
if (!/^[a-z0-9._-]+$/.test(username)) {
  fail('--username may only contain lowercase letters, numbers, dots, hyphens and underscores.');
}
if (!fullName) fail('--name is required, e.g. --name="Programme Office"');
if (!ALLOWED_ROLES.has(role)) {
  fail('--role must be one of: ' + [...ALLOWED_ROLES].join(', '));
}
if (chosenPassword !== null && chosenPassword.length < 8) {
  fail('--password must be at least 8 characters (the app rejects shorter ones).');
}

await initSchema();

const existing = await db.prepare('SELECT id, role FROM users WHERE LOWER(username) = LOWER(?)')
  .get(username);
if (existing) {
  fail('That username already exists (role: ' + existing.role + '). '
     + 'Pick another, or reset its password from Platform accounts.');
}

const password = chosenPassword || tempPassword();

await db.prepare(
  'INSERT INTO users (username,password_hash,must_reset,role,full_name,phone,'
  + 'scope_type,scope_value,referral_code,status,created_at) '
  + 'VALUES (?,?,?,?,?,?,?,?,?,?,?)'
).run(username, hashPassword(password), mustChange ? 1 : 0, role, fullName, phone,
      'state', null, referralCode(), 'active', nowISO());

const ROLE_LABEL = {
  admin: 'Administrator',
  superadmin: 'Super Admin',
  campaign_admin: 'Campaign Administrator (D.G.)',
};

console.log('\nCreated.');
console.log('  username: ' + username);
console.log('  password: ' + password);
console.log('  role:     ' + (ROLE_LABEL[role] || role));
console.log('  name:     ' + fullName);
console.log('  sees:     the whole state');
console.log(mustChange
  ? '\n  They will be asked to choose a new password the first time they sign in.'
  : '\n  This password is kept as-is -- no change is forced at sign-in.');
console.log('  It is shown only once. Nobody can read it back afterwards.\n');

process.exit(0);
