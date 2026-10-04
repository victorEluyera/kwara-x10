// Reading a filled-in project list back.
//
// Everything here is pure: rows in, a verdict out. Nothing touches the
// database, which is what makes it possible to test against the awkward
// spreadsheets people actually send -- reordered columns, a stray empty row
// between wards, "50 pieces" typed into the quantity box, a ward from the
// neighbouring constituency.
//
// The guiding rule is that one bad row must not cost a candidate the other
// eighty-nine. So every row is judged on its own and reported by its
// spreadsheet line number, and the caller decides whether to commit the good
// ones or hold the whole file back.

import { COLUMNS } from './project-template.js';
import { findItem, ITEMS_BY_ID, UNITS } from './data/project-items.js';
import { SCALES, SCALE_IDS, PROJECT_STATUSES, STATUS_IDS, SECTORS } from './data/project-framework.js';
import { findCommunity } from './data/communities.js';
import { readWorkbook, parseCsv } from './xlsx-read.js';

/** The sheet we expect, and the names a re-saved copy might carry instead. */
export const SHEET_NAME = 'Projects';

const MAX_ROWS = 2000;
const MAX_QUANTITY = 100000;

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const key = (v) => clean(v).toLowerCase().replace(/\s*\*\s*$/, '').replace(/[^a-z0-9]/g, '');

/**
 * What makes two rows the same promise: the same thing, in the same place.
 *
 * Re-uploading a sheet is the normal way these arrive -- a candidate adds a
 * ward, saves, and sends the whole file again -- so without this every upload
 * would double the register. Community and polling unit are part of the key
 * because "fifty street lights in Ikereku" and "fifty street lights in
 * Yejuade" are two different promises.
 */
export const projectKey = (p) => [
  p.item_id, p.lga, p.ward, p.community || '', p.polling_unit || '',
].map((v) => clean(v).toLowerCase().replace(/[^a-z0-9]/g, '')).join('|');

/* -------------------------------- the header ------------------------------- */

/**
 * Work out which spreadsheet column is which of ours.
 *
 * Matched on the header text, not position, so a candidate who inserts a
 * column of their own in the middle -- which they will -- does not silently
 * shift every value one to the left.
 */
export function mapHeader(headerRow) {
  const seen = new Map();
  (headerRow || []).forEach((cell, index) => {
    const k = key(cell);
    if (k && !seen.has(k)) seen.set(k, index);
  });

  const originalKeys=[...seen.keys()];
  const aliases={quantity:['How many'],unit:['Counted in'],beneficiaries:['People who benefit'],notes:['Notes'],category:['Sector'],timeline:['When'],scale:['Scale'],status:['Status']};
  for(const [name,labels] of Object.entries(aliases)) for(const label of labels) if(seen.has(key(label))&&!seen.has(key(name)))seen.set(key(name),seen.get(key(label)));
  const index = {};
  const missing = [];
  for (const column of COLUMNS) {
    const at = seen.get(key(column.header)) ?? seen.get(key(column.key));
    if (at === undefined) {
      if (column.required) missing.push(column.header);
    } else index[column.key] = at;
  }

  for(const k of ['timeline','scale','status']) if(seen.has(key(k)))index[k]=seen.get(key(k));
  const known = new Set([...COLUMNS.flatMap(c=>[key(c.header),key(c.key)]),...Object.values(aliases).flat().map(key),key('scale'),key('status'),key('timeline')]);
  const extra = originalKeys.filter((k) => !known.has(k)).length;

  return { index, missing, extra };
}

/* --------------------------------- one row --------------------------------- */

const byLabel = (list, value) => list.find((entry) =>
  entry.label.toLowerCase() === clean(value).toLowerCase()
  || entry.id.toLowerCase() === clean(value).toLowerCase());

/**
 * A quantity as typed. People write "50", "50 pieces", "1,220" and "about 10",
 * and rejecting the lot would be pedantic -- but "about 10" has to be a number
 * before it becomes a promise, so anything with no digits at all is an error.
 */
function readQuantity(raw) {
  const text = clean(raw);
  if (!text) return { value: null };
  const digits = text.replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  if (!digits) return { error: `"${text}" is not a number` };
  const value = Math.round(Number(digits[0]));
  if (value < 1) return { error: 'A quantity has to be at least 1' };
  if (value > MAX_QUANTITY) return { error: `${value} is too large to be a real quantity` };
  return { value };
}

/**
 * Judge one row.
 *
 * @param {string[]} cells
 * @param {object} ctx  { index, lgas, wardsByLga }
 * @returns {{ blank: boolean, errors: string[], warnings: string[], project?: object }}
 */
