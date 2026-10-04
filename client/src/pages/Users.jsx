import ReassignPromoters from '../components/ReassignPromoters.jsx';
import React, { useEffect, useState } from 'react';
import { api, downloadCsvPost, num, timeAgo, ROLE_LABEL, normalizeRole } from '../lib/api.js';
import { Card, Status, Loading, Empty, Alert, Field, Modal, Stat } from '../components/ui.jsx';
import VoterRollLoader from '../components/VoterRollLoader.jsx';
import UploadForCandidate from '../components/UploadForCandidate.jsx';
import { useAuth } from '../App.jsx';

const ROLES = ['candidate', 'admin', 'campaign_admin', 'unit_promoter', 'grassroot'];
const EDIT_ROLES = ['candidate', 'admin', 'campaign_admin', 'unit_promoter', 'grassroot', 'mobiliser'];
const SCOPES = [
  { v: 'state', label: 'Whole state (all 16 LGAs)' },
  { v: 'senatorial', label: 'Senatorial district' },
  { v: 'federal', label: 'Federal constituency' },
  { v: 'state_const', label: 'State constituency' },
  { v: 'lga', label: 'Single LGA' },
  { v: 'ward', label: 'Single ward' },
  { v: 'polling_unit', label: 'Single polling unit' },
];
const OFFICES = ['Governor', 'Deputy Governor', 'Stakeholder', 'Senator',
  'House of Representatives', 'House of Assembly'];

// A Stakeholder contests nothing, so no seat defines their boundary -- the
// programme office picks one. Every other office is fixed by the seat.
// Deputy Governor shares the Governor's ticket and is always statewide.
const isStakeholder = (office) => String(office || '').trim().toLowerCase() === 'stakeholder';

const scopeForOffice = (office) => {
  const value = String(office || '').toLowerCase();
  if (isStakeholder(office)) return null;   // chosen, not derived
  if (value.includes('governor')) return 'state';
  if (value.includes('senator')) return 'senatorial';
  if (value.includes('representative')) return 'federal';
  if (value.includes('assembly')) return 'state_const';
  return 'state';
};

const usernamePart = (value) => String(value || 'state').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'state';

