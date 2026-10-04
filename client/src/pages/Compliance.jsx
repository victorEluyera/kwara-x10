import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, num, timeAgo } from '../lib/api.js';
import { Card, Stat, Status, Loading, Empty, Alert, Modal, Field } from '../components/ui.jsx';
import Oversight from '../components/Oversight.jsx';

function NominationsPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [filter, setFilter] = useState('all');

  const load = () => api.get('/nominations').then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  if (error) return <Alert type="error">{error}</Alert>;
  if (!data) return <Loading label="Loading nomination status" />;

  const rows = data.rows.filter((r) => {
    if (filter === 'complete') return r.complete;
    if (filter === 'incomplete') return !r.unlimited && !r.complete;
    return true;
  });

  return (
    <>
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Candidates covered" value={num(data.summary.candidates)} accent
              foot="Legislative candidates, Deputy Governor and stakeholders" />
        <Stat label="Nominations complete" value={num(data.summary.complete)}
              foot={num(data.summary.incomplete) + ' still short of quota'}
              progress={data.summary.candidates - data.summary.unlimited
                ? (data.summary.complete / (data.summary.candidates - data.summary.unlimited)) * 100 : 0} />
        <Stat label="Unit Promoters nominated" value={num(data.summary.total_nominated)}
              foot={num(data.summary.unlimited_nominated) + ' from separate unlimited allocations'} />
        <Stat label="Still required" value={num(Math.max(0,
              data.summary.total_remaining))}
              foot="Across all incomplete candidates" />
      </div>

      <div className="toolbar">
        <div className="pill-row">
          {[['all', 'All'], ['incomplete', 'Incomplete'], ['complete', 'Complete']].map(([v, l]) => (
            <button key={v} className={'pill' + (filter === v ? ' active' : '')}
                    onClick={() => setFilter(v)}>{l}</button>
          ))}
        </div>
        <div className="spacer" />
        <span className="muted">{num(rows.length)} shown</span>
      </div>

      <Card title="Nomination compliance"
            note="Per polling unit: Senator 4 + Rep 3 + Assembly 3 = 10. Deputy Governor and stakeholders: separate unlimited allocations."
            bodyClass="">
        {rows.length === 0 ? <Empty title="Nobody matches this filter" /> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Candidate</th><th>Office</th><th>Constituency</th>
                  <th className="num">Nominated</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <React.Fragment key={r.id}>
                    <tr>
                      <td style={{ fontWeight: 600 }}>{r.full_name}</td>
                      <td>{r.office}</td>
                      <td className="muted">{r.scope_value || 'Statewide'}</td>
                      <td className="num">
                        <span className={'badge ' + (r.complete ? 'green' : 'amber')}>
                          {r.count} / {r.unlimited ? 'Unlimited' : r.quota}
                        </span>
                        {!r.unlimited && <div className="muted">{r.per_polling_unit} per polling unit · {r.completed_polling_units}/{r.polling_units} complete{r.unallocated > 0 ? " · " + r.unallocated + " unallocated" : ""}</div>}
                      </td>
                      <td>
                        {r.unlimited ? <span className="badge blue">Unlimited</span> : r.complete
                          ? <span className="badge green"><span className="dot" />complete</span>
                          : <span className="badge amber">{r.remaining} short</span>}
                      </td>
                      <td>
                        {r.nominees.length > 0 && (
                          <button className="btn sm secondary"
                                  onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                            {expanded === r.id ? 'Hide' : 'View'} nominees
                          </button>
                        )}
                      </td>
                    </tr>
                    {expanded === r.id && (
                      <tr>
                        <td colSpan={6} style={{ background: 'var(--ink-50)', padding: 0 }}>
                          <div className="table-wrap">
                            <table>
                              <thead>
                                <tr>
                                  <th>Name</th><th>LGA</th><th>Ward</th><th>Polling unit</th>
                                  <th>PVC</th><th>Bank</th><th>Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {r.nominees.map((n) => (
                                  <tr key={n.id}>
                                    <td>
                                      <Link to={'/members/' + n.id}>
                                        {n.first_name} {n.last_name}
                                      </Link>
                                      <div className="muted mono" style={{ fontSize: 11 }}>{n.code}</div>
                                    </td>
                                    <td>{n.lga}</td>
                                    <td className="muted">{n.ward}</td>
                                    <td className="muted">{n.polling_unit}</td>
                                    <td className="mono">{n.pvc_no || '--'}</td>
                                    <td>
                                      <div>{n.bank_name || '--'}</div>
                                      <div className="mono muted" style={{ fontSize: 11 }}>
                                        {n.account_number || ''}
                                      </div>
                                    </td>
                                    <td><Status value={n.status} /></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function ReviewModal({ report, onClose, onSaved }) {
  const [note, setNote] = useState(report.review_note || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setBusy(true); setError('');
    try {
      await api.post('/admin/disparity-reports/' + report.id + '/review', { note });
      onSaved(); onClose();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal title={'Report from ' + report.candidate_name} onClose={onClose} footer={
      <div className="btn-row">
        <button className="btn" onClick={save} disabled={busy}>
          {busy && <span className="spinner" />} Mark reviewed
        </button>
        <button className="btn secondary" onClick={onClose}>Close</button>
      </div>
    }>
      {error && <Alert type="error">{error}</Alert>}
      <div className="section-title">Party / candidate disparities</div>
      <p style={{ whiteSpace: 'pre-wrap', fontSize: 13.5 }}>
        {report.disparities || <span className="muted">Nothing submitted</span>}
      </p>
      <div className="section-title">Challenges in constituency</div>
      <p style={{ whiteSpace: 'pre-wrap', fontSize: 13.5 }}>
        {report.challenges || <span className="muted">Nothing submitted</span>}
      </p>
      <div className="section-title">Positives and progress</div>
      <p style={{ whiteSpace: 'pre-wrap', fontSize: 13.5 }}>
        {report.positives || <span className="muted">Nothing submitted</span>}
      </p>
      <Field label="Review note" hint="Visible to the candidate">
        <textarea value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="Optional note back to the candidate" />
      </Field>
    </Modal>
  );
}

function DisparityReportsPanel() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const [filter, setFilter] = useState('all');

  const load = () => api.get('/admin/disparity-reports').then((d) => setRows(d.rows))
    .catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  if (error) return <Alert type="error">{error}</Alert>;
  if (!rows) return <Loading label="Loading reports" />;

  const shown = rows.filter((r) => {
    if (filter === 'reviewed') return !!r.reviewed_at;
    if (filter === 'unreviewed') return !r.reviewed_at;
    return true;
  });

  return (
    <>
      {open && <ReviewModal report={open} onClose={() => setOpen(null)} onSaved={load} />}

      <div className="toolbar">
        <div className="pill-row">
          {[['all', 'All'], ['unreviewed', 'Unreviewed'], ['reviewed', 'Reviewed']].map(([v, l]) => (
            <button key={v} className={'pill' + (filter === v ? ' active' : '')}
                    onClick={() => setFilter(v)}>{l}</button>
          ))}
        </div>
        <div className="spacer" />
        <span className="muted">{num(shown.length)} shown</span>
      </div>

      <Card title="Disparities & challenges reports"
            note="Submitted directly by candidates to the Campaign Council"
            bodyClass="">
        {shown.length === 0 ? (
          <Empty title="No reports match this filter">
            Reports appear here as candidates submit them from their dashboard.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Candidate</th><th>Office</th><th>Constituency</th>
                  <th>Summary</th><th>Status</th><th>Submitted</th><th></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600 }}>{r.candidate_name}</td>
                    <td>{r.office}</td>
                    <td className="muted">{r.scope_value}</td>
                    <td className="muted" style={{ maxWidth: 260 }}>
                      {(r.disparities || r.challenges || '').slice(0, 90)}
                      {(r.disparities || r.challenges || '').length > 90 ? '…' : ''}
                    </td>
                    <td>
                      {r.reviewed_at
                        ? <span className="badge green"><span className="dot" />reviewed</span>
                        : <span className="badge amber">awaiting review</span>}
                    </td>
                    <td className="muted nowrap">{timeAgo(r.updated_at || r.submitted_at)}</td>
                    <td>
                      <button className="btn sm secondary" onClick={() => setOpen(r)}>
                        {r.reviewed_at ? 'View' : 'Review'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

export default function Compliance() {
  const [tab, setTab] = useState('nominations');

  return (
    <>
      <div className="tabs">
        <button className={'tab' + (tab === 'nominations' ? ' active' : '')}
                onClick={() => setTab('nominations')}>
          Unit Promoter nominations
        </button>
        <button className={'tab' + (tab === 'reports' ? ' active' : '')}
                onClick={() => setTab('reports')}>
          Disparities & challenges
        </button>
        <button className={'tab' + (tab === 'activity' ? ' active' : '')}
                onClick={() => setTab('activity')}>
          Who has done what
        </button>
      </div>
      {tab === 'nominations' && <NominationsPanel />}
      {tab === 'reports' && <DisparityReportsPanel />}
      {tab === 'activity' && <Oversight />}
    </>
  );
}
