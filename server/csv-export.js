export function csvLine(values) {
  return values.map(value => {
    let text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    // Prevent spreadsheet software from interpreting submitted text as formulas.
    if (typeof value === 'string' && /^[\s]*[=+@-]/.test(text)) text = "'" + text;
    return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
  }).join(',') + '\r\n';
}

export async function streamCsv(response, rows, columns, mapRow = row => row) {
  const write = async chunk => {
    if (response.destroyed) return false;
    if (!response.write(chunk)) {
      const drained = await new Promise(resolve => {
        const cleanup = () => { response.off('drain', onDrain); response.off('close', onClose); response.off('error', onClose); };
        const onDrain = () => { cleanup(); resolve(true); };
        const onClose = () => { cleanup(); resolve(false); };
        response.once('drain', onDrain); response.once('close', onClose); response.once('error', onClose);
      });
      if (!drained) return false;
    }
    return true;
  };
  if (!await write('\uFEFF' + csvLine(columns))) return;
  for (let start = 0; start < rows.length; start += 500) {
    const chunk = rows.slice(start, start + 500).map(row => {
      const mapped = mapRow(row);
      return csvLine(columns.map(column => mapped[column]));
    }).join('');
    if (!await write(chunk)) return;
  }
  response.end();
}
