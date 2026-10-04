// Reading a filled-in nominee list back.
//
// Pure, like the project importer: rows in, a verdict out, nothing touched.
// The database work happens in the route, which is what lets the awkward cases
// here be tested directly -- a phone typed as a number by Excel and handed
// back as 8031234567 with the leading zero eaten, the same person entered
// twice under two spellings, a polling unit copied from the wrong ward.
//
// The quota is counted but never refused. A candidate who really has five
// people in a unit that allows four should be able to record all five; the
// excess is marked so the campaign can see it. What IS refused is a location
// outside the candidate's own ground, because that is not an excess, it is
// somebody else's constituency.

import { POLLING_UNITS, BANKS, canonicalLocation } from './data/geo.js';
import { isValidPhone, isValidNIN, isValidVIN, isValidAccount, normalisePhone }
  from './verify.js';
import { COLUMNS } from './nominee-template.js';
import { readWorkbook, parseCsv } from './xlsx-read.js';
import { verifyMemberLocation } from './member-vin-verification.js';

export const SHEET_NAME = 'Nominees';

const MAX_ROWS = 5000;

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const key = (v) => clean(v).toLowerCase().replace(/\s*\*\s*$/, '').replace(/[^a-z0-9]/g, '');
const digits = (v) => clean(v).replace(/\D/g, '');

/**
 * What counts as the same person, and what to call it when it happens.
 *
 * Name is in the list because most of these sheets are typed from paper, and
 * the same person gets entered twice with no NIN, no PVC and a phone written
 * once as 0803... and once as 803... -- the only thing that matches is the
 * name and the unit they work in.
 */
export const DUPLICATE_FIELDS = [
  ['name', 'That name, in that polling unit,'],
  ['nin', 'That NIN'],
  ['pvc', 'That PVC/VIN'],
  ['account', 'That account number'],
];

/** Two entries are the same person when the name and the unit both match. */
export const nameKey = (first, last, pollingUnit) =>
  [first, last, pollingUnit]
    .map((v) => clean(v).toLowerCase().replace(/[^a-z0-9]/g, '')).join('|');

/** Just the name, for the softer "is this the same person?" question. */
export const personKey = (first, last) =>
  [first, last].map((v) => clean(v).toLowerCase().replace(/[^a-z]/g, '')).sort().join('|');

/* -------------------------------- the header ------------------------------- */

export function mapHeader(headerRow) {
  const seen = new Map();
  (headerRow || []).forEach((cell, index) => {
    const k = key(cell);
    if (k && !seen.has(k)) seen.set(k, index);
  });

  // A few spellings people reach for that are not the header we printed.
  const ALIASES = {
    firstname: 'first_name', othernames: 'first_name', givenname: 'first_name',
    surname: 'last_name', lastname: 'last_name', familyname: 'last_name',
    phonenumber: 'phone', mobile: 'phone', gsm: 'phone',
    pu: 'polling_unit', pollingunitpu: 'polling_unit', unit: 'polling_unit',
    localgovernment: 'lga', lgalocalgovernment: 'lga',
    vin: 'pvc_no', votersvin: 'pvc_no', pvc: 'pvc_no', pvcno: 'pvc_no',
    ninnumber: 'nin', bvn: null,
    bankname: 'bank_name', accountnumber: 'account_number', accountname: 'account_name',
    roleinthecommunity: 'designation', role: 'designation', position: 'designation',
  };

  const index = {};
  const missing = [];
  for (const column of COLUMNS) {
    let at = seen.get(key(column.header));
    if (at === undefined) {
      const alias = [...seen.entries()].find(([k]) => ALIASES[k] === column.key);
      if (alias) at = alias[1];
    }
    if (at === undefined) {
      if (column.required) missing.push(column.header);
    } else index[column.key] = at;
  }

  const known = new Set(COLUMNS.map((c) => key(c.header)));
  const extra = [...seen.keys()].filter((k) => !known.has(k) && !(k in ALIASES)).length;

  return { index, missing, extra };
}

/* ------------------------------- one nominee ------------------------------- */

/**
 * Judge one row.
 *
 * @param {string[]} cells
 * @param {object} ctx { index, lgas, wardsByLga, quota, seenPhones, unitCounts }
 */
