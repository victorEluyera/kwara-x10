// The spreadsheet a candidate fills in to submit their project list.
//
// It exists because the proposals candidates actually write are bulk: one is
// eleven wards each getting the same borehole-and-fifty-streetlights package,
// another is thirty-five communities with two or three items apiece. Entering
// that through a six-step form, one project at a time, is ninety trips through
// the same wizard, and nobody will do it.
//
// So: one row per item per place. Columns follow what those proposals already
// contain, nothing more -- every field here was in at least one of them.
//
// The dropdowns come from the same catalogues the app itself uses, so the
// template cannot drift from what the importer will accept. The candidate's
// own LGAs and wards are the only ones offered, and their wards are already
// typed down column B, because the tedious part of a proposal is not deciding
// what to ask for, it is writing "Ward 1... Ward 2... Ward 3" fifty times.

import { ITEMS, UNITS } from './data/project-items.js';
import { SCALES, PROJECT_STATUSES } from './data/project-framework.js';
import { buildWorkbook, toCsv, columnLetter, STYLE } from './xlsx.js';

/** Rows of the grid, beyond whatever is pre-filled. */
const LAST_ROW = 600;

/** Beyond this many wards, pre-filling is noise rather than help. */
const PREFILL_LIMIT = 200;

/**
 * The columns, in order. `required` drives both the header colour and what the
 * importer will reject. `help` is what the candidate reads on the first sheet.
 */
export const COLUMNS = [
  {key:'lga',header:'LGA',required:true,width:24,help:'Select the project local government area.'},
  {key:'ward',header:'Ward',required:true,width:24,help:'Select the project ward within the LGA.'},
  {key:'community',header:'Community/Area',required:false,width:24,help:'Community/Area'+' is optional.'},
  {key:'polling_unit',header:'Polling Unit',required:false,width:24,help:'Polling Unit'+' is optional.'},
  {key:'category',header:'Project Category',required:false,width:24,help:'Project Category'+' is optional.'},
  {key:'item',header:'Item',required:true,width:24,help:'Select the deliverable item from the list.'},
  {key:'notes',header:'Description',required:false,width:24,help:'Description'+' is optional.'},
  {key:'quantity',header:'Quantity',required:false,width:24,help:'Quantity'+' is optional.'},
  {key:'unit',header:'Unit',required:false,width:24,help:'Enter the unit used to count the deliverables.'},
  {key:'requested_by',header:'Requested By',required:false,width:24,help:'Requested By'+' is optional.'},
  {key:'contact_person',header:'Contact Person',required:false,width:24,help:'Contact Person'+' is optional.'},
  {key:'contact_phone',header:'Contact Phone',required:false,width:24,help:'Contact Phone'+' is optional.'},
  {key:'beneficiaries',header:'Estimated Beneficiaries',required:false,width:24,help:'Estimated Beneficiaries'+' is optional.'},
  {key:'request_date',header:'Request Date',required:false,width:24,help:'Request Date'+' is optional.'},
  {key:'target_completion_date',header:'Target Completion Date',required:false,width:24,help:'Target Completion Date'+' is optional.'},
];

const col = (key) => columnLetter(COLUMNS.findIndex((c) => c.key === key) + 1);

/* ------------------------------- reference sheet --------------------------- */

// Column positions on the Lists sheet. Gaps are deliberate: they keep each
// list a clean single column, so a validation range never needs editing when
// another list changes length.
const LISTS = {
  item: 'A', itemUnit: 'B', itemSector: 'C',
  unit: 'E', scale: 'F', status: 'G',
  lga: 'I', ward: 'J',
};

function listsSheet(lgas, wards) {
  const columns = {
    [LISTS.item]: ['Item', ...ITEMS.map((i) => i.label)],
    [LISTS.itemUnit]: ['Normally counted in', ...ITEMS.map((i) => i.unit || '')],
    [LISTS.itemSector]: ['Reports under', ...ITEMS.map((i) => i.sector)],
    [LISTS.unit]: ['Units', ...UNITS],
    [LISTS.scale]: ['Scale', ...SCALES.map((s) => s.label)],
    [LISTS.status]: ['Status', ...PROJECT_STATUSES.map((s) => s.label)],
    [LISTS.lga]: ['LGA', ...lgas],
    [LISTS.ward]: ['Ward', ...wards],
  };

  const width = 10;   // A..J
  const height = Math.max(...Object.values(columns).map((v) => v.length));
  const rows = [];
  for (let r = 0; r < height; r++) {
    const row = [];
    for (let c = 1; c <= width; c++) {
      const value = columns[columnLetter(c)]?.[r] ?? '';
      row.push(r === 0 && value ? { v: value, s: STYLE.bold } : value);
    }
    rows.push(row);
  }

  return {
    name: 'Lists',
    freezeRows: 1,
    columns: [{ width: 34 }, { width: 20 }, { width: 34 }, { width: 4 },
      { width: 16 }, { width: 12 }, { width: 12 }, { width: 4 },
      { width: 20 }, { width: 28 }],
    rows,
  };
}

/** `Lists!$A$2:$A$87` for a list of n entries under a header. */
const range = (letter, n) => `Lists!$${letter}$2:$${letter}$${n + 1}`;

/* ------------------------------ instructions ------------------------------- */

