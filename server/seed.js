// Seeds the KWARA X10 database with one administrator by default.
// Set DEMO_SEED=1 to also create the candidate accounts, field network,
// sample tasks, and submissions used by the demonstration environment.
//
// Every generated password is written to server/data/credentials.csv for
// distribution. Run with --reset to wipe and rebuild.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { db, nowISO, period as currentPeriod, initSchema } from './db.js';
import { hashPassword, tempPassword, referralCode } from './auth.js';
import { LGAS, WARDS, SENATORIAL, FEDERAL, STATE_CONST, BANKS } from './data/geo.js';
import { nubanCheckDigit, BANK_CODES } from './verify.js';
import { recomputeActivationPoints, awardTaskPoints } from './points.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESET = process.argv.includes('--reset');
const DEMO_SEED = process.env.DEMO_SEED === '1';
const PER = currentPeriod();

await initSchema();

if (RESET) {
  // TRUNCATE ... RESTART IDENTITY clears the rows and resets the id sequences
  // in one step; CASCADE lets it run despite the foreign keys between them.
  await db.exec(
    'TRUNCATE points_ledger, submissions, tasks, members, users, audit_log '
    + 'RESTART IDENTITY CASCADE'
  );
  console.log('Existing data cleared.');
}

if ((await db.prepare('SELECT COUNT(*) n FROM users').get()).n > 0 && !RESET) {
  console.log('Database already seeded. Re-run with --reset to rebuild.');
  process.exit(0);
}

const credentials = [];
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const pick = (arr) => arr[crypto.randomInt(arr.length)];
const randDigits = (n) => Array.from({ length: n }, () => crypto.randomInt(10)).join('');

const insertUser = await db.prepare(
  'INSERT INTO users (username,password_hash,must_reset,role,office,full_name,phone,'
  + 'scope_type,scope_value,member_id,referral_code,status,created_at) '
  + 'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'
);

async function createUser(o) {
  const pw = o.password || tempPassword();
  const info = await insertUser.run(
    o.username, hashPassword(pw), o.must_reset === 0 ? 0 : 1, o.role,
    o.office || null, o.full_name, o.phone || null,
    o.scope_type || 'state', o.scope_value || null, o.member_id || null,
    referralCode('U'), 'active', nowISO()
  );
  credentials.push({
    username: o.username, password: pw, role: o.role,
    office: o.office || '', full_name: o.full_name,
    scope: (o.scope_value || 'Kwara State'),
  });
  return Number(info.lastInsertRowid);
}

/* ------------------------------ 1. admin ------------------------------ */

// Never hard-code these. This repo is on GitHub, so a fixed default password
// would hand superadmin to anyone who reads it once the app is on a public
// URL. Set ADMIN_PASSWORD/ADMIN2_PASSWORD in the environment, or let the seed
// generate one and print it once below.
const adminPassword = process.env.ADMIN_PASSWORD || tempPassword();
const admin2Password = process.env.ADMIN2_PASSWORD || tempPassword();

const adminId = await createUser({
  username: 'admin', password: adminPassword, must_reset: 0,
  role: 'superadmin', full_name: 'Programme Administrator',
  scope_type: 'state',
});
await createUser({
  username: 'admin2', password: admin2Password, must_reset: 0,
  role: 'admin', full_name: 'Deputy Administrator',
  scope_type: 'state',
});
console.log('Administrator accounts created.');
if (!process.env.ADMIN_PASSWORD || !process.env.ADMIN2_PASSWORD) {
  console.log('  admin  / ' + adminPassword);
  console.log('  admin2 / ' + admin2Password);
  console.log('  ^ generated for this seed. Copy them now -- they are not shown again.');
}

