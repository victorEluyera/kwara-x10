import React, { useEffect, useState } from 'react';
import { api, num, downloadFile } from '../lib/api.js';
import { Alert, Modal } from './ui.jsx';

/**
 * Upload a filled-in spreadsheet.
 *
 * Shared by the project list and the nominee list, which differ only in what
 * they call the rows and what a row turns into. Both arrive the same way: a
 * candidate downloads the form, types into it for a week, and sends it back
 * with a column moved, three blank lines and one entry that cannot be right.
 *
 * So nothing is saved on the first upload. The reply is a verdict on every
 * row, numbered the way the spreadsheet numbers them, and only then is there a
 * button to save. A file with bad rows is refused whole unless the candidate
 * chooses to go ahead with the good ones -- the usual mistake is structural,
 * and importing the handful of rows that happened to survive a shifted column
 * is worse than importing none.
 *
 * @param {object} props
 * @param {string} props.title           modal heading
 * @param {string} props.noun            "project" / "nominee"
 * @param {string} props.endpoint        e.g. "/projects/import"
 * @param {string} props.templatePath    e.g. "/projects/template.xlsx"
 * @param {string} props.templateName    downloaded filename
 * @param {React.ReactNode} props.guidance  what to write in it
 * @param {(row: object) => React.ReactNode} props.describe  one row, summarised
 * @param {React.ReactNode} [props.afterSave]  shown on the confirmation screen
 * @param {React.ReactNode} [props.duplicateHint]  how to make a row distinct if
 *   it really is not the same thing
 */
