import React, { useEffect, useState } from 'react';
import { api, num, timeAgo } from '../lib/api.js';
import { Card, Stat, Alert, Loading, Empty } from './ui.jsx';

/**
 * Who has done what, and who has done nothing.
 *
 * Three populations that mean different things by "done something", so they
 * get three tabs rather than one league table: a candidate submits projects
 * and nominates promoters, a promoter registers people, a grassroot member
 * answers survey tasks.
 *
 * Every list is sorted least active first. The question this answers is "who
 * has not submitted", so the empty rows belong at the top where they can be
 * acted on, not buried under the people already doing the work.
 */

const TABS = [
  ['candidate', 'Candidates'],
  ['promoter', 'Unit Promoters'],
  ['grassroot', 'Grassroots'],
];

export default function Oversight() {
  const [role, setRole] = useState('candidate');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setBusy(true);
    api.get('/admin/oversight?role=' + role + '&limit=200')
      .then((d) => { if (live) setData(d); })
      .catch((e) => { if (live) setError(e.message); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [role]);

  if (error && !data) return <Alert type="error">{error}</Alert>;
  if (!data) return <Loading label="Loading programme activity" />;

  const s = data.summary;
  const idle = data.rows.filter((r) => !r.submitted).length;

  return (
    <>
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Projects submitted" value={num(s.projects)} accent
              foot={num(s.candidates_with_projects) + ' of ' + num(s.candidates)
                    + ' candidates have submitted'} />
        <Stat label="Yet to submit a project" value={num(s.candidates_without_projects)}
              foot="Candidates with nothing on the register"
              progress={s.candidates ? (s.candidates_with_projects / s.candidates) * 100 : 0}
              progressTone={s.candidates_without_projects > 0 ? 'warn' : ''} />
        <Stat label="Unit Promoters" value={num(s.promoters)} foot="Nominated and not rejected" />
        <Stat label="Grassroots" value={num(s.grassroots)} foot="Registered and not rejected" />
      </div>

      <div className="pill-row" style={{ marginBottom: 10 }}>
        {TABS.map(([key, label]) => (
          <button key={key} className={'pill' + (role === key ? ' active' : '')}
                  onClick={() => setRole(key)}>{label}</button>
        ))}
        {busy && <span className="spinner" style={{ marginLeft: 8 }} />}
      </div>

      <Card title={TABS.find(([k]) => k === role)[1]}
            note={data.total > data.count
              ? num(data.count) + ' of ' + num(data.total) + ' shown, least active first'
              : num(data.total) + ' in total, least active first'}
            bodyClass="">
        {data.rows.length === 0 ? (
          <Empty title="Nobody here yet">
            People appear once they are registered.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Where</th>
                  {role === 'candidate' ? (
                    <>
                      <th className="num">Projects</th>
                      <th className="num">Nominees</th>
                      <th className="num">Verified</th>
                    </>
                  ) : (
                    <>
                      <th className="num">{role === 'promoter' ? 'Registered' : 'Survey replies'}</th>
                      <th>Under</th>
                    </>
                  )}
                  <th>Last activity</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600 }}>
                      {r.name}
                      {!r.submitted && (
                        <span className="badge amber" style={{ marginLeft: 6 }}>
                          {role === 'candidate' ? 'no projects'
                            : role === 'promoter' ? 'nobody registered' : 'no replies'}
                        </span>
                      )}
                      {r.code && <div className="muted" style={{ fontSize: 11 }}>{r.code}</div>}
                    </td>
                    <td className="muted">{r.office}</td>
                    <td className="muted" style={{ fontSize: 12 }}>{r.area}</td>
                    {role === 'candidate' ? (
                      <>
                        <td className="num">{num(r.projects)}</td>
                        <td className="num">{num(r.nominees)}</td>
                        <td className="num">{num(r.verified)}</td>
                      </>
                    ) : (
                      <>
                        <td className="num">
                          {num(role === 'promoter' ? r.registered : r.submissions)}
                        </td>
                        <td className="muted" style={{ fontSize: 12 }}>{r.candidate || '—'}</td>
                      </>
                    )}
                    <td className="muted nowrap">
                      {r.last_activity ? timeAgo(r.last_activity) : 'Never'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {idle > 0 && (
        <p className="hint" style={{ marginTop: 10 }}>
          {num(idle)} of the {num(data.rows.length)} shown have done nothing yet.
        </p>
      )}
    </>
  );
}
