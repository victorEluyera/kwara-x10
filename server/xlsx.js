// A small .xlsx writer: enough to hand someone a spreadsheet with headers,
// frozen panes, column widths and dropdown validation.
//
// Why by hand rather than a library: the only thing we need to produce is a
// blank form, an .xlsx is a zip of half a dozen XML files, and Node already
// ships the deflate. Adding a dependency that reads arbitrary spreadsheets --
// and parses untrusted uploads -- to write one fixed shape was the larger risk.
//
// Dropdowns are the point of the exercise. Free text gives us "solar light",
// "Solar Str Light" and "SOLAR" for one item, and thirty spellings of Ikereku;
// a validated list gives us something we can import without guessing.

import zlib from 'node:zlib';

/* ---------------------------------- zip ------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/**
 * Build a zip from [{ name, data }]. Everything is deflated and stored with a
 * fixed timestamp, so the same input always produces byte-identical output --
 * which is what lets a test compare two templates.
 */
export function zip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const body = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    const deflated = zlib.deflateRawSync(body, { level: 9 });
    const nameBuf = Buffer.from(name, 'utf8');
    const sum = crc32(body);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);            // version needed
    local.writeUInt16LE(0, 6);             // flags
    local.writeUInt16LE(8, 8);             // deflate
    local.writeUInt16LE(0, 10);            // time
    local.writeUInt16LE(0x0021, 12);       // date: 1980-01-01
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);
    locals.push(local, deflated);

    const dir = Buffer.alloc(46 + nameBuf.length);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);              // version made by
    dir.writeUInt16LE(20, 6);              // version needed
    dir.writeUInt16LE(0, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(0, 12);
    dir.writeUInt16LE(0x0021, 14);
    dir.writeUInt32LE(sum, 16);
    dir.writeUInt32LE(deflated.length, 20);
    dir.writeUInt32LE(body.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt16LE(0, 30);              // extra
    dir.writeUInt16LE(0, 32);              // comment
    dir.writeUInt16LE(0, 34);              // disk
    dir.writeUInt16LE(0, 36);              // internal attrs
    dir.writeUInt32LE(0, 38);              // external attrs
    dir.writeUInt32LE(offset, 42);
    nameBuf.copy(dir, 46);
    central.push(dir);

    offset += local.length + deflated.length;
  }

  const dirBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dirBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, dirBuf, end]);
}

/* --------------------------------- sheets ---------------------------------- */

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
  // Excel rejects most control characters outright.
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

/** 1 -> A, 27 -> AA. */
export function columnLetter(n) {
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

// Style ids, matching the cellXfs order in STYLES below.
export const STYLE = { plain: 0, header: 1, headerRequired: 2, hint: 3, bold: 4 };

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4">
<font><sz val="11"/><color theme="1"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><i/><sz val="10"/><color rgb="FF6B7280"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color theme="1"/><name val="Calibri"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF14532D"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF9A3412"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/**
 * A cell is a bare value, or { v, s } to pick a style. Numbers are written as
 * numbers so Excel will sum a quantity column; everything else goes in as an
 * inline string, which avoids maintaining a shared-strings table.
 */
function cellXml(ref, cell) {
  const value = cell && typeof cell === 'object' && !Array.isArray(cell) ? cell.v : cell;
  const style = cell && typeof cell === 'object' && !Array.isArray(cell) ? cell.s : undefined;
  const s = style ? ` s="${style}"` : '';

  if (value === null || value === undefined || value === '') return `<c r="${ref}"${s}/>`;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${ref}"${s}><v>${value}</v></c>`;
  }
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}

function sheetXml({ rows = [], columns = [], freezeRows = 0, validations = [] }) {
  const cols = columns.length
    ? '<cols>' + columns.map((c, i) =>
      `<col min="${i + 1}" max="${i + 1}" width="${c.width || 18}" customWidth="1"/>`).join('') + '</cols>'
    : '';

  const body = rows.map((row, r) =>
    `<row r="${r + 1}">`
    + row.map((cell, c) => cellXml(columnLetter(c + 1) + (r + 1), cell)).join('')
    + '</row>').join('');

  const pane = freezeRows
    ? `<pane ySplit="${freezeRows}" topLeftCell="A${freezeRows + 1}" activePane="bottomLeft" state="frozen"/>`
    : '';

  // Order matters to the schema: dataValidations come after sheetData.
  const dv = validations.length
    ? `<dataValidations count="${validations.length}">` + validations.map((v) =>
      `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1"`
      + ` errorStyle="stop" sqref="${v.range}"`
      + (v.title ? ` promptTitle="${esc(v.title)}"` : '')
      + (v.prompt ? ` prompt="${esc(v.prompt)}"` : '')
      + ` errorTitle="Not on the list"`
      + ` error="${esc(v.error || 'Pick one of the options in the dropdown.')}">`
      + `<formula1>${esc(v.source)}</formula1></dataValidation>`).join('') + '</dataValidations>'
    : '';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>`
    + `<sheetFormatPr defaultRowHeight="15"/>${cols}`
    + `<sheetData>${body}</sheetData>${dv}</worksheet>`;
}

/**
 * Build a workbook.
 *
 * @param {Array<{name: string, rows: any[][], columns?: {width: number}[],
 *                freezeRows?: number,
 *                validations?: {range: string, source: string, title?: string,
 *                               prompt?: string, error?: string}[]}>} sheets
 * @returns {Buffer} the .xlsx
 */
export function buildWorkbook(sheets) {
  if (!sheets.length) throw new Error('a workbook needs at least one sheet');

  const files = [
    { name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`
        + sheets.map((_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
        + '</Types>' },

    { name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>` },

    { name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>`
        + sheets.map((s, i) =>
          `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
        + '</sheets></workbook>' },

    { name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
        + sheets.map((_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
        + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
        + '</Relationships>' },

    { name: 'xl/styles.xml', data: STYLES },

    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ];

  return zip(files);
}

/** The same rows as CSV, for anyone who would rather not open Excel. */
export function toCsv(rows) {
  return rows.map((row) => row.map((cell) => {
    const v = cell && typeof cell === 'object' && !Array.isArray(cell) ? cell.v : cell;
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
}
