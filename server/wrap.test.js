// On 23 September 2026 a reserved-word alias in one SQL query took the whole
// API down: the external routes were not wrapped, so the rejected promise
// became an unhandled rejection and Node terminated the process. Every
// in-flight request died with it and the container restarted.
//
// These tests cover the fix -- both that wrap() catches, and that no route
// can be added without it.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wrap } from './wrap.js';

const here = path.dirname(fileURLToPath(import.meta.url));

test('a rejected handler is forwarded to next, not left unhandled', async () => {
  const handler = wrap(async () => { throw new Error('boom'); });
  const forwarded = await new Promise((resolve) => {
    handler({}, {}, resolve);
  });
  assert.ok(forwarded instanceof Error);
  assert.equal(forwarded.message, 'boom');
});

test('a synchronous throw is caught too', async () => {
  const handler = wrap(() => { throw new Error('sync boom'); });
  const forwarded = await new Promise((resolve) => {
    handler({}, {}, resolve);
  });
  assert.equal(forwarded.message, 'sync boom');
});

test('a handler that succeeds never calls next', async () => {
  let calledNext = false;
  let sent = null;
  const handler = wrap(async (_req, res) => { sent = 'ok'; res.json({ ok: true }); });
  await handler({}, { json: () => {} }, () => { calledNext = true; });
  assert.equal(sent, 'ok');
  assert.equal(calledNext, false, 'a successful handler must not invoke the error path');
});

test('every external API route is wrapped', () => {
  // Structural, because the cost of forgetting is an outage rather than a
  // failed request. A new unwrapped route fails here instead of in production.
  // Both files: external.js declares routes on externalRouter directly, and
  // external-sigar.js declares them on the same router passed in as `router`.
  const src = fs.readFileSync(path.join(here, 'external.js'), 'utf8')
    + fs.readFileSync(path.join(here, 'external-sigar.js'), 'utf8');
  const routes = [...src.matchAll(/(?:externalRouter|router)\.(get|post|put|delete)\(([^,]+),\s*([^\n]*)/g)];
  assert.ok(routes.length > 4, 'found no external routes at all — has the file moved?');

  // A helper that applies wrap() itself counts: external-sigar.js registers
  // its routes through `serve`, which is `(build) => wrap(...)`. What matters
  // is that the handler reaching Express is wrapped, not the spelling.
  const wrappers = new Set(['wrap']);
  for (const m of src.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*\([^)]*\)\s*=>\s*wrap\(/g)) {
    wrappers.add(m[1]);
  }

  const unwrapped = routes
    .filter((m) => ![...wrappers].some((w) => m[3].trimStart().startsWith(w + '(')))
    .map((m) => m[2].trim());
  assert.deepEqual(unwrapped, [], 'these routes would crash the process on an async error');
});

test('the api-key middleware is wrapped as well', () => {
  // It queries the database, so an error here kills the process before any
  // handler runs. Either form is fine: wrapped at definition or at use.
  const src = fs.readFileSync(path.join(here, 'external.js'), 'utf8');
  const wrappedAtDefinition = /const authenticateApiKey = wrap\(/.test(src);
  const wrappedAtUse = /externalRouter\.use\(\s*wrap\(\s*authenticateApiKey/.test(src);
  assert.ok(wrappedAtDefinition || wrappedAtUse,
    'the api-key middleware must be wrapped');
});

test('no SQL uses a PostgreSQL reserved word as a bare column alias', () => {
  // "groups" and "rows" are reserved (window-frame syntax). Written without
  // AS they are a syntax error, not a column name -- which is what caused the
  // outage. Aggregate aliases must therefore be explicit.
  const RESERVED = ['groups', 'rows', 'window', 'over'];
  const offenders = [];
  for (const file of fs.readdirSync(here).filter((f) => f.endsWith('.js'))) {
    if (file.endsWith('.test.js')) continue;
    const src = fs.readFileSync(path.join(here, file), 'utf8');
    for (const line of src.split('\n')) {
      if (line.trimStart().startsWith('//')) continue;       // skip commentary
      // An alias, not a following clause: it ends the select item, so what
      // comes next is a comma or the end of the SQL string.
      const m = line.match(
        /\b(?:COUNT|SUM|MAX|MIN|AVG|COALESCE|SUBSTRING)\([^)]*\)\s+([a-z_]+)\s*(?:,|['"]|$)/i);
      if (m && RESERVED.includes(m[1].toLowerCase())) {
        offenders.push(file + ': ' + line.trim().slice(0, 70));
      }
    }
  }
  assert.deepEqual(offenders, [], 'use an explicit AS with a non-reserved alias');
});
