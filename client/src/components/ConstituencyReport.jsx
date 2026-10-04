import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, num } from '../lib/api.js';
import { Card, Stat, Alert, Loading, Empty, Status } from './ui.jsx';

const place = (value) => value?.trim() && value !== 'Not specified' ? value : 'Not recorded';

export default function ConstituencyReport({ selectedCandidate = '' }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [office, setOffice] = useState('');
  const [constituency, setConstituency] = useState('');
  const [candidate, setCandidate] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [ward, setWard] = useState('');
  const [gapsOnly, setGapsOnly] = useState(false);
  useEffect(() => { api.get('/nominations').then(setData).catch((e) => setError(e.message)); }, []);
  useEffect(() => { setOffice(''); setConstituency(''); setCandidate(''); setExpanded(null); setWard(''); }, [selectedCandidate]);
  if (error) return <Alert type="error">{error}</Alert>;
  if (!data) return <Loading label="Loading constituency report" />;
  const offices = [...new Set(data.rows.map((r) => r.office))].sort();
  const areas = [...new Set(data.rows.filter((r) => !office || r.office === office)
    .map((r) => r.scope_value || 'Statewide'))].sort();
  const rows = data.rows.filter((r) => (!office || r.office === office)
    && (!selectedCandidate || String(r.id) === selectedCandidate)
    && (!constituency || (r.scope_value || 'Statewide') === constituency)
    && (!candidate || String(r.id) === candidate));
  const total = (key) => rows.reduce((sum, r) => sum + Number(r[key] || 0), 0);
  const change = (setter) => (e) => { setter(e.target.value); setExpanded(null); setWard(''); };
  return <Card title="Constituency recruitment report"
    note="Unit Promoter nominations attributed to each candidate. Rejected nominations are excluded. Targets apply separately to each polling unit; extra people in one unit do not fill another unit's gap.">
    {!selectedCandidate && <div className="toolbar">
      <select aria-label="Office" value={office} onChange={(e) => { change(setOffice)(e); setConstituency(''); setCandidate(''); }}>
        <option value="">All offices</option>{offices.map((v) => <option key={v}>{v}</option>)}
      </select>
      <select aria-label="Constituency" value={constituency} onChange={(e) => { change(setConstituency)(e); setCandidate(''); }}>
        <option value="">All constituencies</option>{areas.map((v) => <option key={v}>{v}</option>)}
      </select>
      <select aria-label="Candidate" value={candidate} onChange={change(setCandidate)}>
        <option value="">All candidates</option>{data.rows.filter((r) => (!office || r.office === office)
          && (!constituency || (r.scope_value || 'Statewide') === constituency))
          .map((r) => <option key={r.id} value={r.id}>{r.full_name}</option>)}
      </select>
    </div>}
    <div className="grid grid-4" style={{ marginBottom: 16 }}>
      <Stat label="People nominated" value={num(rows.reduce((s, r) => s + r.nominees.length, 0))} foot="Includes nominees awaiting valid unit allocation" />
      <Stat label="Expected nominees" value={num(total('quota'))} foot="Legislative allocations only; unlimited offices have no numeric target" />
      <Stat label="Still needed" value={num(total('remaining'))} foot="Sum of gaps in individual polling units" />
      <Stat label="Unallocated nominees" value={num(total('unallocated'))} foot="Recorded people whose location does not match an allocated unit" />
    </div>
    {!rows.length ? <Empty title="No candidates match these filters" /> : <div className="table-wrap"><table>
      <thead><tr><th>Candidate / office</th><th>Constituency</th><th>People nominated</th><th>Expected</th><th>Still needed</th><th>Polling units complete</th><th>Details</th></tr></thead>
      <tbody>{rows.map((r) => <React.Fragment key={r.id}>
        <tr><td>{r.full_name}<div className="muted">{r.office}</div></td><td>{r.scope_value || 'Statewide'}</td>
          <td>{num(r.nominees.length)}<div className="muted">{r.count || 0} allocated{r.unallocated ? ` · ${r.unallocated} unallocated` : ''}</div></td>
          <td>{r.unlimited ? 'Unlimited' : r.quota == null ? 'No target set' : num(r.quota)}</td>
          <td>{r.remaining == null ? '—' : num(r.remaining)}</td>
          <td>{r.polling_units == null ? '—' : `${r.completed_polling_units} / ${r.polling_units}`}</td>
          <td><button className="btn sm secondary" onClick={() => { setExpanded(expanded === r.id ? null : r.id); setWard(''); }}>{expanded === r.id ? 'Hide' : 'View locations'}</button></td></tr>
        {expanded === r.id && <tr><td colSpan={7}>
          <div className="toolbar">
            <select aria-label="Report ward" value={ward} onChange={(e) => setWard(e.target.value)}><option value="">All wards</option>
              {[...new Set([...(r.units || []), ...r.nominees].map((n) => JSON.stringify([n.lga, n.ward])))].sort().map((v) => <option key={v} value={v}>{JSON.parse(v).map(place).join(' / ')}</option>)}
            </select>
            <label><input type="checkbox" checked={gapsOnly} onChange={(e) => setGapsOnly(e.target.checked)} /> Show polling units still short</label>
          </div>
          {!!r.units?.length && <div className="table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}><table>
            <thead><tr><th>LGA</th><th>Ward</th><th>Polling unit</th><th>Nominated</th><th>Expected</th><th>Still needed</th></tr></thead>
            <tbody>{r.units.filter((u) => (!ward || JSON.stringify([u.lga, u.ward]) === ward) && (!gapsOnly || u.remaining > 0)).map((u) => <tr key={JSON.stringify([u.lga, u.ward, u.polling_unit])}>
              <td>{place(u.lga)}</td><td>{place(u.ward)}</td><td>{place(u.polling_unit)}</td><td>{u.count}</td><td>{u.quota}</td><td>{u.remaining}</td>
            </tr>)}</tbody>
          </table></div>}
          <h3>Registered nominees</h3>
          {!r.nominees.length ? <Empty title="No nominees registered yet" /> : <div className="table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}><table>
            <thead><tr><th>Name</th><th>LGA</th><th>Ward</th><th>Polling unit</th><th>Status</th></tr></thead>
            <tbody>{r.nominees.filter((n) => !ward || JSON.stringify([n.lga, n.ward]) === ward).map((n) => <tr key={n.id}>
              <td><Link to={'/members/' + n.id}>{n.first_name} {n.last_name}</Link></td><td>{place(n.lga)}</td><td>{place(n.ward)}</td><td>{place(n.polling_unit)}</td><td><Status value={n.status} /></td>
            </tr>)}</tbody>
          </table></div>}
        </td></tr>}
      </React.Fragment>)}</tbody>
    </table></div>}
  </Card>;
}
