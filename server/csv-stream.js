import fs from 'node:fs';

// RFC 4180 records, including quoted newlines and quotes split between chunks.
export async function eachCsvRow(file, visit) {
  let row = [], field = '', quoted = false, quotePending = false, skipLF = false, first = true, number = 0;
  for await (let chunk of fs.createReadStream(file, { encoding: 'utf8' })) {
    if (first) { chunk = chunk.replace(/^\uFEFF/, ''); first = false; }
    for (const ch of chunk) {
      if (skipLF) { skipLF = false; if (ch === '\n') continue; }
      if (quotePending) {
        quotePending = false;
        if (ch === '"') { field += ch; continue; }
        quoted = false;
      }
      if (quoted) {
        if (ch === '"') quotePending = true;
        else field += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { row.push(field.trim()); field = ''; }
      else if (ch === '\r' || ch === '\n') {
        row.push(field.trim()); field = '';
        await visit(row, ++number); row = []; skipLF = ch === '\r';
      } else field += ch;
    }
  }
  if (quoted && !quotePending) throw new Error('Unclosed quoted CSV field');
  if (field || row.length) { row.push(field.trim()); await visit(row, ++number); }
}