export function readRow(cells, ctx) {
  const at = (k) => clean(cells[ctx.index[k]]);
  const errors = [];
  const warnings = [];

  // LGA and ward alone are not a row: the template arrives with the
  // candidate's wards already typed down the sheet, and every ward they did
  // not get to is exactly that and nothing more. Complaining "item is missing"
  // about all of them would bury the rows they did fill in.
  const filled = COLUMNS.some((c) =>
    c.key !== 'lga' && c.key !== 'ward' && ctx.index[c.key] !== undefined && at(c.key));
  if (!filled) return { blank: true, errors, warnings };

  /* where ------------------------------------------------------------------ */
  const lga = at('lga');
  const ward = at('ward');
  if (!lga) errors.push('LGA is missing');
  else if (!ctx.lgas.includes(lga)) errors.push(`"${lga}" is not one of your local governments`);

  if (!ward) errors.push('Ward is missing');
  else if (lga && ctx.lgas.includes(lga) && !(ctx.wardsByLga[lga] || []).includes(ward)) {
    errors.push(`"${ward}" is not a ward of ${lga}, or is outside your constituency`);
  }

  /* what ------------------------------------------------------------------- */
  const itemText = at('item');
  const item = itemText ? findItem(itemText) : null;
  if (!itemText) errors.push('Item is missing');
  else if (!item) {
    errors.push(`"${itemText}" is not on the item list — pick from the dropdown, `
      + 'or choose "Something else (describe it)" and say what it is in Notes');
  }

  const notes = at('notes');
  const category = at('category');
  if (category && !SECTORS.includes(category)) errors.push('Choose a recognised Project Category from the project form.');
  if (item?.id === 'other' && !notes) {
    errors.push('You chose "Something else" — say what it is in the Notes column');
  }

  /* how many --------------------------------------------------------------- */
  const quantity = readQuantity(at('quantity'));
  if (quantity.error) errors.push('How many: ' + quantity.error);

  let unit = at('unit');
  if (unit && !UNITS.includes(unit.toLowerCase())) {
    warnings.push(`"${unit}" is not a unit we know — using ${item?.unit || 'none'} instead`);
    unit = '';
  }

  /* how it is classified ---------------------------------------------------- */
  const scaleText = at('scale');
  const scale = scaleText ? byLabel(SCALES, scaleText) : null;
  if (scaleText && !scale) errors.push(`"${scaleText}" is not a scale — use Small, Medium or Large`);

  const statusText = at('status');
  const status = statusText ? byLabel(PROJECT_STATUSES, statusText) : null;
  if (statusText && !status) {
    errors.push(`"${statusText}" is not a status — leave it blank, or use `
      + PROJECT_STATUSES.map((s) => s.label).join(', '));
  }

  const beneficiaries = readQuantity(at('beneficiaries'));
  if (beneficiaries.error) warnings.push('People who benefit: ' + beneficiaries.error);

  /* where exactly ----------------------------------------------------------- */
  const communityText = at('community');
  let community = null;
  if (communityText && lga) {
    community = findCommunity(lga, communityText);
    if (!community) {
      warnings.push(`"${communityText}" is not in the GRID3 list for ${lga} — `
        + 'kept as typed, but it will not appear on the map');
    }
  }

  // The same item, in the same place, twice in one sheet. Usually a row copied
  // down and half-edited -- the ward changed but not the community, or the
  // other way round.
  //
  // Only askable once the item is known, and only worth asking of a row that
  // is otherwise sound: a row already being rejected for an unreadable item
  // does not need a second complaint, and has no key to be compared by.
  const mine = item && !errors.length ? projectKey({
    item_id: item.id, lga, ward, community: communityText, polling_unit: at('polling_unit'),
  }) : null;
  if (mine) {
    const earlier = ctx.seen?.get(mine);
    if (earlier !== undefined) {
      errors.push('The same item in the same place is already on row ' + earlier
        + ' of this file — change the community, or put the whole number on one row');
    }
  }

  if (errors.length) return { blank: false, errors, warnings };
  ctx.seen?.set(mine, ctx.line);

  // Scale, when unstated: a named community or polling unit is a street or a
  // village, and a bare ward is a ward. That is the framework's own wording,
  // and it is a better guess than defaulting everything to small.
  const inferredScale = communityText || at('polling_unit') ? 'small' : 'medium';

  return {
    blank: false,
    errors,
    warnings,
    project: {
      lga,
      ward,
      community: communityText || null,
      community_lat: community?.lat ?? null,
      community_lng: community?.lng ?? null,
      polling_unit: at('polling_unit') || null,
      item_id: item.id,
      project_name: item.label,
      sector: category || item.sector,
      scale: scale ? scale.id : inferredScale,
      quantity: quantity.value ?? 1,
      unit: unit || item.unit || null,
      status: status ? status.id : 'promised',
      requested_by: at('requested_by') || null,
      contact_person:at('contact_person') || null,contact_phone:at('contact_phone') || null,request_date:at('request_date') || null,target_completion_date:at('target_completion_date') || null,
      beneficiaries: beneficiaries.value ?? null,
      timeline: at('timeline') || null,
      need: notes || null,
      title: title(item, communityText, ward),
    },
  };
}

