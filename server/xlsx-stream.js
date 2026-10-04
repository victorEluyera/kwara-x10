// Reading a spreadsheet too big to hold in memory.
//
// xlsx-read.js inflates the whole archive, which is right for a candidate's
// project list and wrong for the INEC register: 235 MB of zip that expands to
// 2.4 GB of XML across four sheets, because Excel caps a sheet at 1,048,576
// rows and the state has 3.27 million voters.
//
// So this one never holds more than a chunk. It reads the zip's central
// directory (a few kilobytes at the end of the file), seeks to the one entry
// it wants, and pipes that byte range through inflate, emitting rows as they
// come past. Nothing is buffered except the tail of the current chunk, which
// is whatever is left of a half-finished <row>.
//
// It assumes inline strings rather than a shared-strings table. That is what
// the register uses, and it is the only form that can be streamed at all --
// a shared-strings workbook needs the whole lookup table before the first
// cell can be read.

import fs from 'node:fs';
import zlib from 'node:zlib';
import { decode, columnIndex } from './xlsx-read.js';

/* ----------------------------------- zip ----------------------------------- */

/** Read `length` bytes at `position` without loading the file. */
async function readAt(handle, position, length) {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
}

/**
 * The archive's table of contents: every entry, with where its bytes live.
 * Read from the end of the file, so the size of the archive does not matter.
 */
export async function readDirectory(path) {
  const handle = await fs.promises.open(path, 'r');
  try {
    const { size } = await handle.stat();
    if (size < 22) throw new Error('That file is too small to be a spreadsheet');

    // The end-of-central-directory record is last, after an optional comment.
    const tailLength = Math.min(size, 66000);
    const tail = await readAt(handle, size - tailLength, tailLength);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('That is not a spreadsheet — it is not a zip archive');

    const count = tail.readUInt16LE(eocd + 10);
    const directory = await readAt(handle, tail.readUInt32LE(eocd + 16), tail.readUInt32LE(eocd + 12));

    const entries = [];
    let at = 0;
    for (let i = 0; i < count && at + 46 <= directory.length; i++) {
      if (directory.readUInt32LE(at) !== 0x02014b50) break;
      const nameLength = directory.readUInt16LE(at + 28);
      entries.push({
        name: directory.toString('utf8', at + 46, at + 46 + nameLength),
        method: directory.readUInt16LE(at + 10),
        compressedSize: directory.readUInt32LE(at + 20),
        size: directory.readUInt32LE(at + 24),
        localOffset: directory.readUInt32LE(at + 42),
      });
      at += 46 + nameLength + directory.readUInt16LE(at + 30) + directory.readUInt16LE(at + 32);
    }
    return entries;
  } finally {
    await handle.close();
  }
}

/** A readable stream of one entry's decompressed bytes. */
async function openEntry(path, entry) {
  const handle = await fs.promises.open(path, 'r');
  let start;
  try {
    // The local header repeats the name and may carry different extra data, so
    // the payload's offset has to be read from it rather than assumed.
    const local = await readAt(handle, entry.localOffset, 30);
    if (local.readUInt32LE(0) !== 0x04034b50) throw new Error('Damaged archive entry: ' + entry.name);
    start = entry.localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
  } finally {
    await handle.close();
  }

  const raw = fs.createReadStream(path, { start, end: start + entry.compressedSize - 1 });
  return entry.method === 8 ? raw.pipe(zlib.createInflateRaw()) : raw;
}

/* ---------------------------------- sheets --------------------------------- */

/** Small parts (workbook.xml and its rels) read whole. */
async function readSmall(path, entry) {
  const chunks = [];
  for await (const chunk of await openEntry(path, entry)) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * The sheets in a workbook, in order, with the archive entry each one lives in.
 * @returns {Promise<Array<{name: string, entry: object}>>}
 */
export async function listSheets(path) {
  const entries = await readDirectory(path);
  const byName = new Map(entries.map((e) => [e.name, e]));

  const workbook = byName.get('xl/workbook.xml');
  if (!workbook) throw new Error('That file is not an Excel workbook');
  const workbookXml = await readSmall(path, workbook);

  const relsEntry = byName.get('xl/_rels/workbook.xml.rels');
  const rels = new Map(relsEntry
    ? [...(await readSmall(path, relsEntry)).matchAll(/<Relationship\b([^>]*)\/>/g)]
      .map((m) => [/\bId="([^"]+)"/.exec(m[1])?.[1],
        decode(/\bTarget="([^"]+)"/.exec(m[1])?.[1] || '')])
      .filter(([id]) => id)
    : []);

  return [...workbookXml.matchAll(/<sheet\b([^>]*)\/>/g)].map((m, i) => {
    const target = rels.get(/\br:id="([^"]+)"/.exec(m[1])?.[1]);
    const file = target
      ? 'xl/' + String(target).replace(/^\/?(xl\/)?/, '')
      : `xl/worksheets/sheet${i + 1}.xml`;
    return {
      name: decode(/\bname="([^"]*)"/.exec(m[1])?.[1] || `Sheet${i + 1}`),
      entry: byName.get(file),
    };
  }).filter((s) => s.entry);
}

/** The cells of one <row>, by column position, as strings. */
export function parseRow(xml) {
  const cells = [];
  // Self-closing cells matched first and separately: a greedy attribute run
  // walks past the "/" of <c r="L3" t="inlineStr"/> and then swallows
  // everything to the next </c>, which is a cell or two into the next row.
  for (const m of xml.matchAll(/<c\b([^>]*?)\/>|<c\b([^>]*?)>([\s\S]*?)<\/c>/g)) {
    const attrs = m[1] ?? m[2];
    const inner = m[3] ?? '';
    const at = columnIndex(/\br="([A-Z]+\d+)"/.exec(attrs)?.[1] || '') || cells.length + 1;
    const text = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decode(t[1])).join('')
      || decode(/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '');
    cells[at - 1] = text.trim();
  }
  for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
  return cells;
}

/**
 * Walk one sheet's rows without loading it.
 *
 * @param {string} path              the .xlsx
 * @param {object} sheet             from listSheets()
 * @param {(cells: string[], rowNumber: number) => void|Promise<void>} onRow
 * @returns {Promise<number>} rows seen
 */
export async function eachRow(path, sheet, onRow) {
  const stream = await openEntry(path, sheet.entry);
  let carry = '';
  let seen = 0;

  for await (const chunk of stream) {
    carry += chunk.toString('utf8');
    let cut = 0;
    for (;;) {
      const end = carry.indexOf('</row>', cut);
      if (end < 0) break;
      const start = carry.lastIndexOf('<row', cut === 0 ? 0 : cut - 1);
      const xml = carry.slice(start < 0 ? cut : start, end);
      cut = end + 6;
      seen++;
      await onRow(parseRow(xml), seen);
    }
    // Keep only the unfinished tail, so memory does not grow with the file.
    carry = carry.slice(cut);
  }
  return seen;
}
