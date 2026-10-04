import {nomineeVerificationLabel} from '../lib/nominee-verification.js';
import {loadWithTimeout} from '../lib/load-with-timeout.js';
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, num, timeAgo } from '../lib/api.js';
import { Card, Stat, Loading, Empty, Alert, Field, Modal } from '../components/ui.jsx';
import { useAuth } from '../App.jsx';
import SheetImport from '../components/SheetImport.jsx';

const BLANK = {
  first_name: '', last_name: '', phone: '', lga: '', ward: '', polling_unit: '',
  pvc_no: '', nin: '', bank_name: '', account_number: '', account_name: '',
};

function NominationTracker({nomination}) {
  if(!nomination)return null;
  if(nomination.unlimited)return <Card title="Promoter allocation"><p>{num(nomination.total_count)} promoters recorded. No fixed numerical target applies to your account.</p></Card>;
  const gaps=(nomination.units||[]).filter(unit=>unit.remaining>0);
  return <Card title="Promoter allocation" note="Total recruitment and distribution across polling units are separate figures.">
    <div className="grid grid-3">
      <Stat label="Total nominees recorded" value={num(nomination.total_count)} accent/>
      <Stat label="Allocated to constituency PUs" value={num(nomination.count)}/>
      <Stat label="Need constituency PU allocation" value={num(nomination.unallocated||0)}/>
      <Stat label="Overall recruitment target" value={num(nomination.quota)} foot={num(nomination.polling_units)+' PUs × '+nomination.per_polling_unit+' promoters'}/>
      <Stat label="PUs with required allocation" value={num(nomination.completed_polling_units)+' / '+num(nomination.polling_units)}/>
      <Stat label="Allocations needed in incomplete PUs" value={num(nomination.remaining)} foot={'Across '+num(gaps.length)+' polling units'}/>
    </div>
    {nomination.remaining>0?<p>{num(nomination.remaining)} promoter allocations are still needed across {num(gaps.length)} polling units with fewer than {nomination.per_polling_unit} promoters. Extra promoters in other units do not fill these location gaps. Existing nominees awaiting allocation can fill a gap when their correct registered location matches that unit.</p>:<p>Every constituency polling unit has the required promoter allocation.</p>}
    {nomination.unallocated>0&&<p>{num(nomination.unallocated)} nominees are not assigned to recognised polling units within your constituency. Check their LGA, ward and polling unit; keep their actual registered location.</p>}
  </Card>;
}

