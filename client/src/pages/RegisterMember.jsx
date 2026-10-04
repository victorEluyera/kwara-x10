import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api, LEVEL_LABEL, normalizeRole, isUnitPromoterRole } from '../lib/api.js';
import { Card, Field, Alert, Loading, Status, Modal } from '../components/ui.jsx';
import { useAuth } from '../App.jsx';

const TITLES = ['Mr', 'Mrs', 'Miss', 'Dr', 'Engr', 'Chief', 'Alhaji', 'Alhaja', 'Pastor', 'Imam'];
const DESIGNATIONS = [
  'None',
  'Polling Unit Agent', 'Ward Supervisor', 'Unit Promoter', 'Youth Leader',
  'Women Leader',
];

const BLANK = {
  level: '', first_name: '', last_name: '', phone: '', title: '', designation: '',
  lga: '', ward: '', polling_unit: '', pvc_no: '', nin: '',
  bank_name: '', account_number: '', account_name: '',
};

const BLANK_ROW = { title: '', first_name: '', last_name: '', phone: '', pvc_no: '', nin: '',
  bank_name: '', account_number: '', account_name: '' };
const INITIAL_ROWS = 10;

function BulkRegisterTable({ geo, lockedLocation, candidateId, candidateRequired = false }) {
  const [level, setLevel] = useState(geo.levels[0] || '');
  const [lga, setLga] = useState(lockedLocation?.lga || '');
  const [ward, setWard] = useState(lockedLocation?.ward || '');
  const [pollingUnit, setPollingUnit] = useState(lockedLocation?.pollingUnit || '');
  const [rows, setRows] = useState(() => Array.from({ length: INITIAL_ROWS }, () => ({ ...BLANK_ROW })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState(null);

  const wards = geo.wards[lga] || [];
  const pollingUnits = (geo.polling_units?.[lga]?.[ward]) || [];
  const locked = !!lockedLocation;

  const setRow = (i, patch) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { ...BLANK_ROW }]);
  const addTen = () => setRows((rs) => [...rs, ...Array.from({ length: 10 }, () => ({ ...BLANK_ROW }))]);
  const removeRow = (i) => setRows((rs) => rs.filter((_, j) => j !== i));
  const clearAll = () => {
    setRows(Array.from({ length: INITIAL_ROWS }, () => ({ ...BLANK_ROW })));
    setResults(null);
  };

  const filledRows = rows
    .map((r, i) => ({ ...r, _index: i }))
    .filter((r) => r.first_name.trim() || r.last_name.trim() || r.phone.trim());

  const ready = level && filledRows.length > 0
    && filledRows.every((r) => r.first_name.trim() && r.last_name.trim() && r.phone.trim())
    && (!candidateRequired || candidateId);

  const save = async () => {
    setBusy(true); setError(''); setResults(null);
    try {
      const res = await api.post('/members/bulk', {
        level, lga, ward, polling_unit: pollingUnit,
        ...(candidateId ? { candidate_id: candidateId } : {}),
        rows: filledRows.map(({ _index, ...r }) => r),
      });
      setResults(res.rows.map((r, i) => ({ ...r, input: filledRows[i] })));
      if (res.failed === 0) {
        setRows(Array.from({ length: INITIAL_ROWS }, () => ({ ...BLANK_ROW })));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const copyAllCredentials = () => {
    const lines = (results || []).filter((r) => r.ok).map((r) =>
      r.name + ': ' + r.login.username + ' / ' + r.login.password);
    navigator.clipboard?.writeText(
      'Login link: ' + window.location.origin + '/login\n' + lines.join('\n'));
  };

  return (
    <Card title="Add many people at once"
          note="Fill as many rows as you need — everyone gets their own login automatically.">
      {error && <Alert type="error" onClose={() => setError('')}>{error}</Alert>}

      {results && (
        <Alert type={results.every((r) => r.ok) ? 'success' : 'warn'}
               title={results.filter((r) => r.ok).length + ' of ' + results.length + ' saved. '}
               onClose={() => setResults(null)}>
          {results.some((r) => r.ok) && (
            <div className="btn-row" style={{ marginTop: 8 }}>
              <button className="btn sm secondary" onClick={copyAllCredentials}>
                Copy all usernames &amp; passwords
              </button>
            </div>
          )}
        </Alert>
      )}

      <div className="section-title">Where these people are</div>
      <div className="grid grid-3" style={{ marginBottom: 4 }}>
        <Field label="Level" required>
          <select value={level} onChange={(e) => setLevel(e.target.value)}>
            {geo.levels.map((l) => <option key={l} value={l}>{LEVEL_LABEL[l] || l}</option>)}
          </select>
        </Field>
        <Field label="LGA">
          <select value={lga} disabled={locked} onChange={(e) => { setLga(e.target.value); setWard(''); setPollingUnit(''); }}>
            <option value="">Select an LGA</option>
            {geo.lgas.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </Field>
        <Field label="Ward">
          <select value={ward} disabled={locked || !lga} onChange={(e) => { setWard(e.target.value); setPollingUnit(''); }}>
            <option value="">Select a ward</option>
            {wards.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Polling unit">
        <select value={pollingUnit} onChange={(e) => setPollingUnit(e.target.value)} disabled={locked || !ward}>
          <option value="">Select a polling unit</option>
          {pollingUnits.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </Field>

      <div className="section-title">People — {filledRows.length} filled of {rows.length} rows</div>
      <div className="table-wrap">
        <table className="bulk-table">
          <thead>
            <tr>
              <th style={{ width: 28 }}>#</th>
              <th>Title</th><th>First name *</th><th>Last name *</th><th>Phone *</th>
              <th>PVC/VIN</th><th>NIN</th><th>Bank</th><th>Account No.</th><th>Account name</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const rowResult = results?.[filledRows.findIndex((f) => f._index === i)];
              return (
                <tr key={i} className={rowResult ? (rowResult.ok ? 'row-ok' : 'row-fail') : ''}>
                  <td className="muted">{i + 1}</td>
                  <td>
                    <select value={r.title} onChange={(e) => setRow(i, { title: e.target.value })}>
                      <option value="">--</option>
                      {['Mr', 'Mrs', 'Miss', 'Chief', 'Alhaji', 'Alhaja'].map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </td>
                  <td><input type="text" value={r.first_name}
                             onChange={(e) => setRow(i, { first_name: e.target.value })} /></td>
                  <td><input type="text" value={r.last_name}
                             onChange={(e) => setRow(i, { last_name: e.target.value })} /></td>
                  <td><input type="text" value={r.phone} placeholder="0803..."
                             onChange={(e) => setRow(i, { phone: e.target.value })} /></td>
                  <td><input type="text" value={r.pvc_no}
                             onChange={(e) => setRow(i, { pvc_no: e.target.value.toUpperCase() })} /></td>
                  <td><input type="text" value={r.nin}
                             onChange={(e) => setRow(i, { nin: e.target.value })} /></td>
                  <td>
                    <select value={r.bank_name} onChange={(e) => setRow(i, { bank_name: e.target.value })}>
                      <option value="">--</option>
                      {geo.banks.map((b) => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </td>
                  <td><input type="text" value={r.account_number}
                             onChange={(e) => setRow(i, { account_number: e.target.value })} /></td>
                  <td><input type="text" value={r.account_name}
                             onChange={(e) => setRow(i, { account_name: e.target.value })} /></td>
                  <td>
                    <button type="button" className="btn sm secondary" onClick={() => removeRow(i)}
                            title="Remove row">✕</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {results && (
        <div style={{ marginTop: 8 }}>
          {results.filter((r) => !r.ok).map((r, i) => (
            <div key={i} className="error-text" style={{ marginBottom: 3 }}>
              Row {r.input?._index + 1}: {r.error}
              {r.flags?.length ? ' — ' + r.flags.map((f) => f.message).join('; ') : ''}
            </div>
          ))}
        </div>
      )}

      <div className="btn-row" style={{ marginTop: 14 }}>
        <button type="button" className="btn secondary sm" onClick={addRow} disabled={busy}>+ Add row</button>
        <button type="button" className="btn secondary sm" onClick={addTen} disabled={busy}>+ Add 10 rows</button>
        <div className="spacer" />
        <button type="button" className="btn secondary" onClick={clearAll} disabled={busy}>
          Clear
        </button>
        <button className="btn" onClick={save} disabled={!ready || busy}>
          {busy && <span className="spinner" />}
          {busy ? 'Saving' : 'Save all'}
        </button>
      </div>
      {!ready && (
        <div className="hint" style={{ marginTop: 6 }}>
          Choose the level and location above, and fill first name, last name and
          phone for at least one row.
        </div>
      )}
    </Card>
  );
}

export default function RegisterMember() {
  const { me } = useAuth();
  const location = useLocation();
  const queryCandidateId = new URLSearchParams(location.search).get('candidate_id') || '';
  const [geo, setGeo] = useState(null);
  const [nominationCandidates, setNominationCandidates] = useState([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState(queryCandidateId);
  const isCandidateFlow = normalizeRole(me.user.role) === 'candidate';
  const isDg = normalizeRole(me.user.role) === 'campaign_admin';
  const [mode, setMode] = useState('single');
  const [form, setForm] = useState(BLANK);
  const [designationOther, setDesignationOther] = useState(false);
  const [gps, setGps] = useState(null);
  const [gpsState, setGpsState] = useState('idle');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(null);
  const [draftLink, setDraftLink] = useState('');

  useEffect(() => {
    api.get('/geo').then((g) => {
      setGeo(g);
      const params = new URLSearchParams(location.search);
      const requestedLevel = normalizeRole(params.get('level'));
      const parts = (isUnitPromoterRole(me.user.role) || normalizeRole(me.user.role) === 'grassroot') && !me.permissions.is_coordinator
        ? String(me.user.scope_value || '').split('|') : [];
      const allowedLevels = isCandidateFlow ? ['unit_promoter'] : g.levels;
      const nextLevel = isCandidateFlow
        ? 'unit_promoter'
        : ((requestedLevel && allowedLevels.includes(requestedLevel)) ? requestedLevel : (allowedLevels[0] || ''));
      setForm((f) => ({ ...f, level: nextLevel,
        ...(parts.length === 3 ? { lga: parts[0], ward: parts[1], polling_unit: parts[2] } : {}) }));
    }).catch((e) => setError(e.message));
  }, [location.search, me, isCandidateFlow]);

  useEffect(() => {
    if (isDg) api.get('/nominations').then((result) => setNominationCandidates(result.rows || []))
      .catch(() => setNominationCandidates([]));
  }, [isDg]);

  const set = (k) => (e) => {
    const v = e.target.value;
    setForm((f) => (k === 'lga' ? { ...f, lga: v, ward: '' } : { ...f, [k]: v }));
    setConflict(null);
  };

  const createDraftLink = async () => {
    setBusy(true); setError('');
    try {
      const draft = await api.post('/registration-drafts', form);
      const link = window.location.origin + '/complete-registration/' + draft.token;
      setDraftLink(link);
      await navigator.clipboard?.writeText(link);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const captureGps = () => new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      setGpsState('unsupported');
      reject(new Error('Turn on location services before registering this member.'));
      return;
    }
    setGpsState('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const captured = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy),
        };
        setGps(captured);
        setGpsState('ok');
        resolve(captured);
      },
      () => {
        setGpsState('denied');
        reject(new Error('Turn on location services before registering this member.'));
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });

  useEffect(() => {
    navigator.permissions?.query({ name: 'geolocation' })
      .then((permission) => {
        if (permission.state === 'granted') captureGps().catch(() => {});
      }).catch(() => {});
  }, []);

  const submit = async (force = false) => {
    setBusy(true);
    setError('');
    setConflict(null);
    try {
      const body = { ...form, ...(selectedCandidateId ? { candidate_id: selectedCandidateId } : {}), ...(gps || {}) };
      const res = await api.post('/members' + (force ? '?force=1' : ''), body);
      setResult(res);
      setForm({ ...BLANK, level: form.level, lga: form.lga, ward: form.ward,
        polling_unit: form.polling_unit });
    } catch (err) {
      if (err.status === 409) setConflict(err.data);
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !geo) return <Alert type="error">{error}</Alert>;
  if (!geo) return <Loading label="Loading constituency data" />;

  if (!geo.levels.length) {
    return (
      <Alert type="warn" title="Your account cannot register members. ">
        Registration is carried out by Candidates and Unit Promoters.
        Contact the programme office if this is wrong.
      </Alert>
    );
  }

  const wards = geo.wards[form.lga] || [];
  const pollingUnits = (geo.polling_units?.[form.lga]?.[form.ward]) || [];
  const lockedLocation = (isUnitPromoterRole(me.user.role) || normalizeRole(me.user.role) === 'grassroot') && !me.permissions.is_coordinator
    ? (() => { const [lga, ward, pollingUnit] = String(me.user.scope_value || '').split('|');
      return lga && ward && pollingUnit ? { lga, ward, pollingUnit } : null; })()
    : null;
  const required = ['first_name', 'last_name', 'phone'];
  const ready = required.every((k) => String(form[k] || '').trim())
    && (!isDg || form.level !== 'mobiliser' || selectedCandidateId);

  const modeToggle = (
    <div className="pill-row" style={{ marginBottom: 14 }}>
      <button className={'pill' + (mode === 'single' ? ' active' : '')}
              onClick={() => setMode('single')}>One person at a time</button>
      <button className={'pill' + (mode === 'bulk' ? ' active' : '')}
              onClick={() => setMode('bulk')}>Add many at once</button>
    </div>
  );

  if (mode === 'bulk') {
    return (
      <>
        {modeToggle}
        {isDg && form.level === 'mobiliser' && (
          <Card title="Nominate for candidate" note="The selected candidate receives credit for these nominees.">
            <select value={selectedCandidateId} onChange={(event) => setSelectedCandidateId(event.target.value)}>
              <option value="">Select the candidate</option>
              {nominationCandidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.full_name} · {candidate.office} · {candidate.count}/{candidate.unlimited ? 'Unlimited' : candidate.quota}
                </option>
              ))}
            </select>
          </Card>
        )}
        <BulkRegisterTable geo={geo} lockedLocation={lockedLocation}
          candidateId={selectedCandidateId}
          candidateRequired={isDg && form.level === 'mobiliser'} />
      </>
    );
  }

  return (
    <>
      {result?.login && (
        <Modal title="Member account created" onClose={() => setResult(null)} footer={
          <div className="btn-row">
            <button className="btn sm secondary" title="Copy login details"
              aria-label="Copy login details" onClick={() => navigator.clipboard?.writeText(
                'KWARA X10 login\nLogin link: ' + window.location.origin + '/login\nUsername: '
                + result.login.username + '\nPassword: ' + result.login.password)}>
              ⧉ Copy login details
            </button>
            <button className="btn secondary" onClick={() => setResult(null)}>Done</button>
          </div>
        }>
          <Alert type="success" title="Share these details now.">
            <div className="login-credentials">
              Login link: <code>{window.location.origin + '/login'}</code><br />
              Username: <code>{result.login.username}</code><br />
              Temporary password: <code>{result.login.password}</code>
            </div>
          </Alert>
        </Modal>
      )}
      {modeToggle}
      {isDg && form.level === 'mobiliser' && (
        <Card title="Nominate for candidate" note="Every nominee added here counts against the selected candidate's polling-unit allocation, or their separate unlimited allocation.">
          <select value={selectedCandidateId} onChange={(event) => setSelectedCandidateId(event.target.value)}>
            <option value="">Select the candidate</option>
            {nominationCandidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.full_name} · {candidate.office} · {candidate.count}/{candidate.unlimited ? 'Unlimited' : candidate.quota}
              </option>
            ))}
          </select>
        </Card>
      )}
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', gap: 16 }}>
      <div>
        {result && (
          <Alert type="success" title="Member registered. " onClose={() => setResult(null)}>
            <div style={{ marginTop: 4 }}>
              Reference <strong className="mono">{result.code}</strong> — status{' '}
              <Status value={result.status} />
              {result.flags?.length > 0 && (
                <ul>{result.flags.map((f, i) => <li key={i}>{f.message}</li>)}</ul>
              )}
              <div style={{ marginTop: 6 }}>
                The polling unit and ward are kept so you can add the next person
                quickly.
              </div>
            </div>
          </Alert>
        )}

        {error && <Alert type="error" onClose={() => setError('')}>{error}</Alert>}

        {conflict && (
          <Alert type="error" title="This entry did not pass validation. ">
            <ul>{conflict.flags.map((f, i) => <li key={i}>{f.message}</li>)}</ul>
            <div className="btn-row" style={{ marginTop: 10 }}>
              <button className="btn sm secondary" onClick={() => setConflict(null)}>
                Correct the details
              </button>
              {me.permissions.is_admin && (
                <button className="btn sm danger" onClick={() => submit(true)}>
                  Override and save as flagged
                </button>
              )}
            </div>
          </Alert>
        )}

        <Card title="Register a community member"
              note="Every entry is tagged with your login, the time and your location.">
          <form onSubmit={(e) => { e.preventDefault(); submit(false); }}>

            <div className="section-title">Position in the network</div>
            <div className="grid grid-2">
              <Field label="Level in the 10X network" required
                     hint="Determines who this person may go on to activate">
                <select value={form.level} onChange={set('level')}>
                  {geo.levels.map((l) => (
                    <option key={l} value={l}>{LEVEL_LABEL[l] || l}</option>
                  ))}
                </select>
              </Field>
              <Field label="Designation" hint="Optional role description">
                <select value={designationOther ? '__other__' : form.designation}
                        onChange={(event) => {
                          if (event.target.value === '__other__') {
                            setDesignationOther(true);
                            setForm((current) => ({ ...current, designation: '' }));
                          } else {
                            setDesignationOther(false);
                            setForm((current) => ({ ...current, designation: event.target.value }));
                          }
                        }}>
                  {DESIGNATIONS.map((d) => <option key={d} value={d === 'None' ? '' : d}>{d}</option>)}
                  <option value="__other__">Other (type your own)</option>
                </select>
                {designationOther && (
                  <input type="text" value={form.designation}
                         onChange={set('designation')}
                         placeholder="Type the designation" style={{ marginTop: 8 }} />
                )}
              </Field>
            </div>
            <div className="btn-row" style={{ marginBottom: 16 }}>
              <button type="button" className="btn sm secondary"
                      onClick={createDraftLink}
                      disabled={busy || !form.first_name.trim() || !form.last_name.trim() || !form.level}>
                Generate self-completion link
              </button>
              {draftLink && <span className="muted" style={{ fontSize: 12, wordBreak: 'break-all' }}>
                Link copied: {draftLink}
              </span>}
            </div>

            <div className="section-title">Location</div>
            <div className="grid grid-2">
              <Field label="Local Government Area"
                     hint={geo.lgas.length + ' LGA(s) available to your account'}>
                <select value={form.lga} disabled={!!lockedLocation} onChange={set('lga')}>
                  <option value="">Select an LGA</option>
                  {geo.lgas.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </Field>
              <Field label="Ward"
                     hint={form.lga ? wards.length + ' wards in ' + form.lga
                                    : 'Choose an LGA first'}>
                <select value={form.ward} onChange={set('ward')} disabled={!!lockedLocation || !form.lga}>
                  <option value="">Select a ward</option>
                  {wards.map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Polling unit"
                   hint={form.ward ? pollingUnits.length + ' polling units in this ward' : 'Choose a ward first'}>
              <select value={form.polling_unit} onChange={set('polling_unit')} disabled={!!lockedLocation || !form.ward}>
                <option value="">Select a polling unit</option>
                {pollingUnits.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
              </select>
            </Field>

            <div className="section-title">Personal details</div>
            <div className="grid grid-3">
              <Field label="Title">
                <select value={form.title} onChange={set('title')}>
                  <option value="">--</option>
                  {TITLES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="First name" required>
                <input type="text" value={form.first_name} onChange={set('first_name')} />
              </Field>
              <Field label="Last name" required>
                <input type="text" value={form.last_name} onChange={set('last_name')} />
              </Field>
            </div>
            <div className="grid grid-3">
              <Field label="Phone number" required hint="Nigerian mobile, 11 digits">
                <input type="text" value={form.phone} onChange={set('phone')}
                       placeholder="08031234567" maxLength={14} />
              </Field>
              <Field label="PVC / VIN" hint="19 characters from the voter's card">
                <input type="text" value={form.pvc_no} onChange={set('pvc_no')}
                       placeholder="90F5A78901234567890" maxLength={19}
                       style={{ textTransform: 'uppercase' }} />
              </Field>
              <Field label="NIN" hint="11 digits">
                <input type="text" value={form.nin} onChange={set('nin')}
                       placeholder="12345678901" maxLength={11} />
              </Field>
            </div>

            <div className="section-title">Payment details</div>
            <div className="grid grid-3">
              <Field label="Bank">
                <select value={form.bank_name} onChange={set('bank_name')}>
                  <option value="">Select a bank</option>
                  {geo.banks.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </Field>
              <Field label="Account number" hint="10-digit NUBAN">
                <input type="text" value={form.account_number}
                       onChange={set('account_number')} maxLength={10} />
              </Field>
              <Field label="Account name"
                     hint="Must match the person's own name">
                <input type="text" value={form.account_name} onChange={set('account_name')} />
              </Field>
            </div>

            <div className="btn-row" style={{ marginTop: 18 }}>
              <button className="btn" disabled={!ready || busy}>
                {busy && <span className="spinner" />}
                {busy ? 'Checking and saving' : 'Register member'}
              </button>
              <button type="button" className="btn secondary"
                      onClick={() => { setForm({ ...BLANK, level: form.level }); setConflict(null); }}>
                Clear form
              </button>
              {!ready && (
                <span className="muted" style={{ fontSize: 12.5 }}>
                  Fill the required fields marked *
                </span>
              )}
            </div>
          </form>
        </Card>
      </div>

    </div>
    </>
  );
}