export function readRow(cells, ctx) {
  const at = (k) => clean(cells[ctx.index[k]]);
  const errors = [];
  const warnings = [];
  let duplicate = false;

  if (!COLUMNS.some((c) => ctx.index[c.key] !== undefined && at(c.key))) {
    return { blank: true, errors, warnings };
  }

  /* who ------------------------------------------------------------------- */
  const firstName = at('first_name');
  const lastName = at('last_name');
  if (!firstName) (ctx.acceptIssues ? warnings : errors).push('First name is missing');
  if (!lastName) (ctx.acceptIssues ? warnings : errors).push('Surname is missing');

  // Excel stores a phone typed without quotes as a number, which loses the
  // leading zero: 08031234567 comes back as 8031234567. Putting it back is
  // safe -- a Nigerian mobile is eleven digits beginning 0.
  const phoneRaw = at('phone');
  const normalisedPhone = normalisePhone(phoneRaw);
  const phoneValid = isValidPhone(phoneRaw);
  const phone = phoneValid ? normalisedPhone : phoneRaw;
  if (!phoneRaw) warnings.push('Phone is missing — add it later.');
  else if (!phoneValid) {
    warnings.push(`"${phoneRaw}" is not a Nigerian mobile number — kept as typed.`);
  } else if (ctx.seen.phone.has(phone)) {
    duplicate = true;
    errors.push(`${phone} appears earlier in this file, on row ${ctx.seen.phone.get(phone)}`);
  }

  /* where ----------------------------------------------------------------- */
  const lgaRaw = at('lga');
  const place = canonicalLocation({ lga: lgaRaw, ward: at('ward'), polling_unit: at('polling_unit') });
  const lga = place.lga || 'Not specified';
  const ward = place.ward || 'Not specified';
  const pollingUnit = place.polling_unit || 'Not specified';

  if (lga === 'Not specified') warnings.push('LGA is missing — add it later.');
  else if (!ctx.lgas.includes(lga)) warnings.push(`"${lga}" is outside your area — check it later.`);

  const wardsHere = ctx.wardsByLga[lga] || [];
  if (ward === 'Not specified') warnings.push('Ward is missing — add it later.');
  else if (lga && ctx.lgas.includes(lga) && !wardsHere.includes(ward)) {
    warnings.push(`"${ward}" is not a ward of ${lga}, or may be outside your constituency — check it later.`);
  }

  const unitsHere = (lga && ward) ? (POLLING_UNITS[lga]?.[ward] || []) : [];
  if (pollingUnit === 'Not specified') warnings.push('Polling unit is missing — add it later.');
  else if (unitsHere.length && !unitsHere.includes(pollingUnit)) {
    const near = unitsHere.find((u) => key(u) === key(pollingUnit));
    if (near) {
      warnings.push(`Polling unit read as "${near}"`);
    } else {
      warnings.push(`"${pollingUnit}" is not a polling unit in ${ward} — check it later.`);
    }
  }

  /* identifiers, all optional --------------------------------------------- */
  let pvc = clean(at('pvc_no')).toUpperCase().replace(/\s/g, '');
  if (ctx.requireVin && ['--','-','N/A','NA','NONE','NULL','NOTRECORDED','NOTSPECIFIED'].includes(pvc)) pvc='';
  const missingVin = Boolean(ctx.requireVin && !pvc);
  if (missingVin) errors.push('VIN is missing — not registered. Supply the VIN and upload this row again.');
  if (pvc && !isValidVIN(pvc)) warnings.push(`"${pvc}" is not a 19-character VIN — kept anyway`);

  const nin = digits(at('nin'));
  if (at('nin') && !isValidNIN(nin)) warnings.push(`"${at('nin')}" is not an 11-digit NIN — kept anyway`);

  /* bank, all or nothing --------------------------------------------------- */
  const bankName = at('bank_name');
  const accountNumber = digits(at('account_number'));
  const accountName = at('account_name');

  if (bankName && !BANKS.some((b) => key(b) === key(bankName))) {
    warnings.push(`"${bankName}" is not on the bank list — kept as typed`);
  }
  if (at('account_number') && !isValidAccount(accountNumber)) {
    warnings.push(`"${at('account_number')}" is not a 10-digit account number — kept anyway`);
  }
  if (accountNumber && !bankName) warnings.push('An account number with no bank cannot be paid');

  if (errors.length) return { blank: false, errors, warnings, duplicate, missing_vin: missingVin };

  const matchedUnit = unitsHere.find((u) => key(u) === key(pollingUnit)) || pollingUnit;

  // The same person twice in one file. Phone was checked above because it is
  // the field most likely to be right; these catch the rest -- the same NIN
  // under two spellings of a name, or the same name typed into the same unit
  // on two different days of filling the sheet in.
  const ownKeys = {
    name: matchedUnit === 'Not specified' || !firstName || !lastName ? null : nameKey(firstName, lastName, matchedUnit),
    nin: nin || null,
    pvc: pvc || null,
    account: accountNumber || null,
  };
  for (const [field, label] of DUPLICATE_FIELDS) {
    const value = ownKeys[field];
    if (!value) continue;
    const earlier = ctx.seen[field].get(value);
    if (earlier !== undefined) {
      duplicate = true;
      errors.push(`${label} is the same as row ${earlier} in this file — `
        + 'the same person cannot be entered twice');
    }
  }
  if (errors.length) return { blank: false, errors, warnings, duplicate };

  if (phoneValid) ctx.seen.phone.set(phone, ctx.line);
  for (const [field] of DUPLICATE_FIELDS) {
    if (ownKeys[field]) ctx.seen[field].set(ownKeys[field], ctx.line);
  }

  return {
    blank: false,
    errors,
    warnings,
    nominee: {
      first_name: firstName,
      last_name: lastName,
      phone,
      title: at('title') || null,
      designation: at('designation') || null,
      pvc_no: pvc || null,
      nin: nin || null,
      bank_name: bankName || null,
      account_number: accountNumber || null,
      account_name: accountName || null,
      lga,
      ward,
      polling_unit: matchedUnit,
    },
  };
}

