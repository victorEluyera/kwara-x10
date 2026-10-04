// Reading an .xlsx back, for the project-list import.
//
// The companion to xlsx.js, and deliberately a separate file: writing a fixed
// shape is safe, reading whatever someone uploads is not. Everything here
// treats the file as hostile -- the archive is bounded before it is inflated,
// and nothing is resolved by path.
//
// The awkward part is that we do not get our own file back. A candidate opens
// the template in Excel, types, and saves; Excel rewrites the whole workbook
// on the way out, moving every inline string we wrote into a shared-strings
// table, renumbering the sheets, and sometimes adding a data descriptor to the
// zip entries. So this reads the generic shape, not ours: shared strings,
// inline strings, formula results and numbers, sheets looked up by name.

import zlib from 'node:zlib';

/** Bounds on an uploaded archive. A project list is a few hundred rows. */
const LIMITS = {
  entries: 200,
  entryBytes: 64 * 1024 * 1024,
  totalBytes: 128 * 1024 * 1024,
};

/* ----------------------------------- zip ----------------------------------- */

/**
 * Read a zip by its central directory rather than by walking local headers:
 * Excel sets the streaming flag on its entries, which puts the real sizes in a
 * trailing descriptor and leaves zeroes in the local header.
 */
export function unzip(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) {
    throw new Error('That file is empty or truncated');
  }

  // The end-of-central-directory record is last, after an optional comment.
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 66000); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('That is not a spreadsheet — it is not a zip archive');

  const count = buffer.readUInt16LE(eocd + 10);
  if (count > LIMITS.entries) throw new Error('That spreadsheet has too many parts');

  const files = {};
  let total = 0;
  let at = buffer.readUInt32LE(eocd + 16);

  for (let n = 0; n < count; n++) {
    if (at + 46 > buffer.length || buffer.readUInt32LE(at) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(at + 10);
    const compressed = buffer.readUInt32LE(at + 20);
    const uncompressed = buffer.readUInt32LE(at + 24);
    const nameLen = buffer.readUInt16LE(at + 28);
    const extraLen = buffer.readUInt16LE(at + 30);
    const commentLen = buffer.readUInt16LE(at + 32);
    const localAt = buffer.readUInt32LE(at + 42);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLen);
    at += 46 + nameLen + extraLen + commentLen;

    // A zip may claim anything about its own contents; check before inflating.
    if (uncompressed > LIMITS.entryBytes) throw new Error('A part of that spreadsheet is too large');
    total += uncompressed;
    if (total > LIMITS.totalBytes) throw new Error('That spreadsheet is too large to read');

    // Only the parts we actually use, so a crafted archive cannot make us
    // inflate a hundred megabytes of something irrelevant.
    if (!/^xl\/(workbook\.xml|sharedStrings\.xml|_rels\/workbook\.xml\.rels|worksheets\/)/.test(name)) {
      continue;
    }
    if (localAt + 30 > buffer.length || buffer.readUInt32LE(localAt) !== 0x04034b50) continue;

    const start = localAt + 30 + buffer.readUInt16LE(localAt + 26) + buffer.readUInt16LE(localAt + 28);
    const body = buffer.subarray(start, start + compressed);
    try {
      files[name] = method === 8 ? zlib.inflateRawSync(body) : Buffer.from(body);
    } catch {
      throw new Error('That spreadsheet is damaged and cannot be read');
    }
  }

  return files;
}