/** What the project is called in a list: the item, and where it is going. */
function title(item, community, ward) {
  const where = community || ward;
  const name = item.id === 'other' ? 'Project' : item.label;
  return `${name} — ${where}`.slice(0, 200);
}

/* ------------------------------- a whole file ------------------------------ */

/** Pull the grid out of an upload, whatever shape it arrived in. */
export function readUpload(buffer, filename = '') {
  if (/\.csv$/i.test(filename)) return { rows: parseCsv(buffer.toString('utf8')), sheet: null };

  const workbook = readWorkbook(buffer);
  const rows = workbook.rows(SHEET_NAME);
  if (rows) return { rows, sheet: SHEET_NAME };

  // A candidate may have exported just the one sheet, or renamed it.
  const only = workbook.rows();
  if (!only) throw new Error('That workbook has no readable sheet');
  return { rows: only, sheet: workbook.sheetNames[0] };
}

/**
 * Validate a whole grid.
 *
 * @param {string[][]} rows   including the header
 * @param {object} scope      { lgas, wardsByLga }
 * @returns {{ ok: boolean, error?: string, sheet?: string, rows: object[],
 *             summary: object }}
 */
export function validateGrid(rows, { lgas, wardsByLga }) {
  const empty = { rows: [], summary: { read: 0, valid: 0, invalid: 0, blank: 0, warnings: 0 } };

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

  const out = [];
  const ctx = { index, lgas, wardsByLga, seen: new Map(), line: 0 };

  for (let i = 1; i < rows.length; i++) {
    ctx.line = i + 1;
    const verdict = readRow(rows[i] || [], ctx);
    if (verdict.blank) continue;

    out.push({
      line: i + 1,                       // what the candidate sees in Excel
      errors: verdict.errors,
      warnings: verdict.warnings,
      duplicate: false,
      project: verdict.project ?? null,
    });
  }

  const summary = { extra_columns: extra, blank: rows.length - 1 - out.length, ...tally(out) };
  if (!summary.read) {
    return { ok: false, error: 'There are no filled-in rows in that file', rows: out, summary };
  }

  return { ok: summary.invalid === 0, rows: out, summary };
}

/** Re-count the summary from the rows, after anything that changes them. */
function tally(rows) {
  return {
    read: rows.length,
    valid: rows.filter((r) => !r.errors.length).length,
    invalid: rows.filter((r) => r.errors.length).length,
    warnings: rows.filter((r) => r.warnings.length).length,
    duplicates: rows.filter((r) => r.duplicate).length,
  };
}

/**
 * Mark rows already on the candidate's register.
 *
 * An error rather than a warning, for the same reason as the nominee list: the
 * point is that the same promise is not counted twice, so the row has to drop
 * out of the total and out of the save. If it really is a second batch -- more
 * street lights for a ward that already has some -- the answer is to edit the
 * quantity on the one that exists, which the message says.
 *
 * @param {object} result    what validateGrid returned
 * @param {Map} existing     projectKey -> the project already saved
 */
export function applyRegisterDuplicates(result, existing) {
  for (const row of result.rows) {
    if (!row.project || row.errors.length) continue;
    const match = existing.get(projectKey(row.project));
    if (!match) continue;

    row.duplicate = true;
    row.errors.push('Already on your list as "' + match.title + '"'
      + (match.quantity ? ' (' + match.quantity + ')' : '')
      + ' — not added again. To add more, change the quantity on the one you have.');
  }

  result.summary = { ...result.summary, ...tally(result.rows) };
  result.ok = result.summary.invalid === 0;
  return result;
}

/** Everything in one step, for the route. */
export function readProjectUpload(buffer, filename, scope) {
  const { rows, sheet } = readUpload(buffer, filename);
  return { sheet, ...validateGrid(rows, scope) };
}

export { SCALE_IDS, STATUS_IDS, ITEMS_BY_ID };
