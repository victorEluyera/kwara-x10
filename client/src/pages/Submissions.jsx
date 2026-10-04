import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api, num, timeAgo } from '../lib/api.js';
import { Card, Status, Loading, Empty, Alert, Stat } from '../components/ui.jsx';

export default function Submissions({ compact = false, taskId = null, initialStatus = 'pending', onReviewed }) {
  const [rows, setRows] = useState(null);
  const [status, setStatus] = useState(initialStatus);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    try {
      const query = new URLSearchParams();
      if (status) query.set('status', status);
      if (taskId) query.set('task_id', taskId);
      const d = await api.get('/submissions?' + query.toString());
      setRows(d.rows);
    } catch (e) { setError(e.message); }
  }, [status, taskId]);

  useEffect(() => { setRows(null); load(); }, [load]);

  const review = async (id, decision) => {
    setBusy(id);
    try { await api.post('/submissions/' + id + '/review', { status: decision }); await load(); onReviewed?.(); }
    catch (e) { setError(e.message); }
    finally { setBusy(null); }
  };

  const content = (
    <>
      {error && <Alert type="error" onClose={() => setError('')}>{error}</Alert>}

      {!compact && (
        <div className="toolbar">
          <div className="pill-row">
            {['pending', 'approved', 'rejected', ''].map((s) => (
              <button key={s} className={'pill' + (status === s ? ' active' : '')}
                      onClick={() => setStatus(s)}>
                {s || 'All'}
              </button>
            ))}
          </div>
          <div className="spacer" />
          {rows && <span className="muted">{num(rows.length)} submission(s){rows.length === 500 ? ' · latest 500 shown' : ''}</span>}
        </div>
      )}

      <Card title={compact ? undefined : 'Review queue'}
            note={compact ? undefined : "Approving a submission releases its points into the member's monthly total"}
            bodyClass="">
        {!rows ? <Loading /> : rows.length === 0 ? (
          <Empty title={'No ' + (status || '') + ' submissions'} icon="✓">
            Field evidence submitted against tasks appears here for verification.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Member</th><th>Task</th><th>Location</th>
                  <th className="num">Points</th>
                  <th>Status</th><th>When</th><th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link to={'/members/' + s.member_id} style={{ fontWeight: 600 }}>
                        {s.first_name} {s.last_name}
                      </Link>
                      <div className="muted mono" style={{ fontSize: 12 }}>{s.member_code}</div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{s.task_title}</div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {s.task_type.replace(/_/g, ' ')}
                      </div>
                      {s.answers_json && (
                        <div className="muted" style={{ fontSize: 12 }}>
                          {Object.entries(JSON.parse(s.answers_json))
                            .filter(([, v]) => v)
                            .map(([k, v]) => k + ': ' + v).join(' · ')}
                        </div>
                      )}
                      {s.note && <div className="muted" style={{ fontSize: 12 }}>“{s.note}”</div>}
                    </td>
                    <td>
                      <div>{s.lga}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{s.polling_unit}</div>
                      {s.lat != null && (
                        <div className="mono muted" style={{ fontSize: 11 }}>
                          {s.lat.toFixed(4)}, {s.lng.toFixed(4)}
                        </div>
                      )}
                    </td>
                    <td className="num">{s.points_awarded || s.task_points}</td>
                    <td><Status value={s.status} /></td>
                    <td className="muted nowrap">{timeAgo(s.created_at)}</td>
                    <td>
                      {s.status === 'pending' && (
                        <div className="btn-row">
                          <button className="btn sm" disabled={busy === s.id}
                                  onClick={() => review(s.id, 'approved')}>Approve</button>
                          <button className="btn sm danger" disabled={busy === s.id}
                                  onClick={() => review(s.id, 'rejected')}>Reject</button>
                        </div>
                      )}
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

  return compact ? content : content;
}
