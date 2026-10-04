// Builds a printable credential sheet for the candidate logins.
//
//   node server/credential-sheet.js --password=Password1234
//   node server/credential-sheet.js --password=X --url=https://kwarax10.example
//
// Writes server/data/candidate-logins.html. Open it in a browser and use
// Print -> Save as PDF.
//
// One slip per page, so page N of the PDF is candidate N's login and can be
// sent to that candidate alone. That matters: a single document listing all
// 50 logins, forwarded to all 50 people, would let every candidate sign in as
// every other candidate until passwords are changed.
//
// Needs no database -- usernames are generated from the same module the
// seeder uses, so they always match the accounts it creates.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANDIDATES } from './data/candidates.js';
import { withUsernames } from './candidate-usernames.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const arg = (name) => {
  const found = process.argv.find((a) => a.startsWith('--' + name + '='));
  return found ? found.slice(name.length + 3) : null;
};

const password = arg('password');
const appUrl = arg('url') || 'your KWARA X10 web address';

if (!password) {
  console.error('Usage: node server/credential-sheet.js --password=Password1234 [--url=https://...]');
  console.error('The password must match what you passed to seed-candidates.js.');
  process.exit(1);
}

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const roster = withUsernames(CANDIDATES);

// Embedded rather than linked, so the file still shows the crest wherever it
// is opened from -- a relative path breaks as soon as the file is moved,
// emailed, or opened through anything but the repo folder.
let logoSrc = '';
try {
  const logo = fs.readFileSync(
    path.join(__dirname, '..', 'client', 'public', 'brand', 'logo.png'));
  logoSrc = 'data:image/png;base64,' + logo.toString('base64');
} catch {
  console.warn('Note: brand logo not found, the slips will print without it.');
}

const OFFICE_LABEL = {
  Governor: 'Governor',
  Senator: 'Senatorial Candidate',
  'House of Representatives': 'House of Representatives Candidate',
  'House of Assembly': 'House of Assembly Candidate',
};

const slips = roster.map((c, i) => `
  <section class="slip">
    <header>
      ${logoSrc ? '<div class="logo" role="img" aria-label="PDP"></div>' : ''}
      <div>
        <div class="programme">KWARA X10</div>
        <div class="strap">Community Engagement and Intelligence Network</div>
      </div>
      <div class="page-no">${i + 1} of ${roster.length}</div>
    </header>

    <h1>${esc(c.full_name)}</h1>
    <div class="office">${esc(OFFICE_LABEL[c.office] || c.office)}</div>
    <div class="constituency">${esc(c.scope_value || 'Kwara State')}</div>

    <table class="creds">
      <tr><th>Website</th><td class="mono">${esc(appUrl)}</td></tr>
      <tr><th>Username</th><td class="mono strong">${esc(c.username)}</td></tr>
      <tr><th>Password</th><td class="mono strong">${esc(password)}</td></tr>
    </table>

    <div class="note">
      <strong>You must change this password the first time you sign in.</strong>
      The system will ask you to choose your own before you can go any further.
      This password was issued to you and is not private until you change it.
    </div>

    <div class="warn">Do not share these details. Everything submitted under this login is recorded against your name.</div>
  </section>`).join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>KWARA X10 — Candidate Logins</title>
<style>
  @page { size: A4; margin: 16mm; }
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #14261c; margin: 0; }

  .cover { page-break-after: always; padding-top: 10mm; }
  .cover h1 { font-size: 26pt; margin: 0 0 4px; color: #0E4A2B; }
  .cover .sub { color: #5c6b62; margin-bottom: 18px; }
  .cover ol { font-size: 10.5pt; line-height: 1.7; padding-left: 18px; }
  .cover .caution { border: 1.5px solid #9d2a2a; background: #fdf3f3; color: #7d1f1f;
    padding: 10px 12px; border-radius: 6px; margin: 16px 0; font-size: 10.5pt; }
  table.index { width: 100%; border-collapse: collapse; font-size: 9pt; margin-top: 10px; }
  table.index th, table.index td { border-bottom: 1px solid #dfe5e1; padding: 4px 6px; text-align: left; }
  table.index th { background: #f2f6f3; }

  .slip { page-break-after: always; padding-top: 6mm; }
  .slip:last-child { page-break-after: auto; }
  header { display: flex; align-items: center; gap: 12px;
           border-bottom: 2px solid #C9A227; padding-bottom: 10px; margin-bottom: 22px; }
  /* Declared once here rather than inlined into all 50 slips -- repeating the
     data URI per page turned a 100 KB file into 1.8 MB. */
  .logo { height: 46px; width: 53px; background-size: contain;
          background-repeat: no-repeat; background-position: center;
          background-image: url('${logoSrc}'); }
  /* Backgrounds are dropped by default when printing; keep the crest. */
  @media print { .logo { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  .programme { font-size: 17pt; font-weight: 700; color: #0E4A2B; letter-spacing: .5px; }
  .strap { font-size: 8.5pt; color: #5c6b62; }
  .page-no { margin-left: auto; font-size: 8.5pt; color: #8a9790; }

  h1 { font-size: 20pt; margin: 0 0 2px; }
  .office { font-size: 11pt; color: #0E4A2B; font-weight: 700; }
  .constituency { font-size: 10.5pt; color: #5c6b62; margin-bottom: 20px; }

  table.creds { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
  table.creds th { text-align: left; width: 120px; padding: 9px 10px; background: #f2f6f3;
                   border: 1px solid #dfe5e1; font-size: 10pt; }
  table.creds td { padding: 9px 10px; border: 1px solid #dfe5e1; font-size: 11.5pt; }
  .mono { font-family: 'Courier New', monospace; }
  .strong { font-weight: 700; font-size: 13pt; letter-spacing: .4px; }

  .note { border-left: 3px solid #C9A227; background: #fdfaf0; padding: 10px 12px;
          font-size: 10pt; line-height: 1.55; margin-bottom: 12px; }
  .warn { font-size: 9pt; color: #7d1f1f; }
</style>
</head>
<body>

<div class="cover">
  <h1>KWARA X10 — Candidate Logins</h1>
  <div class="sub">PDP Kwara State · ${roster.length} candidates · generated ${new Date().toISOString().slice(0, 10)}</div>

  <div class="caution">
    <strong>This full document is for the campaign office only.</strong>
    Every page after this one is a single candidate's login. Send each candidate
    <em>their page only</em> — not this whole file. Anyone holding the complete
    document can sign in as any candidate who has not yet changed their password.
  </div>

  <ol>
    <li>Print or save this as PDF.</li>
    <li>Send each candidate their own page.</li>
    <li>They sign in and are required to set their own password immediately.</li>
    <li>Delete this file once the logins have been handed out.</li>
  </ol>

  <table class="index">
    <thead><tr><th>Page</th><th>Name</th><th>Office</th><th>Constituency</th><th>Username</th></tr></thead>
    <tbody>
      ${roster.map((c, i) => `<tr><td>${i + 1}</td><td>${esc(c.full_name)}</td>`
        + `<td>${esc(c.office)}</td><td>${esc(c.scope_value || 'Kwara State')}</td>`
        + `<td class="mono">${esc(c.username)}</td></tr>`).join('\n      ')}
    </tbody>
  </table>
</div>

${slips}

</body>
</html>
`;

const out = path.join(__dirname, 'data', 'candidate-logins.html');
fs.writeFileSync(out, html);

console.log('Written: ' + out);
console.log('  ' + roster.length + ' candidates, one per page, plus an index page.');
console.log('\nOpen it in your browser, then Print -> Save as PDF.');
console.log('Send each candidate their own page -- not the whole file.');
