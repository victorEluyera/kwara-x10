import ContactVerificationUpload from '../components/ContactVerificationUpload.jsx';
import MemberLocationEditor from '../components/MemberLocationEditor.jsx';
import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api, downloadCsv, num, timeAgo, LEVEL_LABEL, isCandidateRole } from '../lib/api.js';
import { Card, Loading, Empty, Alert } from '../components/ui.jsx';
import { useAuth } from '../App.jsx';

const LEVELS = ['', 'mobiliser'];
const PAGE = 100;
const VIN_STATUSES = {not_checked:'Not checked', verified:'VIN and location match', location_mismatch:'VIN found · submitted location differs', missing_vin:'Missing VIN', vin_not_found:'VIN not found', needs_review:'Needs review'};
function verification(member) {
  try { return JSON.parse(member.vin_verification_json || '{}'); } catch { return {}; }
}
function memberFollowUp(member) {
  const issues = [], actions = [];
  const voterRequired = ['mobiliser', 'unit_promoter', 'grassroot'].includes(member.level);
  const result = verification(member);
  if (!member.first_name?.trim() || !member.last_name?.trim()) { issues.push('Name incomplete'); actions.push('Complete the first name and surname.'); }
  const status = member.vin_verification_status || 'not_checked';
  if (!member.phone?.trim()) { issues.push('Phone missing'); actions.push('Add a contact phone number.'); }
  else if (!/^(0\d{10}|234\d{10})$/.test(member.phone.replace(/\D/g, ''))) {
    issues.push('Phone incomplete or invalid'); actions.push('Confirm and enter the full phone number, including its leading 0 or 234 country code.');
  }
  if (voterRequired) {
    if (!member.pvc_no?.trim() || status === 'missing_vin') {
      issues.push('VIN missing'); actions.push('Enter the VIN exactly as printed on the PVC.');
    } else if (status === 'vin_not_found') {
      issues.push('VIN not found in supplied records'); actions.push('Check the VIN against the PVC; if correct, supply the relevant voter record.');
    } else if (status === 'location_mismatch') {
      const assigned = result.assignment && ['lga', 'ward', 'polling_unit'].every(key => member[key] === result.assignment[key]);
      issues.push(assigned ? 'Location corrected; confirmation needed' : 'Location differs from voter record');
      actions.push(assigned ? 'Confirm the updated ward and polling unit.' : 'Correct the ward and polling unit to match the voter record.');
    } else if (status === 'needs_review') {
      issues.push(result.reason || 'VIN or location needs confirmation'); actions.push('Ask the responsible officer to confirm the VIN and location.');
    } else if (status === 'not_checked') {
      issues.push('VIN and location check outstanding'); actions.push('Run Update voter verification to check against the available records.');
    }
    if (!member.polling_unit_resolved) {
      issues.push('Polling unit needs allocation'); actions.push('Select the correct LGA, ward and official polling unit.');
    }
  }
  if (![member.bank_name, member.account_name, member.account_number].every(value => String(value || '').trim())) {
    issues.push('Bank details incomplete'); actions.push('Complete bank name, account name and account number.');
  }
  if (member.contact_verification_status === 'unreachable') {
    issues.push('Contact centre could not reach member'); actions.push('Retry the call and confirm the phone number.');
  } else if (member.contact_verification_status === 'incorrect_details') {
    issues.push('Contact centre reported incorrect details'); actions.push('Review the call notes and correct the member details.');
  } else if (member.contact_verification_status === 'declined') {
    issues.push('Member declined during contact'); actions.push('Review the call notes with the responsible officer.');
  } else if (member.contact_verification_status === 'pending') {
    issues.push('Contact centre follow-up pending'); actions.push('Complete the follow-up call.');
  }
  let originalWarnings=[]; try { originalWarnings=JSON.parse(member.risk_flags || '[]').filter(flag=>flag.code==='import_warning').map(flag=>flag.message); } catch {}
  if (originalWarnings.length) { issues.push('Original upload notes: '+originalWarnings.join('; ')); actions.push('Review the upload notes and correct any remaining issues.'); }
  return { issues: issues.join('; ') || 'No outstanding issues identified', actions: actions.join(' ') || 'No correction needed.' };
}

