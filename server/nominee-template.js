// The spreadsheet a candidate fills in with their nominees.
//
// The same reasoning as the project list: a Senator has four nominees in each
// of their polling units, and a senatorial district has upwards of a thousand
// polling units. That is thousands of people, and nobody is typing them into a
// form one at a time.
//
// The columns are the ones that already exist on a member record, in the order
// someone would read them off a sheet of paper: who they are, how to reach
// them, where they are, and -- only then -- the bank details, which are for
// the stipend and are filled in later as often as not.

import { LGAS, BANKS } from './data/geo.js';
import { buildWorkbook, toCsv, columnLetter, STYLE } from './xlsx.js';

const LAST_ROW = 2000;

/** Beyond this, a dropdown of polling units is a scroll rather than a help. */
const PU_DROPDOWN_LIMIT = 900;

export const COLUMNS = [
  { key: 'first_name', header: 'First name', required: true, width: 18,
    help: 'As it appears on their PVC.' },
  { key: 'last_name', header: 'Surname', required: true, width: 18,
    help: 'As it appears on their PVC.' },
  { key: 'phone', header: 'Phone', required: false, width: 16,
    help: '11 digits, starting 07, 08 or 09. 0803… — with or without spaces, it does not matter.' },
  { key: 'lga', header: 'LGA', required: false, width: 18,
    help: 'Pick from the dropdown. Only your own local governments are listed.' },
  { key: 'ward', header: 'Ward', required: false, width: 26,
    help: 'Pick from the dropdown.' },
  { key: 'polling_unit', header: 'Polling unit', required: false, width: 34,
    help: 'The unit this person works in. It must be one of the units in that ward.' },
  { key: 'title', header: 'Title', required: false, width: 10,
    help: 'Mr, Mrs, Alhaji, Chief. Optional.' },
  { key: 'designation', header: 'Role in the community', required: false, width: 24,
    help: 'Youth leader, market woman, ward secretary. Optional, but useful later.' },
  { key: 'pvc_no', header: 'PVC number', required: false, width: 24,
    help: 'The VIN printed on the card — 19 or 20 characters. Required once the '
      + 'INEC register is loaded, because that is what every nominee is checked against.' },
  { key: 'nin', header: 'NIN', required: false, width: 16,
    help: '11 digits. Optional.' },
  { key: 'bank_name', header: 'Bank', required: false, width: 28,
    help: 'For the stipend. Pick from the dropdown, or leave all three bank columns blank.' },
  { key: 'account_number', header: 'Account number', required: false, width: 18,
    help: '10 digits.' },
  { key: 'account_name', header: 'Account name', required: false, width: 26,
    help: 'The name on the account — it should match the person.' },
];

const col = (key) => columnLetter(COLUMNS.findIndex((c) => c.key === key) + 1);

/* ------------------------------ reference sheet ---------------------------- */

const LISTS = { lga: 'A', ward: 'B', pollingUnit: 'C', bank: 'E', title: 'F' };

const TITLES = ['Mr', 'Mrs', 'Miss', 'Dr', 'Engr', 'Alhaji', 'Alhaja', 'Chief', 'Pastor', 'Imam'];

function listsSheet({ lgas, wards, pollingUnits }) {
  const columns = {
    [LISTS.lga]: ['LGA', ...lgas],
    [LISTS.ward]: ['Ward', ...wards],
    [LISTS.pollingUnit]: ['Polling unit', ...pollingUnits],
    [LISTS.bank]: ['Bank', ...BANKS],
    [LISTS.title]: ['Title', ...TITLES],
  };

  const height = Math.max(...Object.values(columns).map((v) => v.length));
  const rows = [];
  for (let r = 0; r < height; r++) {
    const row = [];
    for (let c = 1; c <= 6; c++) {
      const value = columns[columnLetter(c)]?.[r] ?? '';
      row.push(r === 0 && value ? { v: value, s: STYLE.bold } : value);
    }
    rows.push(row);
  }

  return {
    name: 'Lists',
    freezeRows: 1,
    columns: [{ width: 20 }, { width: 28 }, { width: 40 }, { width: 4 },
      { width: 30 }, { width: 12 }],
    rows,
  };
}

const range = (letter, n) => `Lists!$${letter}$2:$${letter}$${n + 1}`;

/* ------------------------------- instructions ------------------------------ */

/** The columns for this template: PVC turns required once a register is loaded. */
const columnsFor = (requireVin) => COLUMNS.map((c) =>
  (requireVin && c.key === 'pvc_no' ? { ...c, required: true } : c));