if (!DEMO_SEED) {
  const csvPath = path.join(__dirname, 'data', 'credentials.csv');
  const esc = (v) => (/[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v);
  fs.writeFileSync(csvPath,
    ['username,password,role,office,full_name,scope']
      .concat(credentials.map((c) =>
        [c.username, c.password, c.role, c.office, c.full_name, c.scope].map(esc).join(',')))
      .join('\n'));
  console.log('Minimal seed complete: 2 administrator accounts created.');
  console.log('  Super administrator   admin / kwarax10-admin');
  console.log('  Administrator         admin2 / kwarax10-admin2');
  process.exit(0);
}

/* --------------------------- 2. 51 candidates -------------------------- */

const FIRST = ['Adebayo', 'Folake', 'Oluwaseun', 'Ayodeji', 'Bimpe', 'Tunde',
  'Yewande', 'Kunle', 'Ronke', 'Segun', 'Damilola', 'Bukola', 'Gbenga',
  'Temitope', 'Olumide', 'Funmilayo', 'Wale', 'Simisola', 'Akin', 'Morayo'];
const LAST = ['Adeyemi', 'Ogunleye', 'Balogun', 'Akinwale', 'Oyelaran', 'Adigun',
  'Fashola', 'Ogundipe', 'Alabi', 'Ojo', 'Bankole', 'Ilesanmi', 'Adebisi',
  'Salami', 'Oyebode', 'Aremu', 'Lawal', 'Odunsi', 'Ajayi', 'Ekundayo'];
const name = () => pick(FIRST) + ' ' + pick(LAST);

await createUser({ username: 'gov.kwara', role: 'candidate', office: 'Governor',
  full_name: name(), scope_type: 'state' });
await createUser({ username: 'dgov.kwara', role: 'candidate', office: 'Deputy Governor',
  full_name: name(), scope_type: 'state' });

for (const district of Object.keys(SENATORIAL)) {
  await createUser({ username: 'sen.' + slug(district), role: 'candidate', office: 'Senator',
    full_name: name(), scope_type: 'senatorial', scope_value: district });
}
for (const fc of Object.keys(FEDERAL)) {
  await createUser({ username: 'rep.' + slug(fc).slice(0, 28), role: 'candidate',
    office: 'House of Representatives', full_name: name(),
    scope_type: 'federal', scope_value: fc });
}
for (const sc of Object.keys(STATE_CONST)) {
  await createUser({ username: 'hoa.' + slug(sc.replace(' State Constituency', '')), role: 'candidate',
    office: 'House of Assembly', full_name: name(),
    scope_type: 'state_const', scope_value: sc });
}
console.log('51 candidate logins created (1 Gov, 1 Deputy, 3 Senators, 14 Reps, 32 Assembly).');

/* ------------------------- 3. demo field network ------------------------ */

const insertMember = await db.prepare(
  'INSERT INTO members (code,first_name,last_name,phone,title,designation,pvc_no,nin,'
  + 'bank_name,account_number,account_name,lga,ward,polling_unit,level,upline_user_id,'
  + 'upline_member_id,lat,lng,accuracy,captured_at,status,risk_score,risk_flags,created_at) '
  + 'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
);

let phoneSeq = 0;
const nextPhone = () => '080' + String(30000000 + (phoneSeq += 7919)).slice(0, 8);

/** A 10-digit account number with a correct (or deliberately wrong) check digit. */
function validNuban(bankName, corrupt = false) {
  const serial = randDigits(9);
  const code = BANK_CODES[bankName];
  if (!code || !/^\d{3}$/.test(code)) return serial + randDigits(1);
  const cd = nubanCheckDigit(code, serial);
  return serial + (corrupt ? (cd + 1 + crypto.randomInt(8)) % 10 : cd);
}

async function makeMember(o) {
  const first = o.first || pick(FIRST);
  const last = o.last || pick(LAST);
  const bank = pick(BANKS);
  // Generate account numbers that satisfy the CBN NUBAN check digit, so the
  // keyless bank check passes. ~7% are deliberately left invalid to exercise
  // the detection path.
  const acct = validNuban(bank, crypto.randomInt(100) < 7);
  // Cluster demo coordinates inside Kwara State.
  const lat = 8.4 + Math.random() * 0.2;
  const lng = 4.4 + Math.random() * 0.2;
  const info = await insertMember.run(
    referralCode('KWARA'), first, last, nextPhone(),
    pick(['Mr', 'Mrs', 'Miss', 'Chief', 'Alhaji', 'Dr']),
    o.designation || 'Unit Promoter',
    // 19-character VIN, matching INEC format.
    ('90F' + randDigits(16)).slice(0, 19),
    randDigits(11), bank, acct, first + ' ' + last,
    o.lga, o.ward, o.polling_unit, o.level,
    o.upline_user_id || null, o.upline_member_id || null,
    lat, lng, 12, nowISO(), o.status || 'verified', 0, '[]', nowISO()
  );
  return Number(info.lastInsertRowid);
}

// Three LGAs with Unit Promoters.
const DEMO_LGAS = ['Asa', 'Ilorin West', 'Irepodun'];
const demoLogins = [];


for (const lga of DEMO_LGAS) {
  const wards = WARDS[lga];

  const mobCount = 10 + crypto.randomInt(3);
  for (let mo = 0; mo < mobCount; mo++) {
    const ward = wards[mo % wards.length];
    const mobMemberId = await makeMember({
      lga, ward, polling_unit: ward + ' / PU ' + String(100 + mo).padStart(3, '0'),
      level: 'mobiliser', designation: 'Unit Promoter',
      upline_user_id: adminId,
    });
    const mob = await db.prepare('SELECT * FROM members WHERE id = ?').get(mobMemberId);

    let mobUserId = null;
    if (mo === 0) {
      mobUserId = await createUser({
        username: 'mob.' + slug(lga), role: 'mobiliser',
        full_name: mob.first_name + ' ' + mob.last_name, phone: mob.phone,
        scope_type: 'polling_unit', scope_value: lga + '|' + ward + '|' + mob.polling_unit,
        member_id: mobMemberId,
      });
      demoLogins.push('mob.' + slug(lga));
    }

  }
}

console.log('Demo network built across ' + DEMO_LGAS.join(', ') + '.');

/* ---------------------------- 4. tasks & work --------------------------- */

const insertTask = await db.prepare(
  'INSERT INTO tasks (title,description,type,points,mandatory,requires_photo,requires_location,'
  + 'questions_json,target_level,target_scope_type,target_scope_value,period,due_at,status,'
  + 'created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
);

const TASKS = [
  { title: 'Attend the ward mobilisation rally', type: 'rally', points: 5,
    level: 'all',
    desc: 'Attend your ward rally and log who else was present.' },
  { title: 'Community priorities survey', type: 'survey', points: 5,
    level: 'all',
    desc: 'Answer the three community priority questions.',
    questions: [
      { id: 'q1', label: 'What is the single biggest problem in this community?',
        type: 'select', options: ['Roads', 'Water', 'Electricity', 'Healthcare',
          'Education', 'Security', 'Jobs', 'Sanitation'] },
      { id: 'q2', label: 'Is the household registered to vote at this polling unit?',
        type: 'select', options: ['Yes, all adults', 'Some adults', 'No'] },
      { id: 'q3', label: 'Anything the candidate should know?', type: 'text' },
    ] },
  { title: 'Household canvass: 10 doors', type: 'canvass', points: 5,
    level: 'mobiliser',
    desc: 'Visit ten households in your polling unit and log the conversation outcome.' },
  { title: 'Local issue report', type: 'issue_report', points: 10,
    level: 'mobiliser',
    desc: 'Report one verified infrastructure or service problem in your area.' },
  { title: 'Support a community meeting', type: 'meeting', points: 10,
    level: 'all', mandatory: 0,
    desc: 'Optional. Convene or support a community meeting in your ward.' },
];

const taskIds = [];
for (const t of TASKS) {
  const info = await insertTask.run(
    t.title, t.desc, t.type, t.points, t.mandatory === 0 ? 0 : 1, 0, 1,
    t.questions ? JSON.stringify(t.questions) : null,
    t.level, 'state', null, PER, null, 'open', adminId, nowISO()
  );
  taskIds.push(Number(info.lastInsertRowid));
}

const allTasks = await db.prepare('SELECT * FROM tasks WHERE period = ?').all(PER);
const mandatoryByLevel = (level) =>
  allTasks.filter((t) => t.mandatory === 1 && (t.target_level === 'all' || t.target_level === level));

// Generate submissions so the payroll and eligibility screens have real data.
const insertSub = await db.prepare(
  'INSERT INTO submissions (task_id,member_id,user_id,answers_json,photo_path,lat,lng,'
  + 'accuracy,note,status,points_awarded,reviewed_by,reviewed_at,created_at) '
  + 'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
);

const everyone = await db.prepare("SELECT * FROM members WHERE status = 'verified'").all();
let subCount = 0;


for (const m of everyone) {
  const required = mandatoryByLevel(m.level);
  // ~93% of members complete and clear all their mandatory work. The rest are
  // left outstanding so the "all downline must finish" gate visibly blocks
  // their upline on the payroll screen.
  const clears = crypto.randomInt(100) < 93;
  const toDo = clears ? required : required.slice(0, crypto.randomInt(required.length));

  for (const task of toDo) {
    const answers = task.type === 'survey'
      ? JSON.stringify({ q1: pick(['Roads', 'Water', 'Electricity', 'Healthcare', 'Security']),
                         q2: pick(['Yes, all adults', 'Some adults']), q3: '' })
      : null;
    const info = await insertSub.run(task.id, m.id, null, answers, null,
      m.lat, m.lng, 15, null, 'approved', task.points, adminId, nowISO(), nowISO());
    await awardTaskPoints({ id: Number(info.lastInsertRowid), member_id: m.id, user_id: null },
      task, PER);
    subCount++;
  }
}

// A handful of submissions left pending so the review queue is not empty.
const pendingPool = await db.prepare(
  "SELECT * FROM members WHERE status = 'verified' AND level = 'mobiliser' LIMIT 12"
).all();
const optionalTask = allTasks.find((t) => t.mandatory === 0);
for (const m of pendingPool) {
  await insertSub.run(optionalTask.id, m.id, null, null, null, m.lat, m.lng, 15,
    'Community meeting held at the ward secretariat.', 'pending', 0, null, null, nowISO());
  subCount++;
}

for (const m of everyone) {
  await recomputeActivationPoints(m.id, PER);
}

console.log(TASKS.length + ' tasks created, ' + subCount + ' submissions generated.');

/* ------------------------- 5. credentials export ------------------------ */

const csvPath = path.join(__dirname, 'data', 'credentials.csv');
const esc = (v) => (/[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v);
fs.writeFileSync(csvPath,
  ['username,password,role,office,full_name,scope']
    .concat(credentials.map((c) =>
      [c.username, c.password, c.role, c.office, c.full_name, c.scope].map(esc).join(',')))
    .join('\n'));

const counts = {
  users: await db.prepare('SELECT COUNT(*) n FROM users').get().n,
  members: await db.prepare('SELECT COUNT(*) n FROM members').get().n,
  verified: await db.prepare("SELECT COUNT(*) n FROM members WHERE status='verified'").get().n,
  tasks: await db.prepare('SELECT COUNT(*) n FROM tasks').get().n,
  submissions: await db.prepare('SELECT COUNT(*) n FROM submissions').get().n,
};

console.log('\n------------------------------------------------------');
console.log('  Seed complete');
console.log('------------------------------------------------------');
console.log('  Logins        ' + counts.users);
console.log('  Members       ' + counts.members + ' (' + counts.verified + ' verified)');
console.log('  Tasks         ' + counts.tasks);
console.log('  Submissions   ' + counts.submissions);
console.log('\n  Administrator   admin / kwarax10-admin');
console.log('  All passwords   server/data/credentials.csv');
console.log('\n  Demo field logins (password in credentials.csv):');
for (const u of demoLogins) console.log('    ' + u);
console.log('------------------------------------------------------\n');