/* ------------------------------- a whole file ------------------------------ */

export function readUpload(buffer, filename = '') {
  if (/\.csv$/i.test(filename)) return { rows: parseCsv(buffer.toString('utf8')), sheet: null };

  const workbook = readWorkbook(buffer);
  const rows = workbook.rows(SHEET_NAME);
  if (rows) return { rows: trimTemplatePreamble(rows), sheet: SHEET_NAME };

  const only = workbook.rows();
  if (!only) throw new Error('That workbook has no readable sheet');
  return { rows: trimTemplatePreamble(only), sheet: workbook.sheetNames[0] };
}

function trimTemplatePreamble(rows) {
  const header = rows.slice(0, 10).findIndex(r => mapHeader(r).missing.length === 0);
  return header > 0 ? rows.slice(header) : rows;
}

/**
 * Validate a whole grid.
 *
 * @param {string[][]} rows  including the header
 * @param {object} scope  { lgas, wardsByLga, quota, existingCounts }
 *   existingCounts maps "lga|ward|polling unit" to how many nominees are
 *   already recorded there, so the allowance is judged against the register
 *   rather than against this file alone.
 */
export function validateGrid(rows, { lgas, wardsByLga, quota = null, existingCounts = new Map(), acceptIssues = false, requireVin = false }) {
  const empty = {
    rows: [],
    summary: { read: 0, valid: 0, invalid: 0, blank: 0, warnings: 0, over_quota: 0 },
  };

  if (!rows?.length) return { ok: false, error: 'That file is empty', ...empty };
  if (rows.length - 1 > MAX_ROWS) {
    return { ok: false, error: `That file has more than ${MAX_ROWS} rows`, ...empty };
  }

  const { index, missing, extra } = mapHeader(rows[0]);
  if (missing.length) {
    return {
      ok: false,
      error: 'The first row must be the template\'s headings. Missing: ' + missing.join(', '),
      ...empty,
    };
  }

  const ctx = {
    index, lgas, wardsByLga, acceptIssues, requireVin,
    seen: {
      phone: new Map(), name: new Map(), nin: new Map(), pvc: new Map(), account: new Map(),
    },
    line: 0,
  };

  const out = [];
  const summary = {
    read: 0, valid: 0, invalid: 0, blank: 0, warnings: 0, over_quota: 0, extra_columns: extra,
  };

  for (let i = 1; i < rows.length; i++) {
    ctx.line = i + 1;
    const verdict = readRow(rows[i] || [], ctx);
    if (verdict.blank) { summary.blank++; continue; }

    out.push({
      line: i + 1,
      errors: verdict.errors,
      warnings: verdict.warnings,
      over_quota: false,
      duplicate: Boolean(verdict.duplicate),
      missing_vin: Boolean(verdict.missing_vin),
      nominee: verdict.nominee ?? null,
    });
  }

  applyQuota(out, { quota, existingCounts });
  const counted = { ...summary, ...tally(out) };
  if (!counted.read) {
    return { ok: false, error: 'There are no filled-in rows in that file', rows: out,
      summary: counted };
  }
  // Being over the allowance does not make the file un-saveable. A duplicate
  // does make that row un-saveable, because it would put the same person on
  // the register twice.
  return { ok: counted.invalid === 0, rows: out, summary: counted };
}