function NewUser({ geo, onClose, onSaved }) {
  const [u, setU] = useState({
    username: '', full_name: '', phone: '', role: 'candidate',
    office: 'Senator', scope_type: 'senatorial', scope_value: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(null);
  const [pollingLocation, setPollingLocation] = useState({ lga: '', ward: '' });

  const set = (k) => (e) => {
    const v = e.target.value;
    setU((s) => ({
      ...s,
      [k]: v,
      // scopeForOffice returns null for a Stakeholder: leave whatever scope
      // was chosen rather than forcing one from a seat they do not contest.
      ...(k === 'office' && s.role === 'candidate'
        ? (scopeForOffice(v)
            ? { scope_type: scopeForOffice(v), scope_value: '' }
            : { scope_value: '' })
        : {}),
      ...(k === 'scope_type' ? { scope_value: '' } : {}),
      ...(k === 'role' && v !== 'candidate' ? { office: '' } : {}),
      ...(k === 'role' && v === 'mobiliser'
        ? { scope_type: 'polling_unit', scope_value: '' } : {}),
    }));
  };

  const pollingWards = geo?.polling_units?.[pollingLocation.lga] || {};
  const pollingUnits = pollingWards[pollingLocation.ward] || [];
  const setPollingLocationField = (key) => (e) => {
    const next = { ...pollingLocation, [key]: e.target.value };
    if (key === 'lga') next.ward = '';
    setPollingLocation(next);
    setU((s) => ({ ...s, scope_value: '' }));
  };
  const setPollingUnit = (e) => {
    setU((s) => ({ ...s, scope_value: [pollingLocation.lga, pollingLocation.ward, e.target.value].join('|') }));
  };

  const options = !geo ? [] :
    u.scope_type === 'senatorial' ? geo.senatorial :
    u.scope_type === 'federal' ? geo.federal :
    u.scope_type === 'state_const' ? geo.state_const :
    u.scope_type === 'lga' ? geo.all_lgas :
    u.scope_type === 'ward' ? Object.values(geo.wards).flat() : [];

  const save = async () => {
    setBusy(true); setError('');
    try { setCreated(await api.post('/users', u)); onSaved(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const ready = (u.role === 'candidate' || u.username.trim()) && u.full_name.trim()
    && (u.role !== 'mobiliser' || (u.phone.trim() && u.scope_value.split('|').every(Boolean)));

  if (created) {
    return (
      <Modal title="Login created" onClose={onClose}>
        <Alert type="success" title="Share these details with the account holder. ">
          They will be asked to change the password after signing in.
        </Alert>
        <dl className="kv">
          <dt>Username</dt><dd className="mono">{created.username}</dd>
          <dt>Password</dt><dd className="mono">{created.password}</dd>
        </dl>
        <div className="btn-row" style={{ marginTop: 14 }}>
          <CopyButton label="Copy login details"
            text={'KWARA X10 login\nLogin link: ' + window.location.origin + '/login\nUsername: '
              + created.username + '\nPassword: ' + created.password} />
          <button className="btn secondary" onClick={onClose}>Done</button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Create a login" onClose={onClose} footer={
      <div className="btn-row">
        <button className="btn" onClick={save}
          disabled={busy || !ready}>
          {busy && <span className="spinner" />} Create login
        </button>
        <button className="btn secondary" onClick={onClose}>Cancel</button>
      </div>
    }>
      {error && <Alert type="error">{error}</Alert>}
      <Alert type="info">
        A password is generated automatically and shown once. The account
        holder can sign in immediately. Unit Promoter accounts are created from
        the Add network page so they are linked to a member profile.
      </Alert>

      <div className="grid grid-2">
        {u.role === 'candidate' ? (
          <Field label="Generated username" hint="Created automatically from office and constituency">
            <input type="text" value={'candidate-' + usernamePart(u.office || 'office')
              + '-' + usernamePart(u.scope_value)} disabled />
          </Field>
        ) : (
          <Field label="Username" required hint="Lowercase, no spaces">
            <input type="text" value={u.username} onChange={set('username')}
                   placeholder="team.member" />
          </Field>
        )}
        <Field label="Full name" required>
          <input type="text" value={u.full_name} onChange={set('full_name')} />
        </Field>
      </div>
      <div className="grid grid-2">
        <Field label="Role">
          <select value={u.role} onChange={set('role')}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r] || r}</option>)}
          </select>
        </Field>
        <Field label="Phone">
          <input type="text" value={u.phone} onChange={set('phone')} />
        </Field>
      </div>
      {u.role === 'candidate' && (
        <Field label="Office / stakeholder" hint="Stakeholders are not contesting; they have candidate permissions and unlimited nominations.">
          <select value={u.office} onChange={set('office')}>
            {OFFICES.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </Field>
      )}
      <div className="grid grid-2">
        <Field label="Data they can see"
               hint={u.role === 'candidate'
                 ? (isStakeholder(u.office)
                     ? 'Choose the area this stakeholder covers — they contest no seat'
                     : 'Set automatically from the office contested')
                 : ''}>
          <select value={u.scope_type} onChange={set('scope_type')}
                  disabled={u.role === 'candidate' && !isStakeholder(u.office)}>
            {SCOPES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
          </select>
        </Field>
        {u.scope_type === 'polling_unit' ? (
          <>
            <Field label="LGA">
              <select value={pollingLocation.lga} onChange={setPollingLocationField('lga')}>
                <option value="">Select an LGA</option>
                {(geo?.lgas || []).map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </Field>
            <Field label="Ward">
              <select value={pollingLocation.ward} onChange={setPollingLocationField('ward')}
                      disabled={!pollingLocation.lga}>
                <option value="">Select a ward</option>
                {Object.keys(pollingWards).map((w) => <option key={w} value={w}>{w}</option>)}
              </select>
            </Field>
            <Field label="Polling unit">
              <select value={u.scope_value.split('|')[2] || ''} onChange={setPollingUnit}
                      disabled={!pollingLocation.ward}>
                <option value="">Select a polling unit</option>
                {pollingUnits.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
              </select>
            </Field>
          </>
        ) : u.scope_type !== 'state' && (
          <Field label="Which one">
            <select value={u.scope_value} onChange={set('scope_value')}>
              <option value="">Select</option>
              {options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </Field>
        )}
      </div>
    </Modal>
  );
}

function EditUser({ user, geo, onClose, onSaved }) {
  const [u, setU] = useState({ ...user });
  const savedLocation = String(user.scope_value || '').split('|');
  const [location, setLocation] = useState({
    lga: user.scope_type === 'polling_unit' ? (savedLocation[0] || '') : '',
    ward: user.scope_type === 'polling_unit' ? (savedLocation[1] || '') : '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key) => (e) => setU((s) => ({ ...s, [key]: e.target.value }));
  useEffect(() => {
    // A ward-scoped Mobiliser is normally a leftover from before Coordinators
    // existed and should be narrowed back to their own polling unit -- unless
    // they were deliberately promoted to Coordinator, in which case the ward
    // (or LGA) scope is the whole point and must be left alone.
    if (!geo || user.role !== 'mobiliser' || user.scope_type !== 'ward' || user.is_coordinator) return;
    const lga = geo.lgas.find((name) => (geo.wards[name] || []).includes(user.scope_value));
    setLocation({ lga: lga || '', ward: user.scope_value || '' });
    setU((s) => ({ ...s, scope_type: 'polling_unit', scope_value: '' }));
  }, [geo, user.role, user.scope_type, user.scope_value, user.is_coordinator]);
  const pollingWards = geo?.polling_units?.[location.lga] || {};
  const pollingUnits = pollingWards[location.ward] || [];
  const save = async () => {
    setBusy(true); setError('');
    try { await api.patch('/users/' + user.id, u); onSaved(); onClose(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={'Edit ' + user.username} onClose={onClose} footer={
      <div className="btn-row"><button className="btn" onClick={save} disabled={busy || !u.full_name.trim()}>
        {busy && <span className="spinner" />} Save changes
      </button><button className="btn secondary" onClick={onClose}>Cancel</button></div>
    }>
      {error && <Alert type="error">{error}</Alert>}
      <div className="grid grid-2">
        <Field label="Full name" required><input value={u.full_name} onChange={set('full_name')} /></Field>
        <Field label="Phone"><input value={u.phone || ''} onChange={set('phone')} /></Field>
        <Field label="Email"><input type="email" value={u.email || ''} onChange={set('email')} /></Field>
      </div>
      <div className="grid grid-2">
        <Field label="Role"><select value={u.role} onChange={(e) => setU((s) => ({
          ...s, role: e.target.value,
          ...(e.target.value === 'mobiliser' ? { scope_type: 'polling_unit', scope_value: '' } : {}),
          ...(e.target.value !== 'candidate' ? { office: null } : {}),
        }))}>
          {EDIT_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r] || r}</option>)}
        </select></Field>
        {u.role === 'candidate' && <Field label="Office"><select value={u.office || ''} onChange={set('office')}>
          {OFFICES.map((o) => <option key={o} value={o}>{o}</option>)}
        </select></Field>}
      </div>
      <Field label="Scope"><select value={u.scope_type} onChange={(e) => {
        const scopeType = e.target.value;
        setU((s) => ({ ...s, scope_type: scopeType, scope_value: '' }));
        setLocation({ lga: '', ward: '' });
      }}>
        {SCOPES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
      </select></Field>
      {u.scope_type === 'polling_unit' ? <>
        <Field label="LGA"><select value={location.lga} onChange={(e) => { setLocation({ lga: e.target.value, ward: '' }); setU((s) => ({ ...s, scope_value: '' })); }}>
          <option value="">Select an LGA</option>{(geo?.lgas || []).map((l) => <option key={l} value={l}>{l}</option>)}
        </select></Field>
        <Field label="Ward"><select value={location.ward} disabled={!location.lga} onChange={(e) => { setLocation((s) => ({ ...s, ward: e.target.value })); setU((s) => ({ ...s, scope_value: '' })); }}>
          <option value="">Select a ward</option>{Object.keys(pollingWards).map((w) => <option key={w} value={w}>{w}</option>)}
        </select></Field>
        <Field label="Polling unit"><select value={u.scope_value?.split('|')[2] || ''} disabled={!location.ward} onChange={(e) => setU((s) => ({ ...s, scope_value: [location.lga, location.ward, e.target.value].join('|') }))}>
          <option value="">Select a polling unit</option>{pollingUnits.map((p) => <option key={p} value={p}>{p}</option>)}
        </select></Field>
      </> : u.scope_type !== 'state' && <Field label="Scope value"><select value={u.scope_value || ''} onChange={set('scope_value')}>
        <option value="">Select</option>{(!geo ? [] : u.scope_type === 'lga' ? geo.all_lgas : u.scope_type === 'ward' ? Object.values(geo.wards).flat() : u.scope_type === 'senatorial' ? geo.senatorial : u.scope_type === 'federal' ? geo.federal : geo.state_const).map((v) => <option key={v} value={v}>{v}</option>)}
      </select></Field>}
    </Modal>
  );
}

function CoordinatorModal({ user, geo, onClose, onSaved }) {
  const [scopeType, setScopeType] = useState('ward');
  const [lga, setLga] = useState('');
  const [ward, setWard] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const wardOptions = geo?.wards?.[lga] || [];

  const save = async () => {
    setBusy(true); setError('');
    try {
      await api.post('/users/' + user.id + '/coordinator', {
        is_coordinator: true,
        scope_type: scopeType,
        scope_value: scopeType === 'ward' ? ward : lga,
      });
      onSaved(); onClose();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const ready = scopeType === 'lga' ? !!lga : !!(lga && ward);

  return (
    <Modal title={'Appoint ' + user.full_name + ' as Coordinator'} onClose={onClose} footer={
      <div className="btn-row">
        <button className="btn" onClick={save} disabled={busy || !ready}>
          {busy && <span className="spinner" />} Appoint coordinator
        </button>
        <button className="btn secondary" onClick={onClose}>Cancel</button>
      </div>
    }>
      {error && <Alert type="error">{error}</Alert>}
      <Alert type="info">
        A Coordinator keeps adding people like any Unit Promoter, but can also see
        and review everyone registered across the area you assign here —
        not just the people they personally added.
      </Alert>
      <Field label="Oversee">
        <select value={scopeType} onChange={(e) => { setScopeType(e.target.value); setWard(''); }}>
          <option value="ward">One ward</option>
          <option value="lga">A whole LGA</option>
        </select>
      </Field>
      <div className="grid grid-2">
        <Field label="LGA" required>
          <select value={lga} onChange={(e) => { setLga(e.target.value); setWard(''); }}>
            <option value="">Select an LGA</option>
            {(geo?.lgas || []).map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </Field>
        {scopeType === 'ward' && (
          <Field label="Ward" required>
            <select value={ward} onChange={(e) => setWard(e.target.value)} disabled={!lga}>
              <option value="">Select a ward</option>
              {wardOptions.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          </Field>
        )}
      </div>
    </Modal>
  );
}

function ExportCredentialsModal({ onClose }) {
  const [role, setRole] = useState('all');
  const [onlyUnused, setOnlyUnused] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const run = async () => {
    setBusy(true); setError('');
    try {
      await downloadCsvPost('/admin/export-credentials',
        { role, only_unused: onlyUnused },
        'kwarax10-credentials-' + role + '.csv');
      setDone(true);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Export login credentials" onClose={onClose} footer={
      <div className="btn-row">
        <button className="btn danger" onClick={run} disabled={busy}>
          {busy && <span className="spinner" />} Reset &amp; download CSV
        </button>
        <button className="btn secondary" onClick={onClose}>
          {done ? 'Done' : 'Cancel'}
        </button>
      </div>
    }>
      {error && <Alert type="error">{error}</Alert>}
      {done && (
        <Alert type="success">
          Downloaded. Every password in that file is live right now — send it
          out promptly.
        </Alert>
      )}
      <Alert type="warn" title="This resets passwords. ">
        A password is only ever shown once when an account is created, so
        this is the only way to recover it later — but it works by
        generating a brand new one. Anyone whose password gets reset here
        will need the new one from this file; their old password stops
        working immediately.
      </Alert>
      <Field label="Which accounts">
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="all">Everyone (except Super Admins)</option>
          <option value="candidate">Candidates only</option>
          <option value="mobiliser">Unit Promoters only</option>
          <option value="admin">Admins only</option>
        </select>
      </Field>
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 4 }}>
        <input type="checkbox" checked={onlyUnused}
               onChange={(e) => setOnlyUnused(e.target.checked)}
               style={{ width: 'auto', marginTop: 2 }} />
        <span style={{ fontSize: 13 }}>
          Only accounts that have never logged in
          <span className="hint" style={{ display: 'block' }}>
            Recommended — leaves alone anyone who has already set their own password.
            Turn this off only if you need to force a reset for everyone, including
            people already using the app.
          </span>
        </span>
      </label>
    </Modal>
  );
}

/** A "Copied!" confirmation that reverts after a moment, so clicking Copy
 * actually tells the admin it worked instead of doing so silently. */
function CopyButton({ text, label = 'Copy' }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard permission denied -- nothing more we can do */ }
  };
  return (
    <button type="button" className="btn sm secondary" onClick={copy}>
      {copied ? '✓ Copied' : label}
    </button>
  );
}

function PasswordResetRequests() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [issued, setIssued] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = () => api.get('/admin/password-reset-requests')
    .then((d) => setRows(d.rows)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const approve = async (r) => {
    setBusy(r.id);
    try {
      const res = await api.post('/admin/password-reset-requests/' + r.id + '/approve');
      setIssued({ username: r.username, password: res.password });
      load();
    } catch (e) { setError(e.message); }
    finally { setBusy(null); }
  };

  const reject = async (r) => {
    setBusy(r.id);
    try { await api.post('/admin/password-reset-requests/' + r.id + '/reject'); load(); }
    catch (e) { setError(e.message); }
    finally { setBusy(null); }
  };

  // The success modal must survive the list becoming empty (which happens
  // the instant a request is approved and reloaded) -- so that check comes
  // first, separate from whether there's anything left to show below it.
  const modal = issued && (
    <Modal title={'New password for ' + issued.username} onClose={() => setIssued(null)}>
      <Alert type="success">Share this with them now — it is shown only once.</Alert>
      <dl className="kv">
        <dt>Username</dt><dd className="mono">{issued.username}</dd>
        <dt>Password</dt><dd className="mono">{issued.password}</dd>
      </dl>
      <div className="btn-row" style={{ marginTop: 10 }}>
        <CopyButton label="Copy password" text={issued.password} />
            <CopyButton label="Copy login details"
              text={'Login link: ' + window.location.origin + '/login\nUsername: '
                + issued.username + '\nPassword: ' + issued.password} />
      </div>
    </Modal>
  );

  if (!rows || rows.length === 0) return modal;

  return (
    <div style={{ marginBottom: 16 }}>
      {error && <Alert type="error" onClose={() => setError('')}>{error}</Alert>}
      {modal}
      <Card title="Password reset requests"
            note="Requested by the account holder after their phone number matched what is on file"
            bodyClass="">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Account</th><th>Role</th><th>Requested</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{r.full_name}</div>
                    <div className="muted mono" style={{ fontSize: 12 }}>{r.username}</div>
                  </td>
                  <td><span className="badge">{ROLE_LABEL[r.role] || r.role}</span></td>
                  <td className="muted nowrap">{timeAgo(r.created_at)}</td>
                  <td>
                    <div className="btn-row">
                      <button className="btn sm" disabled={busy === r.id} onClick={() => approve(r)}>
                        {busy === r.id && <span className="spinner" />} Approve
                      </button>
                      <button className="btn sm danger" disabled={busy === r.id} onClick={() => reject(r)}>
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

/** The register loader, plus how many voters are currently in it. */
function VoterRollPanel() {
  const [loaded, setLoaded] = useState(null);
  const refresh = () => api.get('/admin/status')
    .then((d) => setLoaded(d.voter_roll_rows || 0))
    .catch(() => setLoaded(0));
  useEffect(() => { refresh(); }, []);
  if (loaded === null) return null;
  return <VoterRollLoader loaded={loaded} onLoaded={refresh} />;
}

function Grid3Panel() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState(null);

  useEffect(() => { api.get('/admin/grid3').then(setStatus).catch((e) => setError(e.message)); }, []);

  const done = (r) => { setReport(r); if (r.status) setStatus(r.status); };
  const sync = async () => {
    setBusy(true); setError(''); setReport(null);
    try { done(await api.post('/admin/grid3/sync')); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const upload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true); setError(''); setReport(null);
    try {
      const body = new FormData();
      body.append('file', file);
      done(await api.form('/admin/grid3/upload', body));
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  if (!status) return error ? <Alert type="error">{error}</Alert> : null;

  return (
    <div style={{ marginBottom: 16 }}>
      <Card title="GRID3 ward boundaries"
            note="Outlines the chosen ward on the project map and warns when a project pin is outside it"
            bodyClass="">
        {error && <Alert type="error" onClose={() => setError('')}>{error}</Alert>}
        <div className="toolbar" style={{ marginBottom: 8 }}>
          <span className="muted">
            {num(status.wards_loaded)} of {num(status.total_wards)} wards loaded
            {status.loaded_at ? ' · ' + timeAgo(status.loaded_at) : ''}
          </span>
          <div className="spacer" />
          <button className="btn sm" onClick={sync} disabled={busy}>
            {busy && <span className="spinner" />} Sync from GRID3
          </button>
          <label className="btn sm secondary" style={{ cursor: busy ? 'default' : 'pointer' }}>
            Upload GeoJSON
            <input type="file" accept=".geojson,.json,application/geo+json,application/json"
                   onChange={upload} disabled={busy} style={{ display: 'none' }} />
          </label>
        </div>
        {status.source && <div className="hint">Source: {status.source}</div>}
        {!status.wards_loaded && (
          <div className="hint">
            If the sync cannot reach GRID3, download the Nigeria ward boundaries GeoJSON from
            data.grid3.org and upload it here. Wards outside Kwara State are ignored.
          </div>
        )}
        {report && (
          <Alert type={report.ok ? 'success' : 'warn'} onClose={() => setReport(null)}>
            {report.ok ? 'Matched ' + num(report.matched) + ' wards.' : report.error + '.'}
            {report.unmatched?.length > 0 && (
              ' ' + num(report.unmatched.length) + ' GRID3 wards could not be matched to a ward name: '
              + report.unmatched.slice(0, 12).join('; ') + (report.unmatched.length > 12 ? ' …' : '')
            )}
          </Alert>
        )}
      </Card>
    </div>
  );
}

function ApiKeysPanel() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState(null);

  const load = () => api.get('/admin/api-keys').then((d) => setRows(d.rows)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const create = async () => {
    setBusy(true); setError('');
    try {
      const res = await api.post('/admin/api-keys', { label: label.trim() || 'Untitled integration' });
      setIssued(res);
      setLabel(''); setCreating(false);
      load();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const revoke = async (row) => {
    if (!window.confirm('Revoke "' + row.label + '"? Any integration using this key will stop working immediately.')) return;
    try { await api.post('/admin/api-keys/' + row.id + '/revoke'); load(); }
    catch (e) { setError(e.message); }
  };

  if (!rows) return <Loading label="Loading API keys" />;

  return (
    <div style={{ marginBottom: 16 }}>
      {error && <Alert type="error" onClose={() => setError('')}>{error}</Alert>}
      {issued && (
        <Modal title={'API key created: ' + issued.label} onClose={() => setIssued(null)}>
          <Alert type="success">
            Copy this now — it is shown only once and cannot be recovered later.
          </Alert>
          <dl className="kv">
            <dt>Key</dt><dd className="mono" style={{ wordBreak: 'break-all' }}>{issued.key}</dd>
          </dl>
          <Alert type="info" title="How to use it.">
            Send it as an <code>X-API-Key</code> header on requests to
            <code> /api/external/v1/*</code> — see the integration docs for endpoint details.
          </Alert>
          <div className="btn-row" style={{ marginTop: 10 }}>
            <CopyButton label="Copy key" text={issued.key} />
          </div>
        </Modal>
      )}
      {creating && (
        <Modal title="Create API key" onClose={() => setCreating(false)} footer={
          <div className="btn-row">
            <button className="btn" onClick={create} disabled={busy}>
              {busy && <span className="spinner" />} Create key
            </button>
            <button className="btn secondary" onClick={() => setCreating(false)}>Cancel</button>
          </div>
        }>
          <Field label="Label" hint="What is this key for? e.g. 'Sigar Vote integration'">
            <input type="text" value={label} onChange={(e) => setLabel(e.target.value)}
                   placeholder="Sigar Vote integration" autoFocus />
          </Field>
        </Modal>
      )}

      <Card title="External API keys"
            note="Read-only access to registration, survey and coverage data for outside tools like Sigar Vote"
            bodyClass="">
        <div className="toolbar" style={{ marginBottom: rows.length ? 12 : 0 }}>
          <span className="muted">{num(rows.length)} key{rows.length === 1 ? '' : 's'}</span>
          <div className="spacer" />
          <button className="btn sm" onClick={() => setCreating(true)}>+ Create key</button>
        </div>
        {rows.length === 0 ? (
          <Empty title="No API keys yet">
            Create one to let an outside tool pull registration and survey data through the read-only external API.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Label</th><th>Key</th><th>Created</th><th>Last used</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600 }}>{r.label}</td>
                    <td className="mono muted">{r.key_prefix}…</td>
                    <td className="muted nowrap">{timeAgo(r.created_at)}</td>
                    <td className="muted nowrap">{r.last_used_at ? timeAgo(r.last_used_at) : 'never'}</td>
                    <td>
                      {r.revoked_at
                        ? <span className="badge">revoked</span>
                        : <span className="badge green"><span className="dot" />active</span>}
                    </td>
                    <td>
                      {!r.revoked_at && (
                        <button className="btn sm danger" onClick={() => revoke(r)}>Revoke</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export default function Users() {
  const { me } = useAuth();
  const [rows, setRows] = useState(null);
  const [geo, setGeo] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('all');
  const [creating, setCreating] = useState(false);
  const [reset, setReset] = useState(null);
  const [editing, setEditing] = useState(null);
  const [deletingId,setDeletingId]=useState(null);
  const [reassigning,setReassigning]=useState(null),[notice,setNotice]=useState('');
  const [promoting, setPromoting] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [q, setQ] = useState('');
  const [toolsOpen, setToolsOpen] = useState(false);
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [q, tab]);
  const isDg = normalizeRole(me.user.role) === 'campaign_admin';

  const load = () => api.get('/users').then((d) => setRows(d.rows)).catch((e) => setError(e.message));
  useEffect(() => { load(); api.get('/geo').then(setGeo).catch(() => {}); }, []);

  const doReset = async (u) => {
    try {
      const r = await api.post('/users/' + u.id + '/reset-password');
      setReset({ username: u.username, password: r.password });
    } catch (e) { setError(e.message); }
  };

  const toggle = async (u) => {
    try {
      await api.patch('/users/' + u.id, {
        status: u.status === 'active' ? 'suspended' : 'active',
      });
      load();
    } catch (e) { setError(e.message); }
  };

  const removeAccount = async (u) => {
    if (!window.confirm('Permanently delete the ' + u.username + ' login account? Member records and submitted projects will be retained. This cannot be undone.')) return;
    setDeletingId(u.id); setError('');
    try {
      await api.delete('/users/' + u.id);
      setRows(current=>current.filter(account=>account.id!==u.id));
    } catch (e) { setError(e.message); }
    finally { setDeletingId(null); }
  };

  const removeCoordinator = async (u) => {
    try { await api.post('/users/' + u.id + '/coordinator', { is_coordinator: false }); load(); }
    catch (e) { setError(e.message); }
  };

  if (!rows) return <Loading label="Loading logins" />;

  const byRole = rows.reduce((a, u) => { a[u.role] = (a[u.role] || 0) + 1; return a; }, {});
  const tabFilter = (u) => {
    if (tab === 'all') return true;
    if (tab === 'candidate') return u.role === 'candidate';
    if (tab === 'unit_promoter') return u.role === 'unit_promoter' || u.role === 'mobiliser';
    if (tab === 'grassroot') return u.role === 'grassroot';
    return true;
  };

  const filtered = rows.filter((u) =>
    tabFilter(u) && (!q || (u.username + ' ' + u.full_name + ' ' + (u.scope_value || ''))
      .toLowerCase().includes(q.toLowerCase())));

  const counts = {
    all: rows.length,
    candidate: rows.filter((u) => u.role === 'candidate').length,
    unit_promoter: rows.filter((u) => u.role === 'unit_promoter' || u.role === 'mobiliser').length,
    grassroots: rows.filter((u) => u.role === 'grassroot').length,
  };

  return (
    <>
      {error && <Alert type="error" onClose={() => setError('')}>{error}</Alert>}
      {notice&&<Alert onClose={()=>setNotice('')}>{notice}</Alert>}
      {geo?.pending_state_const?.length > 0 && <Alert type="info">Some Kwara Assembly seats are unavailable until their ward boundaries are verified. Verified seats, senatorial districts and federal constituencies are available.</Alert>}
      {reassigning&&<ReassignPromoters account={reassigning} accounts={rows} onClose={()=>setReassigning(null)} onSaved={async result=>{setNotice(num(result.updated)+' promoters reassigned to '+result.target_name+'.');await load();}}/>}
      {creating && <NewUser geo={geo} onClose={() => setCreating(false)}
                            onSaved={load} />}
      {reset && (
        <Modal title="Password reset" onClose={() => setReset(null)}>
          <Alert type="success">
            A new password has been issued for <strong>{reset.username}</strong>.
          </Alert>
          <dl className="kv">
            <dt>Username</dt><dd className="mono">{reset.username}</dd>
            <dt>New password</dt><dd className="mono">{reset.password}</dd>
          </dl>
          <div className="btn-row" style={{ marginTop: 10 }}>
            <CopyButton label="Copy password" text={reset.password} />
            <CopyButton label="Copy login details"
              text={'Login link: ' + window.location.origin + '/login\nUsername: '
                + reset.username + '\nPassword: ' + reset.password} />
          </div>
        </Modal>
      )}
      {editing && <EditUser user={editing} geo={geo} onClose={() => setEditing(null)} onSaved={load} />}
      {promoting && <CoordinatorModal user={promoting} geo={geo}
        onClose={() => setPromoting(null)} onSaved={load} />}
      {exporting && <ExportCredentialsModal onClose={() => { setExporting(false); load(); }} />}

      <div className="btn-row" style={{marginBottom:16}}><button className="btn secondary sm" onClick={() => setToolsOpen(v => !v)}>{toolsOpen ? 'Hide admin tools' : 'Open admin tools'}</button><button className="btn secondary sm" onClick={() => {api.refresh();load();}}>Refresh accounts</button></div>
      {toolsOpen && <>
      <PasswordResetRequests />
      <UploadForCandidate />
      {!isDg && <ApiKeysPanel />}
      {!isDg && <VoterRollPanel />}
      {!isDg && <Grid3Panel />}
      </>}

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Total logins" value={num(rows.length)} accent />
        <Stat label="Candidates" value={num(byRole.candidate || 0)}
              foot="Gov, Deputy, Stakeholders, Senators, Reps, Assembly" />
        <Stat label="Unit Promoters" value={num(byRole.mobiliser || 0)}
              foot={num(rows.filter((u) => u.is_coordinator).length) + ' appointed coordinator'} />
        <Stat label="Suspended"
              value={num(rows.filter((u) => u.status !== 'active').length)} />
      </div>

      <div className="pill-row" style={{ marginBottom: 12 }}>
        {[
          ['all', 'All', counts.all],
          ['candidate', 'Candidates', counts.candidate],
          ['unit_promoter', 'Nominees', counts.unit_promoter],
          ['grassroot', 'Grassroots', counts.grassroots],
        ].map(([value, label, count]) => (
          <button key={value} className={'pill' + (tab === value ? ' active' : '')}
                  onClick={() => setTab(value)}>
            {label} <span className="badge tiny">{count}</span>
          </button>
        ))}
      </div>

      <div className="toolbar">
        <input type="text" placeholder="Search username, name or constituency"
               value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 280 }} />
        <div className="spacer" />
        <button className="btn sm secondary" onClick={() => setExporting(true)}>
          Export credentials
        </button>
        <button className="btn sm" onClick={() => setCreating(true)}>+ Create login</button>
      </div>

      <div className="btn-row" style={{marginBottom:12}}><button className="btn secondary sm" disabled={page===0} onClick={()=>setPage(p=>p-1)}>Previous</button><span>{num(filtered.length)} matching accounts · Page {page+1} of {Math.max(1,Math.ceil(filtered.length/100))}</span><button className="btn secondary sm" disabled={(page+1)*100>=filtered.length} onClick={()=>setPage(p=>p+1)}>Next</button></div>
      <Card title="Platform accounts"
            note="Only these accounts can submit names. Every entry is traced back to one of them."
            bodyClass="">
        {filtered.length === 0 ? <Empty title="No logins match" /> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Username</th><th>Name</th><th>Role / Office</th>
                  <th>Nominated by</th>
                  <th>Sees</th><th className="num">Registered</th>
                  <th>Last login</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(page * 100, (page + 1) * 100).map((u) => (
                  <tr key={u.id}>
                    <td className="mono" style={{ fontWeight: 600 }}>{u.username}</td>
                    <td>{u.full_name}</td>
                    <td>
                      <span className="badge">{ROLE_LABEL[u.role] || u.role}</span>
                      {u.is_coordinator ? (
                        <span className="badge green" style={{ marginLeft: 4 }}>Coordinator</span>
                      ) : null}
                      {u.role === 'candidate' && u.office && (
                        <div className="muted" style={{ fontSize: 12 }}>{u.office}</div>
                      )}
                    </td>
                    <td className="muted">
                      {u.upline_name || (u.role === 'candidate' ? '—' : 'Not recorded')}
                      {u.upline_username && <div className="mono" style={{ fontSize: 11 }}>{u.upline_username}</div>}
                    </td>
                    <td className="muted">
                      {u.role === 'mobiliser' && !u.is_coordinator ? (
                        <>
                          <div>Only people they add</div>
                          <div style={{ fontSize: 11 }}>
                            base: {String(u.scope_value || '').split('|').pop() || 'not assigned'}
                          </div>
                        </>
                      ) : u.scope_type === 'polling_unit' ? (
                        <>{String(u.scope_value || '').split('|').map((part, i) => (
                          <div key={i}>{part || 'Not assigned'}</div>
                        ))}</>
                      ) : u.role === 'mobiliser' && u.scope_type === 'ward' ? (
                        <><div>{u.scope_value || 'Ward'}</div><div className="badge amber">Polling unit not assigned</div></>
                      ) : (u.scope_value || 'All 16 LGAs')}
                      {!(u.role === 'mobiliser' && !u.is_coordinator) && (
                        <div style={{ fontSize: 11 }}>{u.scope_type.replace(/_/g, ' ')}</div>
                      )}
                    </td>
                    <td className="num">{num(u.registered)}</td>
                    <td className="muted nowrap">
                      {u.last_login ? timeAgo(u.last_login) : 'never'}
                      {u.must_reset === 1 && (
                        <div><span className="badge amber">must reset</span></div>
                      )}
                    </td>
                    <td><Status value={u.status} /></td>
                    <td>
                      {me.permissions.is_admin&&(['candidate','unit_promoter','mobiliser'].includes(normalizeRole(u.role)))&&<button className="btn sm secondary" onClick={()=>setReassigning(u)}>{normalizeRole(u.role)==='candidate'?'Reassign promoters':'Reassign owner'}</button>}
                      {!isDg && (
                      <div className="btn-row">
                        <button className="btn sm secondary" onClick={() => setEditing(u)}>Edit</button>
                        {u.role === 'mobiliser' && (
                          u.is_coordinator ? (
                            <button className="btn sm secondary" onClick={() => removeCoordinator(u)}>
                              Remove coordinator
                            </button>
                          ) : (
                            <button className="btn sm secondary" onClick={() => setPromoting(u)}>
                              Make coordinator
                            </button>
                          )
                        )}
                        <button className="btn sm secondary" onClick={() => doReset(u)}>
                          Reset password
                        </button>
                        {u.role !== 'superadmin' && (
                          <>
                            <button className="btn sm secondary" onClick={() => toggle(u)}>
                              {u.status === 'active' ? 'Suspend' : 'Restore'}
                            </button>
                            {['admin','superadmin'].includes(normalizeRole(me.user.role)) && (<button className="btn sm danger" disabled={deletingId!==null || u.id===me.user.id} onClick={() => removeAccount(u)}>
                              {deletingId===u.id ? 'Deleting…' : 'Delete account'}
                            </button>)}
                          </>
                        )}
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
}
