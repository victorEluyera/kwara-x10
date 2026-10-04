import React, { useState } from 'react';
import { Alert, Field, PasswordInput } from '../components/ui.jsx';
import { Crest, CandidatePortrait, GoldRule, CAMPAIGN } from '../components/Brand.jsx';
import { publicRequest } from '../lib/api.js';

function ForgotPasswordForm({ onBack }) {
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const res = await publicRequest('/api/auth/forgot-password', {
        method: 'POST', body: { username: username.trim(), phone },
      });
      setDone(res.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <>
        <h2>Check with the programme office</h2>
        <Alert type="success">{done}</Alert>
        <button className="btn secondary" style={{ marginTop: 4 }} onClick={onBack}>
          Back to sign in
        </button>
      </>
    );
  }

  return (
    <>
      <h2>Forgot password</h2>
      <div className="sub">
        Enter your username and the phone number on your account. If they
        match, the programme office is notified to issue you a new password
        — there is no automatic email or SMS reset.
      </div>
      {error && <Alert type="error">{error}</Alert>}
      <form onSubmit={submit}>
        <Field label="Username" required>
          <input type="text" value={username} autoFocus
                 onChange={(e) => setUsername(e.target.value)}
                 placeholder="username here ..." />
        </Field>
        <Field label="Phone number" required hint="The number registered on your account">
          <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)}
                 placeholder="08031234567" />
        </Field>
        <div className="btn-row">
          <button className="btn" disabled={busy || !username || !phone}>
            {busy && <span className="spinner" />}
            {busy ? 'Checking' : 'Request a reset'}
          </button>
          <button type="button" className="btn secondary" onClick={onBack}>Cancel</button>
        </div>
      </form>
    </>
  );
}

export default function Login({ onSignIn }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await onSignIn(username.trim(), password);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <aside className="login-aside">
        <div className="login-portrait">
          <CandidatePortrait />
        </div>

        <div className="login-hero">
          <div className="login-crest">
            <Crest size={52} />
            <div>
              <div className="login-crest-text">KWARA<em>X10</em></div>
              <div className="login-crest-sub">{CAMPAIGN.strapline}</div>
            </div>
          </div>

          <h1 className="login-headline">
            <span>Make</span>
            <em>Kwara X10</em>
            <span>Better</span>
          </h1>
          <div className="login-subhead">{CAMPAIGN.subhead}</div>
        </div>

        <div className="login-candidate">
          <GoldRule width={110} />
          <div className="login-candidate-name">{CAMPAIGN.candidate}</div>
          <div className="login-candidate-note">{CAMPAIGN.candidateNote}</div>
          <div className="login-candidate-party">
            {CAMPAIGN.party} · {CAMPAIGN.period}
          </div>
        </div>

        <div className="login-tagline">{CAMPAIGN.tagline}</div>
      </aside>

      <main className="login-main">
        <div className="login-box">
          <div className="login-mobile-brand">
            <Crest size={42} />
            <div>
              <div style={{ fontFamily: 'var(--serif)', fontSize: 20, fontWeight: 700,
                            color: 'var(--green-900)' }}>KWARA X10</div>
              <div className="eyebrow">{CAMPAIGN.strapline}</div>
            </div>
          </div>

          <div className="eyebrow">{CAMPAIGN.party}</div>

          {forgot ? (
            <ForgotPasswordForm onBack={() => setForgot(false)} />
          ) : (
            <>
              <h2>Sign in</h2>
              <div className="sub">
                Accounts are issued by the programme office. Every entry submitted
                here is traceable to your login.
              </div>

              {error && <Alert type="error">{error}</Alert>}

              <form onSubmit={submit}>
                <Field label="Username" required>
                  <input
                    type="text" value={username} autoFocus autoComplete="username"
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="username here ..."
                  />
                </Field>
                <Field label="Password" required>
                  <PasswordInput
                    value={password} autoComplete="current-password"
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="password"
                  />
                </Field>
                <button className="btn" disabled={busy || !username || !password}>
                  {busy && <span className="spinner" />}
                  {busy ? 'Signing in' : 'Sign in'}
                </button>
              </form>

              <button type="button" className="link-button"
                      onClick={() => setForgot(true)}
                      style={{ marginTop: 14, background: 'none', border: 0,
                               color: 'var(--green-700)', fontSize: 13, cursor: 'pointer', padding: 0 }}>
                Forgot password?
              </button>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