/** Re-count the summary from the rows, after anything that changes them. */
function tally(rows) {
  return {
    read: rows.length,
    valid: rows.filter((r) => !r.errors.length).length,
    invalid: rows.filter((r) => r.errors.length).length,
    warnings: rows.filter((r) => r.warnings.length).length,
    over_quota: rows.filter((r) => r.over_quota).length,
    duplicates: rows.filter((r) => r.duplicate).length,
    unverified: rows.filter((r) => r.unverified).length,
    missing_vin: rows.filter((r) => r.missing_vin).length,
  };
}

/**
 * Mark the rows that go past the allowance.
 *
 * Run over the finished rows rather than inside the loop that builds them,
 * because a row that turns out to be a duplicate must not eat one of the
 * unit's places -- and whether it is a duplicate is not known until the
 * register has been checked, which happens after.
 */
export function applyQuota(rows, { quota, existingCounts = new Map() }) {
  const counts = new Map(existingCounts);
  for (const row of rows) {
    row.over_quota = false;
    row.warnings = row.warnings.filter((w) => !w.startsWith('Over the allowance'));
    if (quota == null || row.errors.length || !row.nominee) continue;
    if (!(POLLING_UNITS[row.nominee.lga]?.[row.nominee.ward] || [])
      .includes(row.nominee.polling_unit)) continue;

    const unit = [row.nominee.lga, row.nominee.ward, row.nominee.polling_unit].join('|');
    const before = counts.get(unit) || 0;
    counts.set(unit, before + 1);
    if (before >= quota) {
      row.over_quota = true;
      row.warnings.push('Over the allowance: this makes ' + (before + 1)
        + ' in a polling unit that allows ' + quota
        + '. It will still be added, and marked as over.');
    }
  }
  return rows;
}

/**
 * Mark rows that are already on the register.
 *
 * A duplicate is an error rather than a warning, because the whole point is
 * that the same person is not counted twice: the row has to drop out of the
 * total and out of the save. The candidate is told who it matches, so they can
 * tell a genuine repeat from two people who happen to share a name.
 *
 * @param {object} result  what validateGrid returned
 * @param {object} lookup  { phone, nin, pvc, account, name, person } -- each a
 *                         Map from the value to the member holding it
 * @param {object} opts    { quota, existingCounts }, so the allowance can be
 *                         recounted once the duplicates are out of the way
 */
/**
 * Enough of a VIN to recognise, not enough to copy.
 *
 * The fallback suggestion exists so somebody who transposed two characters can
 * see they had the right person. Printing the register's VIN in full would let
 * a list be filled in from the suggestion alone, with no card in anyone's hand,
 * which is the opposite of verifying it.
 */
export const maskVin = (vin) => {
  const v = String(vin || '').toUpperCase();
  return v.length <= 4 ? v : '…' + v.slice(-4);
};

/**
 * The key the surname fallback is looked up by: surname and polling unit.
 *
 * Not LGA or ward. The register's own labels differ from INEC's for about one
 * row in eight -- "ogbomoso" for our "Ogbomosho", Ibadan wards carrying a
 * "(part i)" suffix -- and every extra field in the key is another chance to
 * disagree about spelling. The lookup is already restricted to the polling
 * units being asked about, so those two add nothing but misses.
 */
export const rollNameKey = (surname, pollingUnit) =>
  [surname, pollingUnit]
    .map((v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '')).join('|');

/**
 * What to say about a VIN that did not match.
 *
 * Name plus ward plus polling unit identifies one voter 98.7% of the time
 * across the Kwara register, so it is a good enough hint to offer -- and nowhere
 * near good enough to accept on. The row stays refused; the candidate gets
 * told who the register thinks they meant.
 */
