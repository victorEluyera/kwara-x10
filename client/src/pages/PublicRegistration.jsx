import React, { useEffect, useState } from 'react';
import { publicRequest } from '../lib/api.js';
import { Alert, Field, Loading } from '../components/ui.jsx';

export default function PublicRegistration({ token }) {
  const [draft, setDraft] = useState(null);
  const [geo, setGeo] = useState(null);
  const [form, setForm] = useState({});
  const [message, setMessage] = useState(null);
  const [error, setError] = useState('');
  const set = (key) => (e) => setForm((s) => ({ ...s, [key]: e.target.value }));
  useEffect(() => {
    Promise.all([publicRequest('/api/public/registration/' + token), publicRequest('/api/public/geo')])
      .then(([d, g]) => { setDraft(d); setGeo(g); setForm(d); })
      .catch((e) => setError(e.message));
  }, [token]);
  const submit = async (e) => {
    e.preventDefault(); setError('');
    try {
      const result = await publicRequest('/api/public/registration/' + token, { method: 'POST', body: form });
      setMessage(result.login);
    }
    catch (e2) { setError(e2.data?.flags?.map((f) => f.message).join(', ') || e2.message); }
  };
  if (error) return <div className="login-main"><Alert type="error">{error}</Alert></div>;
  if (!draft || !geo) return <Loading label="Loading registration form" />;
  const wards = geo.wards[form.lga] || [];
  const units = geo.polling_units?.[form.lga]?.[form.ward] || [];
  if (message) return <div className="login-main"><Alert type="success" title="Registration submitted successfully.">
    Login link: <code>{window.location.origin + '/login'}</code><br />
    Username: <code>{message.username}</code><br />
    Temporary password: <code>{message.password}</code>
    <div style={{ marginTop: 10 }}>
      <button className="btn sm secondary" title="Copy login details" aria-label="Copy login details"
        onClick={() => navigator.clipboard?.writeText(
          'KWARA X10 login\nLogin link: ' + window.location.origin + '/login\nUsername: '
          + message.username + '\nPassword: ' + message.password)}>
        ⧉
      </button>
    </div>
  </Alert></div>;
  return <main className="login-main"><div className="login-box"><div className="eyebrow">KWARA X10 registration</div><h2>Complete your registration</h2><div className="sub">Your name and network position were started by a field agent. Complete the remaining details below.</div>{error && <Alert type="error">{error}</Alert>}<form onSubmit={submit}>
    <div className="grid grid-2"><Field label="First name"><input value={form.first_name || ''} onChange={set('first_name')} required /></Field><Field label="Last name"><input value={form.last_name || ''} onChange={set('last_name')} required /></Field></div>
    <Field label="Phone number"><input value={form.phone || ''} onChange={set('phone')} required /></Field>
    <Field label="LGA"><select value={form.lga || ''} onChange={(e) => setForm((s) => ({ ...s, lga: e.target.value, ward: '', polling_unit: '' }))} required><option value="">Select an LGA</option>{geo.lgas.map((l) => <option key={l}>{l}</option>)}</select></Field>
    <Field label="Ward"><select value={form.ward || ''} onChange={(e) => setForm((s) => ({ ...s, ward: e.target.value, polling_unit: '' }))} disabled={!form.lga} required><option value="">Select a ward</option>{wards.map((w) => <option key={w}>{w}</option>)}</select></Field>
    <Field label="Polling unit"><select value={form.polling_unit || ''} onChange={set('polling_unit')} disabled={!form.ward} required><option value="">Select a polling unit</option>{units.map((u) => <option key={u}>{u}</option>)}</select></Field>
    <Field label="NIN"><input value={form.nin || ''} onChange={set('nin')} maxLength={11} /></Field>
    <Field label="PVC / VIN"><input value={form.pvc_no || ''} onChange={set('pvc_no')} maxLength={19} /></Field>
    <button className="btn" type="submit">Submit registration</button>
  </form></div></main>;
}