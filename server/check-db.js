// Connection diagnostic. Answers one question: can we reach this database,
// and if not, exactly why?
//
//   DATABASE_URL=... node server/check-db.js
//
// Prints the host, port, user and database, plus the LENGTH of the password
// but never the password itself -- so the output is safe to paste into chat
// or a ticket. Opens one connection and closes it. Writes nothing.

import pg from 'pg';
import { stripSslMode } from './db.js';

const raw = process.env.DATABASE_URL;

if (!raw) {
  console.log('DATABASE_URL is not set in this environment.');
  process.exit(1);
}

console.log('Raw value length:', raw.length);

let parsed;
try {
  parsed = new URL(stripSslMode(raw));
} catch (error) {
  console.log('This is not a valid connection string:', error.message);
  console.log('It should start with postgresql:// -- yours starts with',
    JSON.stringify(raw.slice(0, 15)));
  process.exit(1);
}

const password = decodeURIComponent(parsed.password || '');
console.log('  protocol:', parsed.protocol);
console.log('  user:    ', parsed.username || '(none)');
console.log('  password:', password ? password.length + ' characters' : '(EMPTY)');
console.log('  host:    ', parsed.hostname);
console.log('  port:    ', parsed.port || '(default 5432)');
console.log('  database:', parsed.pathname.replace(/^\//, '') || '(none)');
console.log('  sslmode in URL:', /sslmode=/i.test(raw) ? 'yes (stripped before use)' : 'no');

// A DigitalOcean password is normally 25+ characters. A short one usually
// means the string was truncated when it was copied.
if (password && password.length < 16) {
  console.log('\n  ^ that password looks short -- it may have been cut off when copied.');
}

console.log('\nConnecting...');

const client = new pg.Client({
  connectionString: stripSslMode(raw),
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10_000,
});

try {
  await client.connect();
  const { rows } = await client.query(
    'SELECT current_user, current_database(), version()'
  );
  console.log('\nCONNECTED.');
  console.log('  signed in as:', rows[0].current_user);
  console.log('  database:    ', rows[0].current_database);
  console.log('  server:      ', String(rows[0].version).split(',')[0]);

  const tables = await client.query(
    "SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema = 'public'"
  );
  console.log('  tables present:', tables.rows[0].n);
  await client.end();
  process.exit(0);
} catch (error) {
  console.log('\nFAILED:', error.message);
  const hint = {
    '28P01': 'The password is wrong. Reset it: database cluster -> Users & Databases -> doadmin -> Reset password.',
    '3D000': 'The database name at the end of the URL does not exist on this cluster.',
    ENOTFOUND: 'The hostname does not resolve -- the URL is malformed or the wrong host was copied.',
    ETIMEDOUT: 'Reached nothing. From a laptop you need the PUBLIC connection string, not the VPC one.',
    ECONNREFUSED: 'Nothing listening there -- wrong port, or the cluster is still provisioning.',
  }[error.code] || null;
  if (hint) console.log('\n  ->', hint);
  process.exit(1);
}