function suggestion(it, byName) {
  if (!byName) return '';
  const hits = byName.get(rollNameKey(it.last_name, it.polling_unit)) || [];
  if (!hits.length) return '';
  if (hits.length > 1) {
    return ' The register has ' + hits.length + ' people of that surname in that polling unit, '
      + 'so check the card rather than guessing.';
  }
  const [only] = hits;
  return ' The register does have a '
    + [only.first_name, only.last_name].filter(Boolean).join(' ')
    + ' in that polling unit, with VIN ' + maskVin(only.vin)
    + ' — check the card, it may be a typing slip.';
}

export function applyVoterRoll(result, roll, opts = {}) {
  // No register loaded: nothing to check against, and the check has to stay
  // silent rather than refuse everybody.
  if (!roll) return result;
  const byVin = roll instanceof Map ? roll : roll.byVin;
  const byName = roll instanceof Map ? null : roll.byName;

  for (const row of result.rows) {
    if (!row.nominee || row.errors.length) continue;
    const it = row.nominee;

    if (!it.pvc_no) {
      row.unverified = true;
      const message = 'No PVC/VIN, so this person cannot be confirmed against the '
        + 'INEC register — ' + (opts.allowUnverified ? 'will be saved with verified status.' : 'not added.')
        + suggestion(it, byName);
      (opts.allowUnverified ? row.warnings : row.errors).push(message);
      continue;
    }

    const hit = byVin.get(it.pvc_no.toUpperCase());
    if (!hit) {
      row.unverified = true;
      const message = '"' + it.pvc_no + '" is not in the INEC register — '
        + (opts.allowUnverified ? 'will be saved with verified status.' : 'not added.')
        + suggestion(it, byName);
      (opts.allowUnverified ? row.warnings : row.errors).push(message);
      continue;
    }

    // In the register, but not where or who this row says. Raised, not
    // refused: the register spells polling units its own way, and it is a
    // snapshot that people move out of.
    const location = verifyMemberLocation(it, [hit]);
    if (location.status !== 'verified') row.warnings.push(location.reason
      || 'The register has this VIN at "' + [hit.lga, hit.ward, hit.polling_unit].join(' / ')
      + '"; submitted ' + location.differences.join(', ') + ' differs');
  }

  applyQuota(result.rows, opts);
  result.summary = { ...result.summary, ...tally(result.rows) };
  result.ok = result.summary.invalid === 0;
  return result;
}

export function applyRegisterDuplicates(result, lookup, opts = {}) {
  const describe = (m) =>
    (m.first_name + ' ' + m.last_name).trim() + (m.code ? ' (' + m.code + ')' : '');

  for (const row of result.rows) {
    if (!row.nominee || row.errors.length) continue;
    const it = row.nominee;

    const hits = [
      ['phone', it.phone, 'That phone number'],
      ['nin', it.nin, 'That NIN'],
      ['pvc', it.pvc_no, 'That PVC/VIN'],
      ['account', it.account_number, 'That account number'],
      ['name', it.polling_unit === 'Not specified' || !it.first_name || !it.last_name ? null
        : nameKey(it.first_name, it.last_name, it.polling_unit),
        'That name, in that polling unit,'],
    ].filter(([field, value]) => value && lookup[field] && lookup[field].has(value));

    if (hits.length) {
      row.duplicate = true;
      for (const [field, value, label] of hits) {
        row.errors.push(label + ' is already registered to '
          + describe(lookup[field].get(value)) + ' — not added again');
      }
      continue;
    }

    // The same name somewhere else on the register. Nigerian names repeat, so
    // this is a question rather than a verdict, and it is left to the candidate.
    const elsewhere = it.first_name && it.last_name && lookup.person && lookup.person.get(personKey(it.first_name, it.last_name));
    if (elsewhere) {
      row.warnings.push('Someone called ' + it.first_name + ' ' + it.last_name
        + ' is already on your list at ' + (elsewhere.polling_unit || 'another unit')
        + ' — check this is not the same person');
    }
  }

  applyQuota(result.rows, opts);
  result.summary = { ...result.summary, ...tally(result.rows) };
  result.ok = result.summary.invalid === 0;
  return result;
}

export function readNomineeUpload(buffer, filename, scope) {
  const { rows, sheet } = readUpload(buffer, filename);
  return { sheet, ...validateGrid(rows, scope) };
}