function instructionsSheet(who) {
  const rows = [
    [{ v: 'Project list', s: STYLE.bold }],
    [who ? `Prepared for ${who}` : 'Prepared for the campaign'],
    [],
    ['One row for each item, in each place.'],
    [{ v: 'If a ward is getting a borehole and fifty street lights, that is two rows, '
      + 'not one. If eleven wards are each getting the same package, copy the rows '
      + 'down and change the ward -- your wards are already typed in for you.',
      s: STYLE.hint }],
    [],
    [{ v: 'Only the orange columns are required. Everything else can be left blank.',
      s: STYLE.hint }],
    [{ v: 'Do not add, remove or rename columns, and do not delete the "Lists" sheet '
      + '-- the dropdowns read from it.', s: STYLE.hint }],
    [],
    [{ v: 'Column', s: STYLE.bold }, { v: 'Required', s: STYLE.bold },
      { v: 'What to write', s: STYLE.bold }],
    ...COLUMNS.map((c) => [
      { v: c.header, s: STYLE.bold },
      c.required ? 'Yes' : 'Optional',
      c.help,
    ]),
    [],
    [{ v: 'A worked example', s: STYLE.bold }],
    [{ v: 'Illustrative example: one community asking for three things, '
      + 'then the whole ward getting street lights.', s: STYLE.hint }],
    [],
    COLUMNS.map((c) => ({ v: c.header, s: c.required ? STYLE.headerRequired : STYLE.header })),
    ['Asa', 'AFON', 'Afon', '', 'Sewing machine', 2, 'pieces',
      'Small', '', 'Community', 60, 'October', ''],
    ['Asa', 'AFON', 'Afon', '', 'Solar street light', 10, 'pieces',
      'Small', '', 'Community', 400, 'October', ''],
    ['Asa', 'AFON', 'Afon', '', 'Food palliative pack', 50, 'packs',
      'Small', '', 'Community', 50, 'October', ''],
    ['Asa', 'AFON', '', '', 'Solar street light', 50, 'pieces',
      'Medium', '', 'Ward meeting', 2000, 'Oct-Dec', 'Along the main road'],
  ];

  return {
    name: 'How to fill this in',
    columns: [{ width: 24 }, { width: 12 }, { width: 86 },
      ...Array(COLUMNS.length - 3).fill({ width: 18 })],
    rows,
  };
}

/* --------------------------------- the grid -------------------------------- */

function projectsSheet(lgas, wardsByLga) {
  const header = COLUMNS.map((c) => ({
    v: c.header + (c.required ? ' *' : ''),
    s: c.required ? STYLE.headerRequired : STYLE.header,
  }));

  const pairs = [];
  for (const lga of lgas) for (const ward of wardsByLga[lga] || []) pairs.push([lga, ward]);

  const rows = [header];
  if (pairs.length && pairs.length <= PREFILL_LIMIT) {
    for (const [lga, ward] of pairs) {
      rows.push([lga, ward, ...Array(COLUMNS.length - 2).fill('')]);
    }
  }

  const wards = [...new Set(pairs.map((p) => p[1]))];

  return {
    name: 'Projects',
    freezeRows: 1,
    columns: COLUMNS.map((c) => ({ width: c.width })),
    rows,
    validations: [
      { range: `${col('lga')}2:${col('lga')}${LAST_ROW}`, source: range(LISTS.lga, lgas.length),
        error: 'Pick one of your local governments from the dropdown.' },
      { range: `${col('ward')}2:${col('ward')}${LAST_ROW}`, source: range(LISTS.ward, wards.length),
        error: 'Pick one of your wards from the dropdown.' },
      { range: `${col('item')}2:${col('item')}${LAST_ROW}`, source: range(LISTS.item, ITEMS.length),
        title: 'Item',
        prompt: 'Start typing -- sewing machine, borehole, transformer, solar street light, '
          + 'fertiliser, motorcycle. Choose "Something else" only if it really is not listed.',
        error: 'Pick an item from the dropdown, or choose "Something else (describe it)".' },
      { range: `${col('unit')}2:${col('unit')}${LAST_ROW}`, source: range(LISTS.unit, UNITS.length),
        error: 'Pick a unit, or leave it blank.' },
    ],
  };
}

/* ---------------------------------- build ---------------------------------- */

/**
 * The workbook for one candidate.
 *
 * @param {object} opts
 * @param {string[]} opts.lgas        LGAs the candidate may write about
 * @param {Record<string, string[]>} opts.wardsByLga  their wards, per LGA
 * @param {string} [opts.who]         name shown on the instructions sheet
 * @returns {Buffer}
 */
export function buildProjectTemplate({ lgas, wardsByLga, who }) {
  if (!lgas?.length) throw new Error('a template needs at least one LGA');
  return buildWorkbook([
    instructionsSheet(who),
    projectsSheet(lgas, wardsByLga),
    listsSheet(lgas, [...new Set(lgas.flatMap((l) => wardsByLga[l] || []))]),
  ]);
}

/** Headers only, for anyone who would rather work in CSV. */
export function projectTemplateCsv() {
  return toCsv([COLUMNS.map((c) => c.header + (c.required ? ' *' : ''))]);
}

/** A stable filename: candidates end up with several of these. */
export function templateFilename(who, extension = 'xlsx') {
  const safe = String(who || 'kwarax10').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `project-list-${safe || 'kwarax10'}.${extension}`;
}