function instructionsSheet({ who, quota, office, pollingUnits, tooManyUnits, requireVin }) {
  const allowance = quota
    ? `${quota} nominee${quota === 1 ? '' : 's'} in each polling unit`
    : 'no fixed limit';

  const rows = [
    [{ v: 'Nominee list', s: STYLE.bold }],
    [who ? `Prepared for ${who}${office ? ' — ' + office : ''}` : 'Prepared for the campaign'],
    [],
    [{ v: 'One row per person.', s: STYLE.bold }],
    [{ v: `You have ${pollingUnits} polling unit${pollingUnits === 1 ? '' : 's'}, `
      + `and the allowance is ${allowance}.`, s: STYLE.hint }],
    [],
    [{ v: 'If you have more people than the allowance, put them in anyway.', s: STYLE.bold }],
    [{ v: 'Nobody is turned away. Rows past the allowance are still saved — they are '
      + 'just marked, so the campaign can see where you are over and by how much. '
      + 'Leaving a real person off the list, or putting them under a neighbouring '
      + 'unit to make the numbers fit, is the worse outcome.', s: STYLE.hint }],
    [],
    [{ v: 'Only the orange columns are required. Bank details can be added later.',
      s: STYLE.hint }],
    ...(requireVin ? [
      [],
      [{ v: 'Every nominee needs their PVC number.', s: STYLE.bold }],
      [{ v: 'Each one is checked against the INEC register for Kwara State. A VIN that '
        + 'is not in the register, or a row with no VIN at all, is listed back to you '
        + 'and not added — so copy them carefully from the cards.', s: STYLE.hint }],
    ] : []),
    [{ v: 'Do not add, remove or rename columns, and do not delete the "Lists" sheet '
      + '— the dropdowns read from it.', s: STYLE.hint }],
    ...(tooManyUnits ? [
      [],
      [{ v: `There are too many polling units in your area (${pollingUnits}) to put them `
        + 'in a dropdown, so that column is free text. Copy the spelling exactly from '
        + 'the "Lists" sheet — a unit we cannot match is the most common reason a row '
        + 'comes back rejected.', s: STYLE.hint }],
    ] : []),
    [],
    [{ v: 'Column', s: STYLE.bold }, { v: 'Required', s: STYLE.bold },
      { v: 'What to write', s: STYLE.bold }],
    ...columnsFor(requireVin).map((c) => [
      { v: c.header, s: STYLE.bold },
      c.required ? 'Yes' : 'Optional',
      c.help,
    ]),
  ];

  return {
    name: 'How to fill this in',
    columns: [{ width: 26 }, { width: 12 }, { width: 88 }],
    rows,
  };
}

/* ---------------------------------- the grid ------------------------------- */

function nomineesSheet({ lgas, wards, pollingUnits, tooManyUnits, requireVin }) {
  const header = columnsFor(requireVin).map((c) => ({
    v: c.header + (c.required ? ' *' : ''),
    s: c.required ? STYLE.headerRequired : STYLE.header,
  }));

  const validations = [
    { range: `${col('lga')}2:${col('lga')}${LAST_ROW}`, source: range(LISTS.lga, lgas.length),
      error: 'Pick one of your local governments from the dropdown.' },
    { range: `${col('ward')}2:${col('ward')}${LAST_ROW}`, source: range(LISTS.ward, wards.length),
      error: 'Pick one of your wards from the dropdown.' },
    { range: `${col('title')}2:${col('title')}${LAST_ROW}`, source: range(LISTS.title, TITLES.length),
      error: 'Pick a title, or leave it blank.' },
    { range: `${col('bank_name')}2:${col('bank_name')}${LAST_ROW}`,
      source: range(LISTS.bank, BANKS.length),
      error: 'Pick the bank from the dropdown, or leave it blank.' },
  ];

  // A senatorial district has well over a thousand polling units. Excel will
  // hold the list, but scrolling it to find one is worse than typing it, so
  // past a point the column is left free and checked on the way back in.
  if (!tooManyUnits) {
    validations.splice(2, 0, {
      range: `${col('polling_unit')}2:${col('polling_unit')}${LAST_ROW}`,
      source: range(LISTS.pollingUnit, pollingUnits.length),
      title: 'Polling unit',
      prompt: 'The unit this person works in. Only units inside your own wards are listed.',
      error: 'Pick a polling unit from the dropdown.',
    });
  }

  return {
    name: 'Nominees',
    freezeRows: 1,
    columns: COLUMNS.map((c) => ({ width: c.width })),
    rows: [header],
    validations,
  };
}

/* ----------------------------------- build --------------------------------- */

/**
 * @param {object} opts
 * @param {string[]} opts.lgas
 * @param {Array<{lga: string, ward: string, polling_unit: string}>} opts.units
 * @param {string} [opts.who]
 * @param {string} [opts.office]
 * @param {number|null} [opts.quota]   nominees allowed per polling unit
 * @returns {Buffer}
 */
export function buildNomineeTemplate({ lgas, units, who, office, quota, requireVin = false }) {
  if (!lgas?.length) throw new Error('a template needs at least one LGA');

  const wards = [...new Set(units.map((u) => u.ward))];
  const pollingUnits = [...new Set(units.map((u) => u.polling_unit))].sort((a, b) =>
    a.localeCompare(b, 'en'));
  const tooManyUnits = pollingUnits.length > PU_DROPDOWN_LIMIT;
  const shape = { lgas, wards, pollingUnits, tooManyUnits, requireVin };

  return buildWorkbook([
    instructionsSheet({ who, office, quota, pollingUnits: units.length, tooManyUnits, requireVin }),
    nomineesSheet(shape),
    listsSheet(shape),
  ]);
}

/** Headers only, for anyone who would rather work in CSV. */
export function nomineeTemplateCsv() {
  return toCsv([COLUMNS.map((c) => c.header + (c.required ? ' *' : ''))]);
}

export function templateFilename(who, extension = 'xlsx') {
  const safe = String(who || 'kwarax10').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `nominees-${safe || 'kwarax10'}.${extension}`;
}

export { LGAS };
