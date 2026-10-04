// Smoke-test the external API against a running server -- the deployed one or
// local -- exactly as an outside consumer (e.g. Sigar Vote) would call it.
//
//   node server/check-external-api.js https://your-server kwarax10_live_xxx
//
// Checks: auth is enforced, every endpoint answers with the documented shape,
// /registrations pagination walks to the end, no sensitive fields leak, and
// each coverage level adds up to the same total as /summary.

const [base, key] = process.argv.slice(2);
if (!base || !key) {
  console.error('Usage: node server/check-external-api.js <server-url> <api-key>');
  process.exit(1);
}
const root = base.replace(/\/$/, '') + '/api/external/v1';
let failed = 0;
const ok = (label) => console.log('  ok    ' + label);
const bad = (label, detail) => { failed++; console.log('  FAIL  ' + label + (detail ? ' -- ' + detail : '')); };
const check = (cond, label, detail) => (cond ? ok(label) : bad(label, detail));

async function get(path, headers = { 'X-API-Key': key }) {
  const res = await fetch(root + path, { headers, signal: AbortSignal.timeout(30000) });
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, body };
}

console.log('Checking ' + root);

const noKey = await get('/summary', {});
check(noKey.status === 401, 'rejects a request with no key', 'got ' + noKey.status);
const badKey = await get('/summary', { 'X-API-Key': 'kwarax10_live_wrong' });
check(badKey.status === 401, 'rejects a wrong key', 'got ' + badKey.status);

const summary = await get('/summary');
check(summary.status === 200 && summary.body?.totals, 'GET /summary', 'got ' + summary.status
  + ' ' + JSON.stringify(summary.body));
const total = summary.body?.totals?.registered ?? 0;
console.log('        ' + total + ' registered, ' + (summary.body?.surveys?.responses ?? 0) + ' survey responses');

let fetched = 0;
let offset = 0;
let leaked = false;
let pages = 0;
while (offset != null && pages < 1000) {
  const r = await get('/registrations?limit=1000&offset=' + offset);
  if (r.status !== 200) { bad('GET /registrations', 'got ' + r.status); break; }
  fetched += r.body.rows.length;
  leaked ||= r.body.rows.some((row) => ['phone', 'nin', 'pvc_no', 'account_number']
    .some((f) => f in row));
  offset = r.body.next_offset;
  pages++;
}
check(fetched === total, 'GET /registrations pages through every record', fetched + ' of ' + total);
check(!leaked, 'no phone / NIN / PVC / bank fields in registrations');

const surveys = await get('/surveys?limit=5');
check(surveys.status === 200 && Array.isArray(surveys.body?.rows), 'GET /surveys', 'got ' + surveys.status);

for (const level of ['polling_unit', 'ward', 'lga', 'senatorial_district', 'federal_constituency', 'state_constituency']) {
  const r = await get('/coverage?level=' + level);
  const sum = (r.body?.rows || []).reduce((a, row) => a + row.members, 0);
  check(r.status === 200 && sum === total, 'GET /coverage?level=' + level + ' adds up to ' + total,
    'status ' + r.status + ', sum ' + sum);
}
const wrongLevel = await get('/coverage?level=nonsense');
check(wrongLevel.status === 400, 'rejects an unknown coverage level', 'got ' + wrongLevel.status);

console.log(failed ? '\n' + failed + ' check(s) failed.' : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
