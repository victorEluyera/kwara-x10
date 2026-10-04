import React, { useRef, useState } from 'react';
import { api, num } from '../lib/api.js';
import { Card, Alert, Field } from './ui.jsx';

/**
 * Load the INEC voter register from the browser.
 *
 * The register is 3.26 million rows in a 484 MB CSV. It cannot be posted in
 * one request, and whoever is loading it may have no way to reach the database
 * directly -- the cluster's firewall lists a few addresses and the hosting
 * account belongs to somebody else. So the file never leaves this page whole:
 * it is read in eight-megabyte slices, split into rows here, and sent up a few
 * thousand at a time.
 *
 * Only five fields are sent. The register also carries date of birth, phone
 * number, home address, occupation and disability status for every voter in
 * the state; none of that answers "is this VIN real and is this person in the
 * unit they claim", so none of it is uploaded. The rest is dropped in this
 * loop and never crosses the network.
 */

const SLICE = 16 * 1024 * 1024;  // how much of the file to read at once
// Rows per request. The endpoint caps at 5,000; at 2,000 the whole register
// took 1,630 round trips, and the time was almost all latency rather than
// work. Fewer, fatter requests is the only lever that matters here.
const CHUNK = 5000;

/** One CSV line: quoted fields, doubled quotes, commas inside quotes. */
function splitLine(line) {
  const out = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') { if (line[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(field); field = ''; }
    else field += c;
  }
  out.push(field);
  return out;
}

const key = (s) => String(s || '').trim().toLowerCase();

/** Which column is which, by heading rather than position. */
export function mapHeader(cells) {
  const seen = new Map();
  cells.forEach((c, i) => { if (key(c) && !seen.has(key(c))) seen.set(key(c), i); });
  const find = (...names) => names.map((nm) => seen.get(nm)).find((v) => v !== undefined);
  return {
    vin: find('voter id number', 'voter id', 'vin'),
    name: find('name', 'full name'),
    polling_unit: find('polling unit', 'pollingunit', 'pu'),
    ward: find('ward'),
    lga: find('lga', 'local government'),
  };
}

export default function VoterRollLoader({ loaded = 0, onLoaded }) {
  const [file, setFile] = useState(null);
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);
  const [progress, setProgress] = useState(null);
  const cancelled = useRef(false);

  const run = async () => {
    setBusy(true); setError(''); setDone(null);
    cancelled.current = false;
    const batch = file.name.slice(0, 80) + ' ' + new Date().toISOString().slice(0, 10);
    const started = Date.now();
    let sent = 0;
    let skipped = 0;
    let index = null;
    let carry = '';
    let pending = [];

    const flush = async () => {
      if (!pending.length) return;
      const rows = pending;
      pending = [];
      const result = await api.post('/admin/voter-roll/chunk', { batch, rows });
      sent += result.loaded;
      skipped += result.skipped;
      const seconds = (Date.now() - started) / 1000;
      setProgress({ sent, skipped, total: result.total,
        rate: Math.round(sent / Math.max(seconds, 1)) });
    };

    try {
      if (replace) await api.post('/admin/voter-roll/clear');

      for (let at = 0; at < file.size; at += SLICE) {
        if (cancelled.current) break;
        // A slice can cut a line in half, so whatever is left after the last
        // newline is carried into the next one.
        carry += await file.slice(at, at + SLICE).text();
        const lines = carry.split('\n');
        carry = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          const cells = splitLine(line.replace(/\r$/, ''));
          if (!index) {
            index = mapHeader(cells);
            if (index.vin === undefined) {
              throw new Error('No "Voter ID number" column in that file. '
                + 'Headings found: ' + cells.slice(0, 12).join(', '));
            }
            continue;
          }
          // Five fields. Everything else in the row stays in this browser.
          pending.push([cells[index.vin], cells[index.name],
            cells[index.polling_unit], cells[index.ward], cells[index.lga]]);
          if (pending.length >= CHUNK) await flush();
        }
      }
      if (!cancelled.current) {
        if (carry.trim() && index) {
          const cells = splitLine(carry.replace(/\r$/, ''));
          pending.push([cells[index.vin], cells[index.name],
            cells[index.polling_unit], cells[index.ward], cells[index.lga]]);
        }
        await flush();
      }
      setDone({ sent, skipped, cancelled: cancelled.current,
        seconds: Math.round((Date.now() - started) / 1000) });
      onLoaded?.();
    } catch (e) {
      setError(e.message + (sent ? ' — ' + num(sent) + ' rows were loaded before this.' : ''));
    } finally { setBusy(false); }
  };

  return (
    <Card title="INEC voter register"
          note={loaded > 0
            ? num(loaded) + ' voters loaded. Every nominee is checked against them.'
            : 'Not loaded. Until it is, nominees are accepted without a register check.'}>
      {error && <Alert type="error" onClose={() => setError('')}>{error}</Alert>}

      {done && (
        <Alert type={done.cancelled ? 'warn' : 'success'}>
          {done.cancelled ? 'Stopped after ' : 'Loaded '}{num(done.sent)} voters
          {done.skipped > 0 && ', ' + num(done.skipped) + ' rows had no voter ID'}
          {' '}in {done.seconds}s.
        </Alert>
      )}

      <p className="hint">
        Choose the register CSV. It is read here in this browser and sent up in
        batches — nothing is uploaded whole, and only five fields leave this page:
        the voter ID, the name, and the LGA, ward and polling unit. Date of birth,
        phone number, address, occupation and disability status are dropped.
      </p>
      <p className="hint">
        Keep this tab open until it finishes. Roughly ten to twenty minutes for the
        full state register.
      </p>

      <Field label="Register CSV">
        <input type="file" accept=".csv,text/csv" disabled={busy}
               onChange={(e) => { setFile(e.target.files?.[0] || null); setDone(null); }} />
      </Field>

      <label className="check">
        <input type="checkbox" checked={replace} disabled={busy}
               onChange={(e) => setReplace(e.target.checked)} />
        Replace what is already loaded (leave ticked for a fresh register)
      </label>

      {progress && busy && (
        <div style={{ marginTop: 12 }}>
          <div className="progress">
            <div className="progress-bar" style={{
              width: Math.min(100, (progress.sent / 3300000) * 100) + '%',
            }} />
          </div>
          <div className="hint">
            {num(progress.sent)} sent · {num(progress.rate)}/s · {num(progress.total)} in the register
          </div>
        </div>
      )}

      <div className="btn-row" style={{ marginTop: 12 }}>
        <button className="btn" onClick={run} disabled={busy || !file}>
          {busy && <span className="spinner" />} {busy ? 'Loading' : 'Load the register'}
        </button>
        {busy && (
          <button className="btn secondary" onClick={() => { cancelled.current = true; }}>
            Stop
          </button>
        )}
      </div>
    </Card>
  );
}