function AddNomineeForm({ geo, onAdded, nomination }) {
  const [form, setForm] = useState(BLANK);
  const [gps, setGps] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const unlimited = nomination?.unlimited;
  const selectedUnit = nomination?.units?.find((u) => u.lga === form.lga && u.ward === form.ward && u.polling_unit === form.polling_unit);
  const remaining = selectedUnit?.remaining ?? nomination?.remaining ?? 0;
  // Full, but not closed. Somebody who really has a fifth Unit Promoter in a
  // unit that allows four should be able to record them -- the register is
  // meant to show who is on the ground. The row is marked instead, so the
  // excess is countable rather than pushed into the next unit along.
  const unitFull = !unlimited && nomination?.quota > 0 && remaining <= 0;

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude,
                         accuracy: Math.round(pos.coords.accuracy) }),
      () => {}
    );
  }, []);

  const set = (k) => (e) => {
    const v = e.target.value;
    setForm((f) => (k === 'lga' ? { ...f, lga: v, ward: '', polling_unit: '' } : k === 'ward' ? { ...f, ward: v, polling_unit: '' } : { ...f, [k]: v }));
  };

  const wards = geo.wards[form.lga] || [];
  const pollingUnits = (geo.polling_units?.[form.lga]?.[form.ward]) || [];
  const ready = ['first_name', 'last_name', 'phone', 'lga', 'ward', ...(unlimited ? [] : ['polling_unit'])].every((k) => String(form[k] || '').trim());

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(''); setResult(null);
    try {
      const res = await api.post('/members', { ...form, level: 'mobiliser', ...(gps || {}) });
      setResult(res);
      setForm(BLANK);
      onAdded();
    } catch (err) {
      setError(err.data?.flags?.map((f) => f.message).join(' · ') || err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Add a nominee"
          note="Every nominee gets their own login automatically, shown once below">
      {result?.login && (
        <Modal title="Nominee account created" onClose={() => setResult(null)} footer={
          <div className="btn-row">
            <button type="button" className="btn sm secondary" title="Copy login details"
              aria-label="Copy login details" onClick={() => navigator.clipboard?.writeText(
                'KWARA X10 login\nLogin link: ' + window.location.origin + '/login\nUsername: '
                + result.login.username + '\nPassword: ' + result.login.password)}>
              ⧉ Copy login details
            </button>
            <button type="button" className="btn secondary" onClick={() => setResult(null)}>Done</button>
          </div>
        }>
          <Alert type="success" title="Share these details now.">
            Login link: <code>{window.location.origin + '/login'}</code><br />
            Username: <code>{result.login.username}</code><br />
            Temporary password: <code>{result.login.password}</code>
          </Alert>
        </Modal>
      )}
      <div className="hint" style={{ marginBottom: 12 }}>
        <span className="badge blue">
          {unlimited ? 'Unlimited' : unitFull ? 'Allowance used up' : remaining + ' remaining'}
        </span>
        <span style={{ marginLeft: 8 }}>
          {unlimited
            ? 'Separate allocation; choose any ward or polling unit in your area.'
            : unitFull
              ? 'You can still add this person — they will be saved and marked as over the allowance.'
              : selectedUnit
                ? nomination.per_polling_unit + ' allowed in this polling unit.'
                : 'Select a polling unit to see its remaining allocation.'}
        </span>
      </div>
      {error && <Alert type="error" onClose={() => setError('')}>{error}</Alert>}
      {result && (
        <Alert type="success" title="Nominee added. " onClose={() => setResult(null)}>
          <div style={{ marginTop: 4 }}>
            Reference <strong className="mono">{result.code}</strong>. Saved for VIN and location verification.
          </div>
        </Alert>
      )}

      <form onSubmit={submit}>
        <div className="grid grid-3">
          <Field label="First name" required>
            <input type="text" value={form.first_name} onChange={set('first_name')} />
          </Field>
          <Field label="Last name" required>
            <input type="text" value={form.last_name} onChange={set('last_name')} />
          </Field>
          <Field label="Phone number" required hint="Nigerian mobile">
            <input type="text" value={form.phone} onChange={set('phone')}
                   placeholder="08031234567" maxLength={14} />
          </Field>
        </div>
        <div className="grid grid-3">
          <Field label="LGA">
            <select value={form.lga} onChange={set('lga')}>
              <option value="">Select an LGA</option>
              {geo.lgas.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </Field>
          <Field label="Ward">
            <select value={form.ward} onChange={set('ward')} disabled={!form.lga}>
              <option value="">Select a ward</option>
              {wards.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          </Field>
          <Field label="Polling unit">
            <select value={form.polling_unit}
                    onChange={(e) => setForm((f) => ({ ...f, polling_unit: e.target.value }))}
                    disabled={!form.ward}>
              <option value="">Select a polling unit</option>
              {pollingUnits.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid grid-3">
          <Field label="PVC / VIN" hint="19 characters">
            <input type="text" value={form.pvc_no}
                   onChange={(e) => setForm((f) => ({ ...f, pvc_no: e.target.value.toUpperCase() }))}
                   maxLength={19} style={{ textTransform: 'uppercase' }} />
          </Field>
          <Field label="Bank">
            <select value={form.bank_name} onChange={set('bank_name')}>
              <option value="">Select a bank</option>
              {geo.banks.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </Field>
          <Field label="Account number" hint="10-digit NUBAN">
            <input type="text" value={form.account_number} onChange={set('account_number')} maxLength={10} />
          </Field>
        </div>
        <Field label="Account name">
          <input type="text" value={form.account_name} onChange={set('account_name')} />
        </Field>

        <button className="btn" disabled={!ready || busy}>
          {busy && <span className="spinner" />}
          {busy ? 'Saving' : unitFull ? 'Add anyway (over the allowance)' : 'Add nominee'}
        </button>
      </form>
    </Card>
  );
}

/**
 * Enter every remaining nominee in one pass.
 *
 * A candidate usually knows all three or four of their Unit Promoters at
 * once, and filling the long single form that many times is the tedious way
 * to do it. This is the same data, laid out as a grid.
 *
 * Each nominee still gets their own generated login, so every one of them is
 * collected and shown together at the end -- those passwords appear once and
 * cannot be read back.
 */
function BulkNomineeForm({ geo, onAdded, remaining, unlimited }) {
  const blankRow = () => ({ ...BLANK });
  const [rows, setRows] = useState(() =>
    Array.from({ length: Math.min(10, Math.max(1, remaining)) }, blankRow));
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState(null);
  const [failures, setFailures] = useState([]);
  const [gps, setGps] = useState(null);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude,
                        accuracy: Math.round(pos.coords.accuracy) }),
      () => {});
  }, []);

  const setCell = (i, key) => (e) => {
    const value = e.target.value;
    setRows((list) => list.map((r, ri) => {
      if (ri !== i) return r;
      if (key === 'lga') return { ...r, lga: value, ward: '', polling_unit: '' };
      if (key === 'ward') return { ...r, ward: value, polling_unit: '' };
      return { ...r, [key]: value };
    }));
  };

  const filled = rows.filter((r) =>
    ['first_name', 'last_name', 'phone', 'lga', 'ward', ...(unlimited ? [] : ['polling_unit'])].every((k) => String(r[k] || '').trim()));

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true); setFailures([]);
    const created = [];
    const failed = [];

    // Collect each result independently; the server enforces quotas atomically.
    for (const row of filled) {
      try {
        const res = await api.post('/members', { ...row, level: 'mobiliser', ...(gps || {}) });
        created.push({ name: row.first_name + ' ' + row.last_name, ...res });
      } catch (err) {
        failed.push({ name: row.first_name + ' ' + row.last_name,
                      reason: err.data?.flags?.map((f) => f.message).join(' · ') || err.message });
      }
    }

    setBusy(false);
    setFailures(failed);
    // Keep any row that failed so it can be corrected, drop the ones that worked.
    setRows(failed.length
      ? rows.filter((r) => failed.some((f) => f.name === r.first_name + ' ' + r.last_name))
      : Array.from({ length: Math.min(10, Math.max(1, remaining - created.length)) }, blankRow));
    if (created.length) { setIssued(created); onAdded(); }
  };

  const copyAll = () => {
    const text = issued.map((c) => [c.name, c.login?.username, c.login?.password]
      .filter(Boolean).join('  ')).join('\n');
    navigator.clipboard?.writeText('KWARA X10 nominee logins\n'
      + 'Login link: ' + window.location.origin + '/login\n\n' + text);
  };

  return (
    <Card title="Add nominees in a batch"
          note="Fill a row per nominee, including LGA and ward. Legislative nominees also require a polling unit.">
      {issued && (
        <Modal title={issued.length + ' nominee account'
                      + (issued.length === 1 ? '' : 's') + ' created'}
               onClose={() => setIssued(null)}
               footer={
                 <div className="btn-row">
                   <button type="button" className="btn sm secondary" onClick={copyAll}>
                     ⧉ Copy all logins
                   </button>
                   <button type="button" className="btn secondary"
                           onClick={() => setIssued(null)}>Done</button>
                 </div>
               }>
          <Alert type="success" title="Share these now. ">
            Each password is shown once and cannot be read back afterwards.
          </Alert>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Nominee</th><th>Username</th><th>Password</th></tr></thead>
              <tbody>
                {issued.map((c) => (
                  <tr key={c.code}>
                    <td>{c.name}</td>
                    <td className="mono">{c.login?.username || '—'}</td>
                    <td className="mono">{c.login?.password || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}

      {failures.length > 0 && (
        <Alert type="error" title="Some nominees were not added. "
               onClose={() => setFailures([])}>
          <ul style={{ margin: '6px 0 0 16px' }}>
            {failures.map((f) => <li key={f.name}>{f.name}: {f.reason}</li>)}
          </ul>
          Those rows are still below so you can correct them.
        </Alert>
      )}

      <form onSubmit={submit}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ minWidth: 130 }}>First name *</th>
                <th style={{ minWidth: 130 }}>Last name *</th>
                <th style={{ minWidth: 130 }}>Phone *</th>
                <th style={{ minWidth: 130 }}>LGA</th>
                <th style={{ minWidth: 150 }}>Ward</th>
                <th style={{ minWidth: 190 }}>Polling unit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td><input type="text" value={r.first_name} onChange={setCell(i, 'first_name')} /></td>
                  <td><input type="text" value={r.last_name} onChange={setCell(i, 'last_name')} /></td>
                  <td><input type="text" value={r.phone} onChange={setCell(i, 'phone')}
                             placeholder="08031234567" maxLength={14} /></td>
                  <td>
                    <select value={r.lga} onChange={setCell(i, 'lga')}>
                      <option value="">—</option>
                      {geo.lgas.map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={r.ward} onChange={setCell(i, 'ward')} disabled={!r.lga}>
                      <option value="">—</option>
                      {(geo.wards[r.lga] || []).map((w) => <option key={w} value={w}>{w}</option>)}
                    </select>
                  </td>
                  <td><select value={r.polling_unit} onChange={setCell(i, 'polling_unit')} disabled={!r.ward}>
                    <option value="">Select a polling unit</option>
                    {(geo.polling_units?.[r.lga]?.[r.ward] || []).map((p) => <option key={p} value={p}>{p}</option>)}
                  </select></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="btn-row" style={{ marginTop: 12, alignItems: 'center' }}>
          <button className="btn" disabled={busy || filled.length === 0}>
            {busy && <span className="spinner" />}
            {busy ? 'Adding' : 'Add ' + filled.length + ' nominee' + (filled.length === 1 ? '' : 's')}
          </button>
          {rows.length < Math.min(200, remaining) && (
            <button type="button" className="btn sm secondary"
                    onClick={() => setRows([...rows, blankRow()])}>+ Another row</button>
          )}
          <span className="muted" style={{ fontSize: 12 }}>
            {filled.length} of {rows.length} row{rows.length === 1 ? '' : 's'} ready
          </span>
        </div>
      </form>
    </Card>
  );
}

function MyNomineesList({ rows }) {
  return (
    <Card title="Your nominees" bodyClass="" style={{ marginTop: 16 }}>
      {rows.length === 0 ? (
        <Empty title="No nominees added yet">
          Use the form above to add your first Unit Promoter.
        </Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th><th>LGA</th><th>Ward</th><th>Polling unit</th>
                <th>VIN/location check</th><th>Added</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td style={{ fontWeight: 600 }}>
                    <Link to={'/members/' + m.id}>{m.first_name} {m.last_name}</Link>
                    <div className="muted mono" style={{ fontSize: 11 }}>{m.code}</div>
                  </td>
                  <td>{m.lga}</td>
                  <td className="muted">{m.ward}</td>
                  <td className="muted">{m.polling_unit}</td>
                  <td>{nomineeVerificationLabel(m)}</td>
                  <td className="muted nowrap">{timeAgo(m.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function DisparityReportForm() {
  const [report, setReport] = useState(undefined);
  const [disparities, setDisparities] = useState('');
  const [challenges, setChallenges] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.get('/disparity-report').then((d) => {
      setReport(d.report);
      setDisparities(d.report?.disparities || '');
      setChallenges(d.report?.challenges || '');
    }).catch((e) => setError(e.message));
  }, []);

  const submit = async () => {
    setBusy(true); setError(''); setSaved(false);
    try {
      const d = await api.post('/disparity-report', { disparities, challenges });
      setReport(d.report);
      setSaved(true);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  if (report === undefined) return null;

  return (
    <div style={{ marginTop: 16 }}>
      <Card title="Report disparities & challenges"
            note="Required by the Campaign Council directive — due 16 September 2026">
        {error && <Alert type="error" onClose={() => setError('')}>{error}</Alert>}
        {saved && (
          <Alert type="success" onClose={() => setSaved(false)}>
            Submitted. The Campaign Council can now see this.
          </Alert>
        )}
        {report?.reviewed_at && (
          <Alert type="info">
            Reviewed by leadership{report.review_note ? ': "' + report.review_note + '"' : '.'}
          </Alert>
        )}
        <Field label="Party / candidate disparities"
               hint="Issues relating to disparities between the party and its candidates, or anything else affecting your campaign's effectiveness">
          <textarea value={disparities} onChange={(e) => setDisparities(e.target.value)}
                    rows={4} placeholder="Describe the disparities affecting your campaign..." />
        </Field>
        <Field label="Challenges in your constituency"
               hint="Challenges confronting you, in enough detail for the Council to assess and intervene">
          <textarea value={challenges} onChange={(e) => setChallenges(e.target.value)}
                    rows={4} placeholder="Describe the challenges you're facing..." />
        </Field>
        <button className="btn" onClick={submit}
                disabled={busy || (!disparities.trim() && !challenges.trim())}>
          {busy && <span className="spinner" />} {report ? 'Update submission' : 'Submit to Campaign Council'}
        </button>
        {report?.updated_at && (
          <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
            Last updated {timeAgo(report.updated_at)}
          </div>
        )}
      </Card>
    </div>
  );
}

function ImportNominees({ onClose, onSaved }) {
  return (
    <SheetImport
      title="Upload a nominee list"
      noun="nominee"
      endpoint="/members/import"
      templatePath="/members/template.xlsx"
      templateName="nominees.xlsx"
      onClose={onClose}
      onSaved={onSaved}
      guidance={
        <>
          <p className="hint">
            One row per person. Add the name and whatever details you have; phone,
            location and PVC information can be corrected after saving.
          </p>
          <p className="hint">
            If you have more people than your allowance, put them in anyway. Nobody
            is turned away — rows over the allowance are still saved, just marked.
          </p>
        </>
      }
      duplicateHint="If one of them really is a different person, change what makes them different — their phone, or their polling unit — and upload again."
      describe={(r) => r.nominee && (
        <>
          <strong>{r.nominee.first_name} {r.nominee.last_name}</strong>
          {r.duplicate && <span className="badge red" style={{ marginLeft: 6 }}>duplicate</span>}
          {r.unverified && <span className="badge amber" style={{ marginLeft: 6 }}>PVC to verify</span>}
          {r.over_quota && <span className="badge amber" style={{ marginLeft: 6 }}>over</span>}
          <div className="muted" style={{ fontSize: 11 }}>
            {r.nominee.phone} · {r.nominee.polling_unit}
          </div>
        </>
      )}
      afterSave={(done) => (done.logins?.length > 0 || done.failed?.length > 0) && (
        <>
          {done.failed?.length > 0 && (
            <p className="hint">
              {num(done.failed.length)} could not be saved after all — usually a phone
              number already on the register: {done.failed.slice(0, 5)
                .map((f) => 'row ' + f.line).join(', ')}
              {done.failed.length > 5 ? ' and others' : ''}.
            </p>
          )}
          {done.logins?.length > 0 && (
            <>
              <div className="section-title">Their logins</div>
              <p className="hint">
                These passwords are shown once and cannot be read back. Copy them now
                and give each person their own.
              </p>
              <button className="btn sm secondary" onClick={() => navigator.clipboard.writeText(
                done.logins.map((l) => [l.name, l.username, l.password].join('\t')).join('\n'))}>
                Copy all logins
              </button>
              <div className="table-wrap" style={{ maxHeight: 220, overflowY: 'auto', marginTop: 8 }}>
                <table>
                  <thead><tr><th>Name</th><th>Username</th><th>Password</th></tr></thead>
                  <tbody>
                    {done.logins.map((l) => (
                      <tr key={l.username}>
                        <td>{l.name}{l.over_quota && (
                          <span className="badge amber" style={{ marginLeft: 6 }}>over</span>)}</td>
                        <td><code>{l.username}</code></td>
                        <td><code>{l.password}</code></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    />
  );
}

export default function MyNominations() {
  const { me, reload } = useAuth();
  const [geo, setGeo] = useState(null);
  const [nominees, setNominees] = useState(null);
  const [nomineeTotal,setNomineeTotal]=useState(0);
  const [summary,setSummary]=useState(null);
  const [error, setError] = useState('');
  const [geoError,setGeoError]=useState('');
  const [nomineeError,setNomineeError]=useState('');
  // Default to the grid when more than one is still owed -- that is the case
  // where entering them one by one is the tedious path.
  const nomination=summary?.nomination;
  const formNomination=nomination||me.nomination;
  const remaining = formNomination?.unlimited ? 200 : (formNomination?.remaining || 0);
  const [mode, setMode] = useState('one');
  const [importing, setImporting] = useState(false);

  const loadNominees = () => {
    setNomineeError('');
    return loadWithTimeout(()=>api.get('/members?mine=1&level=mobiliser&limit=500&include_nomination_summary=1'))
      .then(d=>{if(!Array.isArray(d.rows))throw new Error('Could not load your nominee list. Please retry.');setNominees(d.rows);setNomineeTotal(Number(d.total??d.rows.length));setSummary({nomination:d.nomination,verification:d.verification});})
      .catch(e=>setNomineeError(e.message));
  };
  const loadGeo=()=>{
    setGeoError('');
    return loadWithTimeout(()=>api.get('/geo')).then(result=>{
      if(!Array.isArray(result.lgas)||!result.wards)throw new Error('Could not load locations. Please retry.');
      setGeo(result);
    }).catch(e=>setGeoError(e.message));
  };
  useEffect(()=>{loadGeo();loadNominees();},[]);
  const onAdded=()=>{loadNominees();reload();};
  if(!geo)return <>
    {geoError?<><Alert type="error">{geoError}</Alert><button className="btn secondary" onClick={()=>{api.refresh();loadGeo();}}>Retry locations</button></>:<Loading label="Loading locations for the nominee form"/>}
  </>;

  return (
    <>
      <div style={{ marginBottom: 18 }}>
        <div className="eyebrow">KWARA X10 programme</div>
        <h1>My nominations</h1>
        <div className="card-note">
          Nominate your Unit Promoters and report to the Campaign Council from here.
        </div>
      </div>

      {error && <Alert type="error" onClose={() => setError('')}>{error}</Alert>}

      <NominationTracker nomination={nomination} />

      {summary?.verification && <Card title="VIN and location verification" note={'These counts cover all '+num(nomineeTotal)+' nominees. The table shows the latest '+num(nominees?.length||0)+' records.'}>
        <div className="grid grid-3">
          <Stat label="VIN/location matched" value={num(summary.verification.verified)} foot="VIN found and submitted location matched"/>
          <Stat label="Not checked yet" value={num(summary.verification.not_checked)} foot="Waiting for a voter-register check"/>
          <Stat label="Need correction or clarification" value={num(summary.verification.needs_correction)} foot="Missing VIN, unmatched VIN or a location/identity issue"/>
        </div>
        <p><strong>Not checked yet</strong> means the system has not compared the nominee's VIN and location with the uploaded voter register. It does not mean the details are wrong. Ask the administrator to run <strong>Update voter verification</strong> on the Members page.</p>
        <dl className="kv">
          <dt>Missing VIN: {num(summary.verification.missing_vin)}</dt><dd>Obtain the correct VIN from the nominee's voter card and update the record.</dd>
          <dt>VIN not found: {num(summary.verification.vin_not_found)}</dt><dd>Check the VIN for typing errors and confirm the relevant voter register has been uploaded. No match does not by itself prove the nominee is unregistered.</dd>
          <dt>Location differs: {num(summary.verification.location_mismatch)}</dt><dd>The submitted LGA, ward or PU differed from the voter register. Confirm the registered location and recheck after correction.</dd>
          <dt>Needs clarification: {num(summary.verification.needs_review)}</dt><dd>Review duplicate VINs, conflicting register locations or a PU that cannot be resolved. The nominee remains recorded while this is checked.</dd>
        </dl>
        <Link className="btn sm secondary" to="/network">View and export correction list</Link>
      </Card>}

      <div className="toolbar" style={{ marginBottom: 10, gap: 8 }}>
        <div className="pill-row">
          <button className={'pill' + (mode === 'one' ? ' active' : '')}
                  onClick={() => setMode('one')}>One at a time</button>
          <button className={'pill' + (mode === 'all' ? ' active' : '')}
                  onClick={() => setMode('all')}>Add a batch</button>
        </div>
        <div className="spacer" />
        <button className="btn sm secondary" onClick={() => setImporting(true)}>
          Upload a list
        </button>
      </div>

      {importing && (
        <ImportNominees onClose={() => setImporting(false)} onSaved={onAdded} />
      )}

      {mode === 'all' ? (
        <BulkNomineeForm geo={geo} onAdded={onAdded} remaining={remaining} unlimited={formNomination?.unlimited} />
      ) : (
        <AddNomineeForm
          geo={geo}
          onAdded={onAdded}
          nomination={formNomination}
        />
      )}
      {nomineeError&&<><Alert type="error">{nomineeError}</Alert><button className="btn secondary" onClick={loadNominees}>Retry nominee list</button></>}
      {nominees?<MyNomineesList rows={nominees}/>:!nomineeError&&<Loading label="Loading existing nominees — you can add a nominee above"/>}
      <DisparityReportForm />
    </>
  );
}