/* ----------------------------------- xml ----------------------------------- */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export const decode = (s) => String(s ?? '').replace(
  /&(?:(amp|lt|gt|quot|apos)|#(\d+)|#x([0-9a-fA-F]+));/g,
  (_, name, dec, hex) => (name ? ENTITIES[name]
    : String.fromCodePoint(dec ? Number(dec) : parseInt(hex, 16))));

/** "BC12" -> 55. */
export function columnIndex(ref) {
  const letters = /^([A-Z]+)/.exec(String(ref).toUpperCase())?.[1];
  if (!letters) return 0;
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** Every <t> under one element, joined — a styled cell is split into runs. */
const textOf = (xml) => [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
  .map((m) => decode(m[1])).join('');

const localTags = xml => xml?.replace(/(<\/?)[A-Za-z_][\w.-]*:/g, '$1');
function sharedStrings(files) {
  const xml = localTags(files['xl/sharedStrings.xml']?.toString('utf8'));
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g)]
    .map((m) => (m[1] ? textOf(m[1]) : ''));
}

/**
 * Rows of one worksheet, as strings, indexed by column position. Gaps are
 * filled, because Excel omits cells that were never touched and the importer
 * needs "column 3" to mean column 3.
 */
function rowsOf(xml, strings) {
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const declared = Number(/\br="(\d+)"/.exec(rowMatch[1])?.[1] || 0);
    const cells = [];
    let widest = 0;

    // Self-closing cells are matched first and separately: a single pattern
    // with a greedy attribute run walks past the "/" of <c r="C2"/> and then
    // swallows everything up to the next </c>, a cell or two later.
    for (const m of rowMatch[2].matchAll(
      /<c\b([^>]*?)\/>|<c\b([^>]*?)>([\s\S]*?)<\/c>/g)) {
      const attrs = m[1] ?? m[2];
      const inner = m[3] ?? '';
      const index = columnIndex(/\br="([A-Z]+\d+)"/.exec(attrs)?.[1] || '') || cells.length + 1;
      const type = /\bt="([a-zA-Z]+)"/.exec(attrs)?.[1] || 'n';

      let value = '';
      if (type === 's') {
        value = strings[Number(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? -1)] ?? '';
      } else if (type === 'inlineStr') {
        value = textOf(inner);
      } else if (type === 'b') {
        value = /<v>1<\/v>/.test(inner) ? 'TRUE' : 'FALSE';
      } else {
        // "str" is a formula's cached text; "n" and everything else is a value.
        value = decode(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '');
      }

      cells[index - 1] = value.trim();
      if (index > widest) widest = index;
    }

    for (let i = 0; i < widest; i++) if (cells[i] === undefined) cells[i] = '';
    // Honour r="" so a deleted row does not shift everything below it up.
    if (declared) rows[declared - 1] = cells;
    else rows.push(cells);
  }

  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

/**
 * Open a workbook.
 *
 * @returns {{ sheetNames: string[], rows(name?: string): string[][] }}
 */
export function readWorkbook(buffer) {
  const files = unzip(buffer);
  const workbook = localTags(files['xl/workbook.xml']?.toString('utf8'));
  if (!workbook) throw new Error('That file is not an Excel workbook');

  const rels = new Map(
    [...(localTags(files['xl/_rels/workbook.xml.rels']?.toString('utf8')) || '')
      .matchAll(/<Relationship\b([^>]*)\/>/g)]
      .map((m) => [/\bId="([^"]+)"/.exec(m[1])?.[1], decode(/\bTarget="([^"]+)"/.exec(m[1])?.[1] || '')])
      .filter(([id]) => id));

  const sheets = [...workbook.matchAll(/<sheet\b([^>]*)\/>/g)].map((m, i) => {
    const target = rels.get(/\br:id="([^"]+)"/.exec(m[1])?.[1]);
    // Targets are relative to xl/ and may be written "/xl/worksheets/sheet1.xml".
    const path = target
      ? 'xl/' + String(target).replace(/^\/?(xl\/)?/, '')
      : `xl/worksheets/sheet${i + 1}.xml`;
    return { name: decode(/\bname="([^"]*)"/.exec(m[1])?.[1] || `Sheet${i + 1}`), path };
  });
  if (!sheets.length) throw new Error('That workbook has no sheets');

  const strings = sharedStrings(files);

  return {
    sheetNames: sheets.map((s) => s.name),
    rows(name) {
      const sheet = name
        ? sheets.find((s) => s.name.toLowerCase() === String(name).toLowerCase())
        : sheets[0];
      if (!sheet) return null;
      const xml = files[sheet.path]?.toString('utf8');
      if (!xml) return null;
      return rowsOf(localTags(xml), strings);
    },
  };
}

/* ----------------------------------- csv ----------------------------------- */

/** RFC 4180, plus a tolerance for lone CR or LF line endings. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  const src = String(text).replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { row.push(field.trim()); field = ''; continue; }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += ch;
  }
  if (field || row.length) { row.push(field.trim()); rows.push(row); }
  return rows;
}