export default function SheetImport({
  title, noun, endpoint, templatePath, templateName, guidance, describe,
  duplicateHint, afterSave, onClose, onSaved,
}) {
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);
  const [progressId, setProgressId] = useState(null);
  const [saveProgress, setSaveProgress] = useState(null);

  useEffect(() => {
    if (!progressId) return undefined;
    let active = true;
    const poll = async () => {
      try {
        const progress = await api.get('/members/import-progress/' + progressId);
        if (active) setSaveProgress(progress);
      } catch {
        // The save request reports its own errors; progress polling is advisory.
      }
    };
    poll();
    const timer = setInterval(poll, 400);
    return () => { active = false; clearInterval(timer); };
  }, [progressId]);

  const plural = (n, word = noun) => num(n) + ' ' + word + (Number(n) === 1 ? '' : 's');

  const send = async (confirm) => {
    setBusy(true); setError('');
    const currentProgressId = confirm ? window.crypto.randomUUID() : null;
    if (currentProgressId) {
      setProgressId(currentProgressId);
      setSaveProgress({ percentage: 2, message: 'Preparing the nominee list', done: 0, total: 0 });
    }
    try {
      const body = new FormData();
      body.append('file', file);
      const join = endpoint.includes('?') ? '&' : '?';
      const query = confirm
        ? join + 'confirm=1' + (result?.summary.invalid ? '&skip_invalid=1' : '')
          + '&progress_id=' + encodeURIComponent(currentProgressId)
        : '';
      const out = await api.form(endpoint + query, body);
      if (confirm) { setDone(out); onSaved?.(); } else setResult(out);
    } catch (e) {
      // A 422 carries the per-row verdict, which is the useful part -- far
      // more so than the one sentence attached to it.
      if (e.data?.rows) setResult(e.data);
      setError(e.message);
    } finally {
      setBusy(false);
      setProgressId(null);
    }
  };

  const choose = (event) => {
    setFile(event.target.files?.[0] || null);
    setResult(null); setDone(null); setError('');
    setSaveProgress(null); setProgressId(null);
  };

  const download = async () => {
    setError('');
    try { await downloadFile(templatePath, templateName); }
    catch (e) { setError(e.message); }
  };

  if (done) {
    return (
      <Modal title="Uploaded" onClose={onClose} footer={
        <button className="btn" onClick={onClose}>Done</button>
      }>
        <Alert type="success">{plural(done.committed)} added.</Alert>
        {done.summary?.invalid > 0 && (
          <p className="hint">
            {noun === 'nominee' ? plural(done.summary.invalid, 'row') + ' excluded because it is a duplicate or has no VIN. Other eligible rows were registered with their issues retained.'
              : plural(done.summary.invalid, 'row') + ' skipped because of the problems listed. Fix them in the spreadsheet and upload it again.'}
          </p>
        )}
        {afterSave?.(done)}
        {done.batch && (
          <p className="hint" style={{ marginTop: 10 }}>
            If this was the wrong file it can be undone as one batch — reference
            <code style={{ marginLeft: 4 }}>{String(done.batch).slice(0, 8)}</code>.
            Quote that to the programme office.
          </p>
        )}
      </Modal>
    );
  }

  const canSave = result && result.summary.valid > 0;

  return (
    <Modal title={title} onClose={onClose} footer={
      <div className="btn-row">
        {!result ? (
          <button className="btn" onClick={() => send(false)} disabled={busy || !file}>
            {busy && <span className="spinner" />} Check the file
          </button>
        ) : (
          <button className="btn" onClick={() => send(true)} disabled={busy || !canSave}>
            {busy && <span className="spinner" />} Save {plural(result.summary.valid)}
          </button>
        )}
        <button className="btn secondary" onClick={onClose}>Cancel</button>
      </div>
    }>
      {error && <Alert type={result ? 'warn' : 'error'}>{error}</Alert>}
      {busy && saveProgress && (
        <div role="status" aria-live="polite" style={{ marginBottom: 14 }}>
          <div className="toolbar" style={{ marginBottom: 6 }}>
            <strong>{saveProgress.message}</strong>
            <div className="spacer" />
            <span>{saveProgress.percentage}%</span>
          </div>
          <div className="progress" role="progressbar"
               aria-valuemin="0" aria-valuemax="100" aria-valuenow={saveProgress.percentage}>
            <div className="progress-bar" style={{ width: saveProgress.percentage + '%' }} />
          </div>
          {saveProgress.total > 0 && (
            <div className="hint" style={{ marginTop: 4 }}>
              {num(saveProgress.done)} of {num(saveProgress.total)} rows processed
            </div>
          )}
        </div>
      )}

      {/* Once the file has been checked these are done with, and leaving them up
          pushes the thing that now matters -- the row-by-row verdict, and the
          button to save it -- off the bottom of the modal. */}
      {!result ? (
        <>
          <div className="section-title">1. Get the form</div>
          {guidance}
          <button className="btn sm secondary" onClick={download}>
            Download the spreadsheet
          </button>

          <div className="section-title" style={{ marginTop: 18 }}>2. Send it back</div>
          <input type="file" accept=".xlsx,.csv" onChange={choose} disabled={busy} />
        </>
      ) : (
        <div className="toolbar" style={{ gap: 8 }}>
          <span className="muted">{file?.name}</span>
          <div className="spacer" />
          <button className="btn sm secondary" onClick={() => { setResult(null); setError(''); }}>
            Choose a different file
          </button>
        </div>
      )}

      {result && (
        <>
          <div className="section-title" style={{ marginTop: 18 }}>
            {result.summary.invalid > 0 ? noun === 'nominee' ? 'Ready to save nominees with VIN' : 'Some rows need fixing' : 'Ready to save'}
          </div>

          <div className="pill-row" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
            <span className="badge green">{num(result.summary.valid)} ready</span>
            {result.summary.invalid > 0 && (
              <span className="badge red">{num(result.summary.invalid)} {noun === 'nominee' ? 'duplicates / missing VIN excluded' : 'cannot import yet'}</span>
            )}
            {noun === 'nominee' && result.summary.missing_vin > 0 && <span className="badge red">{num(result.summary.missing_vin)} without VIN</span>}
            {result.summary.duplicates > 0 && (
              <span className="badge red">{num(result.summary.duplicates)} already on the list</span>
            )}
            {result.summary.unverified > 0 && (
              <span className="badge amber">
                {num(result.summary.unverified)} PVC/VIN unmatched
              </span>
            )}
            {result.summary.unverified > 0 && (
            <p className="hint">
              {plural(result.summary.unverified, 'row')} could not be matched to the
              INEC register. They can still be added if they have no blocking errors;
              this does not confirm a VIN match. Add or correct the PVC/VIN from the nominee details later.
            </p>
          )}
          {result.summary.over_quota > 0 && (
              <span className="badge amber">{num(result.summary.over_quota)} over the allowance</span>
            )}
            {result.summary.warnings > 0 && (
              <span className="badge amber">{num(result.summary.warnings)} rows with warnings</span>
            )}
            {result.summary.blank > 0 && (
              <span className="badge">{num(result.summary.blank)} blank spreadsheet rows ignored</span>
            )}
          </div>
          {(result.summary.invalid > 0 || result.summary.warnings > 0 || result.summary.blank > 0) && <p className="hint">
            {noun === 'nominee' ? 'All non-duplicate nominees with a VIN will be registered, including those with other incomplete or incorrect details. Issues are retained for correction; duplicates and missing VINs are excluded.' : 'Errors prevent a row being added. Warnings ask you to review details and do not block a row unless it also has an error.'}
            Blank rows contain no nominee data. Warning and error counts can overlap; they are counts of rows, not individual problems.
            See each row below for its specific reason.
          </p>}

          {result.summary.duplicates > 0 && (
            <p className="hint">
              {plural(result.summary.duplicates, 'row')} already on your list and will
              not be added a second time — they are not counted in the total above.
              {' '}{duplicateHint}
            </p>
          )}
          {result.summary.over_quota > 0 && (
            <p className="hint">
              Going over the allowance does not stop anyone being added. Those rows
              are saved and marked, so the campaign can see where you are over.
            </p>
          )}
          {result.summary.invalid > 0 && (
            <p className="hint">
              {noun === 'nominee' ? 'Saving adds every non-duplicate nominee with a VIN. Duplicate rows and rows without a VIN are skipped.' : 'Saving now adds only the rows that are correct. The rest stay in your spreadsheet — fix them and upload it again.'}
            </p>
          )}

          <div className="table-wrap" style={{ maxHeight: '38vh', overflowY: 'auto' }}>
            <table>
              <thead>
                <tr><th>Row</th><th>What it will add</th><th>Notes</th></tr>
              </thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.line}>
                    <td className="num muted">{r.line}</td>
                    <td>{describe(r) || <span className="muted">—</span>}</td>
                    <td style={{ fontSize: 12 }}>
                      {r.duplicate && <span className="badge red">already on your list</span>}
                      {r.errors.map((m, i) => <div key={'e' + i} className="error-text">{m}</div>)}
                      {r.warnings.map((m, i) => <div key={'w' + i} className="muted">{m}</div>)}
                      {!r.errors.length && !r.warnings.length && (
                        <span className="badge green">ok</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}