export default function Members() {
  const { me } = useAuth();
  const [geo, setGeo] = useState(null);
  const [contactUpload,setContactUpload]=useState(false);
  const [editMode,setEditMode]=useState(false),[editing,setEditing]=useState(null);
  const [data, setData] = useState(null);
  const [filters, setFilters] = useState({ contact_verification_status: '', phone_quality: '', account_presence: '', vin_presence: '', sort: 'created_at', direction: 'desc', q: '', polling_unit_presence: '', level: '', lga: '', ward: '', upline_user_id: '', vin_verification_status: '' });
  const [draft, setDraft] = useState({ contact_verification_status: '', phone_quality: '', account_presence: '', vin_presence: '', sort: 'created_at', direction: 'desc', q: '', polling_unit_presence: '', level: '', lga: '', ward: '', upline_user_id: '', vin_verification_status: '' });
  const [dateFrom, setDateFrom] = useState('');
  const [dateBefore, setDateBefore] = useState('');
  const [applying, setApplying] = useState(false);
  const [notice, setNotice] = useState('');
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reportCandidates, setReportCandidates] = useState([]);
  const [reportCandidate, setReportCandidate] = useState('');
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);
  const exportCsv = async (kind = 'members') => {
    if (exportingCsv) return;
    setExportingCsv(true); setError('');
    const qs = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
    if (kind === 'issues') qs.set('issues', '1');
    if (kind === 'nominees') qs.set('level', 'mobiliser');
    try {
      await downloadCsv('/export/members.csv?' + qs, kind === 'issues' ? 'kwarax10-members-needing-correction.csv' : kind === 'nominees' ? 'kwarax10-nominees.csv' : 'kwarax10-members.csv');
      setNotice('CSV downloaded with your selected filters and sorting.');
    } catch (error) { setError(error.message); }
    finally { setExportingCsv(false); }
  };
  const exportPdf = async () => {
    const report = window.open('', '_blank');
    if (!report) { setError('Allow pop-ups for this site to export the PDF.'); return; }
    report.opener = null;
    report.document.title = 'Members report';
    report.document.body.textContent = 'Preparing your member report...';
    setExportingPdf(true);
    const escape = value => String(value ?? '--').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
    try {
      const rows = [];
      let total = Infinity;
      while (rows.length < total) {
        if (report.closed) throw new Error('PDF export was cancelled.');
        const qs = new URLSearchParams({ limit: 1000, offset: rows.length });
        for (const [key, value] of Object.entries(filters)) if (value) qs.set(key, value);
        const page = await api.get('/members?' + qs);
        total = Number(page.total);
        rows.push(...page.rows);
        if (!page.rows.length) break;
        report.document.body.textContent = 'Preparing report: ' + rows.length + ' of ' + total + ' members';
      }
      const content = rows.map(member => {
        const followUp = memberFollowUp(member);
        const fields = [['Code', member.code], ['Phone', member.phone], ['Level', LEVEL_LABEL[member.level] || member.level],
          ['LGA', member.lga], ['Ward', member.ward], ['Polling unit', member.polling_unit], ['VIN', member.pvc_no],
          ['Bank', member.bank_name], ['Account name', member.account_name], ['Account number', member.account_number],
          ['Contact centre result', member.contact_verification_status || 'not_called'], ['Call notes', member.contact_verification_notes], ['Caller', member.contact_verified_by], ['Called at', member.contact_verified_at], ['Registered by', member.upline_name], ['Added', member.created_at], ['Issues', followUp.issues], ['What to do', followUp.actions]];
        return '<section><h2>' + escape([member.title, member.first_name, member.last_name].filter(Boolean).join(' ')) + '</h2><dl>'
          + fields.map(([label, value]) => '<dt>' + escape(label) + '</dt><dd>' + escape(value || '--') + '</dd>').join('') + '</dl></section>';
      }).join('');
      report.document.open();
      report.document.write('<!doctype html><html><head><meta charset="utf-8"><title>kwarax10-members</title><style>'
        + '@page{size:A4;margin:14mm}body{font:12px Arial,sans-serif;color:#17212b}h1{font-size:22px}h2{font-size:15px;margin:0 0 10px}section{break-inside:avoid;border:1px solid #ccc;padding:12px;margin:12px 0}dl{display:grid;grid-template-columns:130px 1fr;margin:0;gap:5px}dt{font-weight:bold}dd{margin:0;overflow-wrap:anywhere}.controls{margin-bottom:16px}@media print{.controls{display:none}}'
        + '</style></head><body><div class="controls">Choose Save as PDF in the print dialog. <button onclick="window.print()">Print / Save PDF</button></div><h1>10X Members report</h1><p>'
        + rows.length + ' members matching your selected filters | ' + escape(new Date().toLocaleString('en-NG')) + '</p>' + (content || '<p>No matching members.</p>') + '</body></html>');
      report.document.close();
      report.focus();
      report.print();
    } catch (error) { if (!report.closed) report.close(); setError(error.message); }
    finally { setExportingPdf(false); }
  };

  useEffect(() => { api.get('/geo').then(setGeo).catch(() => {}); }, []);
  useEffect(() => {
    if (me.permissions.can_see_compliance) api.get('/nominations').then(r => setReportCandidates(r.rows || [])).catch(e => setError(e.message));
  }, [me.permissions.can_see_compliance]);
  const downloadReport = (detail) => {
    const qs = new URLSearchParams();
    if (reportCandidate) qs.set('candidate_id', reportCandidate);
    if (detail) qs.set('detail', detail);
    downloadCsv('/export/candidate-follow-up.csv?' + qs, detail ? 'kwarax10-candidate-polling-unit-follow-up.csv' : 'kwarax10-candidate-follow-up.csv');
  };

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams({ limit: PAGE, offset });
    for (const [k, v] of Object.entries(filters)) if (v) qs.set(k, v);
    try {
      setData(await api.get('/members?' + qs));
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [filters, offset]);

  useEffect(() => { load(); }, [load]);

  const set = key => event => {
    const value = event.target.value;
    setDraft(previous => key === 'lga' ? { ...previous, lga: value, ward: '' } : { ...previous, [key]: value });
  };
  const applyFilters = () => {
    const from = dateFrom ? new Date(dateFrom + '+01:00') : null;
    const before = dateBefore ? new Date(dateBefore + '+01:00') : null;
    if ((from && !Number.isFinite(from.getTime())) || (before && !Number.isFinite(before.getTime())) || (from && before && from >= before)) {
      setError('Choose valid dates, with the end time later than the start time.'); return;
    }
    setError(''); setOffset(0);
    setFilters({ ...draft, registered_from: from?.toISOString() || '', registered_before: before?.toISOString() || '' });
  };
  const clearFilters = () => {
    const cleared = Object.fromEntries(Object.keys(draft).map(key => [key, key === 'sort' ? 'created_at' : key === 'direction' ? 'desc' : '']));
    setDraft(cleared); setFilters(cleared); setDateFrom(''); setDateBefore(''); setOffset(0); setError(''); setNotice('');
  };
  const wards = geo && draft.lga ? (geo.wards[draft.lga] || []) : [];
  const updateVerification = async () => {
    setApplying(true);setError('');setNotice('');
    try {
      const result=await api.post('/members/update-voter-verification',{filters});
      setNotice(`${num(result.updated)} members checked; ${num(result.assigned)} with resolved polling units.`);
      await load();
    } catch(e){setError(e.message);}finally{setApplying(false);}
  };
  const applyReport = async (event) => {
    const file = event.target.files?.[0]; if (!file) return;
    setApplying(true); setError(''); setNotice('');
    try {
      const form = new FormData(); form.append('file', file);
      const result = await api.post('/members/verification-report', form);
      setNotice(`${num(result.updated)} members checked; ${num(result.assigned)} with resolved polling units.`);
      await load();
    } catch (e) { setError(e.message); }
    finally { setApplying(false); event.target.value = ''; }
  };

  return (
    <>
      {error && <Alert type="error" onClose={() => setError('')}>{error}</Alert>}
      {notice && <Alert onClose={() => setNotice('')}>{notice}</Alert>}
      {(me.permissions.can_see_compliance || isCandidateRole(me.user.role)) && <Card title="Candidate follow-up report"
        note="Download candidate details, nomination targets and progress, polling units and wards covered or remaining, voter totals, projects and PDP counts (nominees + grassroots). These reports cover the full candidate network, independently of the member filters below.">
        <div className="btn-row">
          {me.permissions.can_see_compliance && <select aria-label="Candidate follow-up report" value={reportCandidate} onChange={e => setReportCandidate(e.target.value)}>
            <option value="">All candidates</option>
            {reportCandidates.map(c => <option key={c.id} value={c.id}>{c.full_name} · {c.office} · {c.scope_value}</option>)}
          </select>}
          <button className="btn secondary sm" onClick={() => downloadReport()}>Download candidate report</button>
          <button className="btn secondary sm" onClick={() => downloadReport('units')}>Download polling-unit follow-up</button>
        </div>
      </Card>}
      {me?.permissions?.is_admin && (
        <Card title="Voter verification" note="Check every member matching the current filters against the uploaded voter register. Unit 1, PU 1, 001 and recognised addresses resolve within their LGA and ward. Ambiguous locations need correction. Candidate login accounts are not checked.">
          <button className="btn" disabled={applying || loading} onClick={updateVerification}>{applying?'Checking members…':'Update voter verification'}</button>
          <label>Verification report <input type="file" accept=".json" disabled={applying} onChange={applyReport} /></label>
          {applying && <span className="muted"> Applying verification and polling-unit assignments…</span>}
        </Card>
      )}

      <div className="toolbar">
        {me?.permissions?.is_admin&&<button className={'btn sm '+(editMode?'':'secondary')} disabled={!geo} aria-pressed={editMode} onClick={()=>setEditMode(v=>!v)}>{editMode?'Exit edit mode':'Edit mode'}</button>}
        {me?.permissions?.is_admin && <button className="btn sm secondary" onClick={()=>setContactUpload(true)}>Upload verified data</button>}
        <input type="text" placeholder="Search name, phone, code or polling unit"
               value={draft.q} onChange={set('q')} style={{ minWidth: 280 }} />
        <select aria-label="Contact centre result" value={draft.contact_verification_status} onChange={set('contact_verification_status')}>
          <option value="">All contact centre results</option>
          {['not_called','verified','unreachable','incorrect_details','declined','pending'].map(value=><option key={value} value={value}>{value.replaceAll('_',' ')}</option>)}
        </select>
        <select aria-label="Phone completeness" value={draft.phone_quality} onChange={set('phone_quality')}>
          <option value="">All phone numbers</option>
          <option value="incomplete">Incomplete / invalid phone number</option>
          <option value="missing">Missing phone number</option>
          <option value="complete">Complete phone number</option>
        </select>
        <select aria-label="Account details" value={draft.account_presence} onChange={set('account_presence')}>
          <option value="">All accounts</option><option value="missing">Missing account number</option>
        </select>
        <select aria-label="VIN presence" value={draft.vin_presence} onChange={set('vin_presence')}>
          <option value="">All VIN records</option><option value="missing">Missing VIN (promoters / grassroots)</option>
        </select>
        <select value={draft.polling_unit_presence} onChange={set('polling_unit_presence')}>
          <option value="">All polling-unit assignments</option>
          <option value="with">With polling unit</option>
          <option value="without">No resolved polling unit</option>
        </select>
        <select value={draft.vin_verification_status} onChange={set('vin_verification_status')}>
          <option value="">Any VIN verification</option>
          {Object.entries(VIN_STATUSES).map(([key,label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <select value={draft.level} onChange={set('level')}>
          {LEVELS.map((l) => (
            <option key={l} value={l}>{l ? LEVEL_LABEL[l] : 'Any level'}</option>
          ))}
        </select>
        <select value={draft.upline_user_id} onChange={set('upline_user_id')}>
          <option value="">Any candidate / registered by</option>
          {(data?.owners || []).map(owner => <option key={owner.id} value={owner.id}>{owner.full_name} ({owner.username})</option>)}
        </select>
        {geo && (
          <select value={draft.lga} onChange={set('lga')}>
            <option value="">Any LGA</option>
            {geo.lgas.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        )}
        {wards.length > 0 && (
          <select value={draft.ward} onChange={set('ward')}>
            <option value="">Any ward</option>
            {wards.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        )}
        <select aria-label="Sort members by" value={draft.sort} onChange={event => {
          const sort = event.target.value;
          setDraft(previous => ({ ...previous, sort, direction: ['issues', 'created_at'].includes(sort) ? 'desc' : 'asc' }));
        }}>
          {[['created_at','Date added'],['name','Name'],['phone','Phone'],['account','Account number'],['account_name','Account name'],['bank','Bank'],['issues','Issues (number of outstanding items)'],['vin','VIN'],['lga','LGA'],['ward','Ward'],['polling_unit','Polling unit'],['registered_by','Registered by']].map(([value,label]) => <option key={value} value={value}>Sort by {label}</option>)}
        </select>
        <select aria-label="Sort direction" value={draft.direction} onChange={set('direction')}>
          <option value="asc">Ascending / fewest first</option>
          <option value="desc">Descending / most first</option>
        </select>
        <label>Registered from (Lagos time)<input type="datetime-local" step="1" value={dateFrom} onChange={event => setDateFrom(event.target.value)} /></label>
        <label>Registered before (Lagos time)<input type="datetime-local" step="1" value={dateBefore} onChange={event => setDateBefore(event.target.value)} /></label>
        <button className="btn sm" onClick={applyFilters}>Apply</button>
        <button className="btn secondary sm" onClick={clearFilters}>Clear</button>
        <div className="spacer" />
        <button className="btn secondary sm" disabled={exportingCsv} onClick={() => exportCsv('issues')}>Export issues for correction</button>
        <button className="btn secondary sm" disabled={exportingCsv} onClick={() => exportCsv('nominees')}>Export nominees</button>
        <button className="btn secondary sm" disabled={exportingCsv} onClick={() => exportCsv()}>
          {exportingCsv ? 'Preparing CSV...' : 'Export CSV'}
        </button>
        <button className="btn secondary sm" onClick={exportPdf} disabled={exportingPdf || loading || !data?.total}>
          {exportingPdf ? 'Preparing PDF...' : 'Export PDF'}
        </button>
      </div>

      {(filters.registered_from || filters.registered_before) && <p className="muted">
        Applied registration window (Lagos): {filters.registered_from ? new Date(filters.registered_from).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' }) : 'Any start'} to before {filters.registered_before ? new Date(filters.registered_before).toLocaleString('en-NG', { timeZone: 'Africa/Lagos' }) : 'Any end'}. Use this end time as the next batch start to avoid overlap.
      </p>}
      <Card
        title={data ? num(data.total) + ' member' + (data.total === 1 ? '' : 's') : 'Members'}
        note="Records you can see are limited to your constituency or network branch"
        bodyClass=""
      >
        {loading && !data ? <Loading /> : !data || data.rows.length === 0 ? (
          <Empty title="No members match these filters">
            Adjust the filters, or register someone from the Register member page.
          </Empty>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Code</th><th>Name</th><th>Phone</th><th>Bank</th><th>Account name</th><th>Account number</th><th>Level</th>
                    <th>LGA / Ward</th><th>Polling unit</th>
                    <th>VIN</th><th>Contact centre result</th><th>Issues</th><th>What to do</th><th>Registered by</th><th>Added</th>{me?.permissions?.is_admin && <th>Edit</th>}{editMode&&me?.permissions?.is_admin&&<th>Edit location</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((m) => (
                    <tr key={m.id}>
                      <td className="mono">{m.code}</td>
                      <td style={{ fontWeight: 600 }}>
                        <Link to={'/members/' + m.id}>
                          {m.title ? m.title + ' ' : ''}{[m.first_name,m.last_name].filter(Boolean).join(' ') || 'Name missing'}
                        </Link>
                      </td>
                      <td className="mono">{m.phone}</td>
                      <td>{m.bank_name || '--'}</td>
                      <td>{m.account_name || '--'}</td>
                      <td className="mono nowrap">{m.account_number || '--'}</td>
                      <td><span className="badge">{LEVEL_LABEL[m.level] || m.level}</span></td>
                      <td>
                        <div>{m.lga}</div>
                        <div className="muted" style={{ fontSize: 12 }}>{m.ward}</div>
                      </td>
                      <td className="muted">{m.polling_unit_resolved ? m.polling_unit : <><div>No resolved polling unit</div><small>Submitted: {m.polling_unit || 'Not recorded'}</small></>}</td>
                      <td className="mono">{m.pvc_no || '—'}</td>
                      <td><strong>{(m.contact_verification_status || 'not_called').replaceAll('_',' ')}</strong>
                        <div>{m.contact_verification_notes || ''}</div>
                        {m.contact_verified_by && <small>Caller: {m.contact_verified_by}</small>}
                        {m.contact_verified_at && <div className="muted">{new Date(m.contact_verified_at).toLocaleString('en-NG',{timeZone:'Africa/Lagos'})}</div>}
                      </td>
                      <td style={{ minWidth: 200 }}>{memberFollowUp(m).issues}</td>
                      <td style={{ minWidth: 240 }}>{memberFollowUp(m).actions}</td>
                      <td className="muted">{m.upline_name || '--'}</td>
                      <td className="muted nowrap">{m.created_at || '--'}<div>{timeAgo(m.created_at)}</div></td>
                      {me?.permissions?.is_admin && <td><Link className="btn sm secondary" to={'/members/' + m.id + '?edit=1'}>Edit details</Link></td>}
                      {editMode&&me?.permissions?.is_admin&&<td><button className="btn sm secondary" onClick={()=>setEditing(m)}>Edit ward / PU</button></td>}

                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {data.total > PAGE && (
              <div className="card-body" style={{ borderTop: '1px solid var(--ink-200)' }}>
                <div className="btn-row">
                  <button className="btn sm secondary" disabled={offset === 0}
                          onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                    Previous
                  </button>
                  <span className="muted">
                    {offset + 1}–{Math.min(offset + PAGE, data.total)} of {num(data.total)}
                  </span>
                  <button className="btn sm secondary"
                          disabled={offset + PAGE >= data.total}
                          onClick={() => setOffset(offset + PAGE)}>
                    Next
                  </button>
                  {loading && <span className="spinner dark" />}
                </div>
              </div>
            )}
          </>
        )}
      </Card>
      {contactUpload&&me?.permissions?.is_admin&&<ContactVerificationUpload filters={filters} onClose={()=>setContactUpload(false)} onSaved={async result=>{setNotice(num(result.updated)+' contact centre results saved; '+num(result.corrected)+' members had their details corrected.');await load();}}/>}
      {editing&&geo&&me?.permissions?.is_admin&&<MemberLocationEditor member={editing} geo={geo} onClose={()=>setEditing(null)} onSaved={async result=>{setNotice(num(result.updated)+' member location(s) updated.');await load();}}/>}
    </>
  );
}
