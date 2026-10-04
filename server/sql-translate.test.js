// The app writes SQLite-style `?` placeholders and db.js rewrites them to
// Postgres `$1, $2, ...` on every query. That rewrite sits in front of all
// ~190 query call sites, so a bug in it breaks the whole app at once -- hence
// these tests. Importing db.js opens no database connection.

import test from 'node:test';
import assert from 'node:assert/strict';
import { toPositional, stripSslMode } from './db.js';

test('placeholders are numbered in order', () => {
  assert.equal(
    toPositional('SELECT * FROM members WHERE lga = ? AND ward = ?'),
    'SELECT * FROM members WHERE lga = $1 AND ward = $2'
  );
});

test('a long insert numbers every column', () => {
  const sql = 'INSERT INTO t (a,b,c,d,e,f,g,h,i,j,k) VALUES (?,?,?,?,?,?,?,?,?,?,?)';
  assert.equal(
    toPositional(sql),
    'INSERT INTO t (a,b,c,d,e,f,g,h,i,j,k) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)'
  );
});

test('a question mark inside a string literal is left alone', () => {
  assert.equal(
    toPositional("SELECT * FROM t WHERE label = 'why?' AND id = ?"),
    "SELECT * FROM t WHERE label = 'why?' AND id = $1"
  );
});

test('an escaped quote inside a literal does not break tracking', () => {
  // The '' is an escaped single quote, so the ? after it is still inside the
  // string and must not be renumbered; the final one is a real placeholder.
  assert.equal(
    toPositional("SELECT * FROM t WHERE note = 'it''s a ? really' AND id = ?"),
    "SELECT * FROM t WHERE note = 'it''s a ? really' AND id = $1"
  );
});

test('SQL with no placeholders is unchanged', () => {
  const sql = "UPDATE users SET office = NULL WHERE role <> 'candidate'";
  assert.equal(toPositional(sql), sql);
});

test('repeated calls return the same result (cache is not corrupting)', () => {
  const sql = 'SELECT ? , ?';
  const first = toPositional(sql);
  assert.equal(toPositional(sql), first);
  assert.equal(first, 'SELECT $1 , $2');
});

/* --------------------------- connection string ---------------------------- */
// A managed provider's `?sslmode=require` silently overrides the pool's ssl
// settings in current pg versions and broke the first live deploy, so the
// stripping is covered here. The credentials must survive untouched.

test('sslmode is removed from a DigitalOcean-style URL', () => {
  assert.equal(
    stripSslMode('postgresql://doadmin:pa55@db-x.ondigitalocean.com:25060/defaultdb?sslmode=require'),
    'postgresql://doadmin:pa55@db-x.ondigitalocean.com:25060/defaultdb'
  );
});

test('other query parameters are kept', () => {
  assert.equal(
    stripSslMode('postgresql://u:p@host:5432/db?sslmode=require&application_name=kwarax10'),
    'postgresql://u:p@host:5432/db?application_name=kwarax10'
  );
});

test('a password containing ? or & is left untouched', () => {
  const url = 'postgresql://doadmin:AV%3FNS%26x@host:25060/defaultdb?sslmode=verify-full';
  assert.equal(stripSslMode(url), 'postgresql://doadmin:AV%3FNS%26x@host:25060/defaultdb');
});

test('a URL with no query string is unchanged', () => {
  const url = 'postgresql://u:p@host:5432/db';
  assert.equal(stripSslMode(url), url);
});

test('an unset connection string stays unset', () => {
  assert.equal(stripSslMode(undefined), undefined);
});

test('the real member-search clause translates correctly', () => {
  assert.equal(
    toPositional('(first_name ILIKE ? OR last_name ILIKE ? OR phone ILIKE ? '
      + 'OR code ILIKE ? OR polling_unit ILIKE ?)'),
    '(first_name ILIKE $1 OR last_name ILIKE $2 OR phone ILIKE $3 '
      + 'OR code ILIKE $4 OR polling_unit ILIKE $5)'
  );
});
