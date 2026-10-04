// Promises that nobody waits for.
//
// This codebase has been bitten by the same mistake four times now, and every
// time it looked like success: the bank reconciliation that never matched, the
// rapid-entry check that never fired, the voter-roll upload that answered with
// a pending promise, and the register clear that returned before it had
// finished deleting. None of them threw. None of them failed a request.
//
// So the rule is enforced structurally rather than left to review.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(here, f), 'utf8');
const sourceFiles = fs.readdirSync(here)
  .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));

/** Every async function the server defines, by name. */
function asyncFunctionNames() {
  const names = new Set();
  for (const f of sourceFiles) {
    const src = read(f);
    for (const m of src.matchAll(/(?:export\s+)?async\s+function\s+([A-Za-z_$][\w$]*)/g)) {
      names.add(m[1]);
    }
    for (const m of src.matchAll(/(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*async\s*\(/g)) {
      names.add(m[1]);
    }
  }
  return names;
}

test('no async function is called and left unhandled', () => {
  const names = asyncFunctionNames();
  assert.ok(names.size > 20, 'the scan found almost nothing — has the shape changed?');

  const loose = [];
  for (const f of sourceFiles) {
    const all = read(f).split('\n');
    all.forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      // A call inside an awaited Promise.all([...]) is consumed by the await
      // several lines above it, not by anything on its own line.
      // Wide enough for a long Promise.all list. The closing "])" guard is what
      // keeps it honest: once the array has closed, a later call on the same
      // lines is no longer covered by that await.
      const back = Math.max(0, i - 16);
      if (/await\s+Promise\.all\s*\(\s*\[/.test(all.slice(back, i + 1).join(' '))
          && !/\]\s*\)/.test(all.slice(back, i).join(' '))) return;
      for (const name of names) {
        const re = new RegExp('(^|[^\\w.$])' + name + '\\s*\\(', 'g');
        let m;
        while ((m = re.exec(line)) !== null) {
          const before = line.slice(0, m.index + m[1].length);
          if (/\b(await|return|yield|typeof)\s*$/.test(before)) continue;
          if (/[.]\s*$/.test(before)) continue;
          if (/(=>|Promise\.all\(|\.then\(|\.catch\(|\.map\(|\.filter\(|\.some\(|\.every\()\s*$/.test(before)) continue;
          if (/(export\s+)?(async\s+)?function\s*$/.test(before)) continue;
          if (/\basync\s*$/.test(before)) continue;
          // Deliberately detached, and says so by handling its own failure.
          if (/\.catch\(/.test(line)) continue;
          loose.push(`${f}:${i + 1}  ${name}()  ${line.trim().slice(0, 80)}`);
        }
      }
    });
  }
  assert.deepEqual(loose, [], 'await these, or attach a .catch() to say the detachment is meant');
});

test('every database statement has its promise consumed', () => {
  // db.prepare(...).run() without await runs eventually, or not at all, and
  // reports nothing either way.
  const loose = [];
  for (const f of sourceFiles) {
    const src = read(f);
    const starters = /\b(?:db|tx|database)\s*\.\s*(prepare|exec|transaction)\s*\(/g;
    let m;
    while ((m = starters.exec(src)) !== null) {
      let before = src.slice(Math.max(0, m.index - 260), m.index);
      const cut = Math.max(before.lastIndexOf(';'), before.lastIndexOf('{'),
        before.lastIndexOf('}'), before.lastIndexOf('=>'));
      if (cut >= 0) before = before.slice(cut + 1);

      const line = src.slice(0, m.index).split('\n').length;
      if (/^\s*(\/\/|\*)/.test(src.split('\n')[line - 1])) continue;
      if (/\b(await|return|yield)\b/.test(before)) continue;
      if (/\.\s*then\s*\(|Promise\.all/.test(before)) continue;
      if (/\.catch\(/.test(src.split('\n')[line - 1])) continue;
      // A statement prepared now and executed later.
      if (m[1] === 'prepare' && /(const|let|var)\s+[\w$]+\s*=\s*$/.test(before.trim() + ' ')) continue;
      loose.push(f + ':' + line + '  ' + src.split('\n')[line - 1].trim().slice(0, 80));
    }
  }
  assert.deepEqual(loose, []);
});

test('audit() is awaited everywhere, not fired and forgotten', () => {
  // Half the call sites awaited it and half did not, which left a reader no
  // way to tell which pattern was deliberate. An audit trail with silent holes
  // is the wrong failure for a system whose premise is that every entry is
  // traceable to a login.
  const bare = read('index.js').split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => /^\s*audit\(/.test(line))
    .map(([i, line]) => 'index.js:' + i + '  ' + line.trim().slice(0, 70));
  assert.deepEqual(bare, []);
});

test('audit() cannot reject', () => {
  // Even awaited, a failed audit insert must not fail the action it records.
  const src = read('db.js');
  const start = src.indexOf('export async function audit(');
  assert.ok(start > 0, 'audit() has moved');
  const body = src.slice(start, src.indexOf('\n}', start));
  assert.match(body, /try\s*\{/, 'audit must swallow and log its own failure');
  assert.match(body, /catch/);
});

test('clearing the register finishes before the reply', () => {
  // The browser loader clears the roll and then immediately starts posting
  // slices of the new one. Unawaited, the delete ran on into the rows that
  // were replacing it.
  const src = read('index.js');
  const start = src.indexOf("app.post('/api/admin/voter-roll/clear'");
  assert.ok(start > 0, 'the clear route has moved');
  const block = src.slice(start, src.indexOf('\napp.', start + 1));
  assert.match(block, /await clearVoterRoll\(\)/);
});

test('every async route is wrapped, or handles its own failure', () => {
  // Express 4 does not catch a rejected handler. That is what took the API
  // down on 23 September: one reserved word in one query, and the process died
  // with every in-flight request attached to it.
  const src = read('index.js');
  const routes = [...src.matchAll(
    /app\.(get|post|put|patch|delete)\(\s*(['"`][^'"`]+['"`])([\s\S]*?)=>/g)];
  assert.ok(routes.length > 50, 'found almost no routes — has the shape changed?');

  const unguarded = [];
  for (const m of routes) {
    const [, method, route, middle] = m;
    if (!/\basync\b/.test(middle)) continue;
    if (/wrap\(/.test(middle)) continue;
    // A handler that try/catches everything itself is equally safe.
    const body = src.slice(m.index, src.indexOf('\napp.', m.index + 1));
    if (/^\s*try\s*\{/m.test(body.slice(0, 200))) continue;
    unguarded.push(method.toUpperCase() + ' ' + route);
  }
  assert.deepEqual(unguarded, [], 'these would take the process down on any error');
});

/* ---------------------- documentation that describes reality --------------- */

test('the external API docs do not promise endpoints that are not there', () => {
  // The integration team was told /all worked. It does not exist. A document
  // that describes a different service from the one running is a defect in the
  // same way a wrong response body is.
  // Normalised first: the file is CRLF on Windows, and a lookahead for a
  // newline followed by "## " never fires against a carriage return, which
  // silently truncates every section to its heading.
  const docs = fs.readFileSync(path.join(here, '..', 'docs', 'EXTERNAL-API.md'), 'utf8')
    .split(String.fromCharCode(13) + String.fromCharCode(10))
    .join(String.fromCharCode(10));
  const source = read('external.js') + read('external-sigar.js');

  const live = new Set([...source.matchAll(/(?:externalRouter|router)\.(?:get|post)\('([^']+)'/g)]
    .map((m) => m[1]));
  assert.ok(live.size > 0, 'found no external routes at all — has the file moved?');

  // Split rather than match a lookahead: with the multiline flag, "$" matches
  // at the end of the heading line, so every section came back empty and every
  // marker looked missing.
  const sections = docs.split('\n## ').slice(1)
    .map((block) => [null, /^`GET (\/[^`\s]*)/.exec(block)?.[1], block])
    .filter(([, route]) => route);
  assert.ok(sections.length > 4, 'found almost no endpoint sections');

  const undeclared = [];
  for (const [, route, body] of sections) {
    const exists = live.has(route) || live.has(route.replace(/\/\{[^}]*\}.*$/, ''));
    const flagged = /\*\*Not deployed\.\*\*/.test(body);
    if (!exists && !flagged) undeclared.push(route + ' — documented, not deployed, not marked');
    if (exists && flagged) undeclared.push(route + ' — deployed, but marked as not deployed');
  }
  assert.deepEqual(undeclared, []);
});
