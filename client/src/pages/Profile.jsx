import React, { useState } from 'react';
import { api, normalizeRole } from '../lib/api.js';
import { Alert, Card, Field, PasswordInput } from '../components/ui.jsx';
import { useAuth } from '../App.jsx';

export default function Profile() {
  const { me, reload } = useAuth();
  const [profile, setProfile] = useState({
    username: me.user.username || '', phone: me.user.phone || '',
  });
  const [passwords, setPasswords] = useState({ current_password: '', new_password: '', confirm: '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const saveProfile = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try { await api.patch('/auth/profile', profile); await reload(); setMessage('Profile updated.'); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const changePassword = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    if (passwords.new_password !== passwords.confirm) {
      setError('New passwords do not match.'); setBusy(false); return;
    }
    try {
      await api.post('/auth/change-password', {
        current_password: passwords.current_password,
        new_password: passwords.new_password,
      });
      setPasswords({ current_password: '', new_password: '', confirm: '' });
      setMessage('Password changed successfully.');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="grid grid-2">
      <Card title="Profile" note="Update your contact details. Your name, role, and candidate username are managed by the programme office.">
        {message && <Alert type="success">{message}</Alert>}
        {error && <Alert type="error">{error}</Alert>}
        <form onSubmit={saveProfile}>
          <Field label="Full name"><input value={me.user.full_name} disabled /></Field>
          <Field label="Role"><input value={me.user.office || me.user.role} disabled /></Field>
          <Field label="Username" hint={normalizeRole(me.user.role) === 'candidate'
            ? 'Generated automatically from office and constituency'
            : 'Lowercase letters, numbers, dots, hyphens and underscores'}>
            <input value={profile.username} disabled={normalizeRole(me.user.role) === 'candidate'}
              onChange={(e) => setProfile({ ...profile, username: e.target.value })} />
          </Field>
          <Field label="Phone number">
            <input value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} />
          </Field>
          <button className="btn" disabled={busy || (normalizeRole(me.user.role) !== 'candidate' && !profile.username.trim())}>
            Save profile
          </button>
        </form>
      </Card>

      <Card title="Change password" note="Use at least 8 characters and keep your password private.">
        <form onSubmit={changePassword}>
          <Field label="Current password" required>
            <PasswordInput value={passwords.current_password} autoComplete="current-password"
              onChange={(e) => setPasswords({ ...passwords, current_password: e.target.value })} />
          </Field>
          <Field label="New password" required hint="At least 8 characters">
            <PasswordInput value={passwords.new_password} autoComplete="new-password"
              onChange={(e) => setPasswords({ ...passwords, new_password: e.target.value })} />
          </Field>
          <Field label="Confirm new password" required>
            <PasswordInput value={passwords.confirm} autoComplete="new-password"
              onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })} />
          </Field>
          <button className="btn" disabled={busy || !passwords.current_password || !passwords.new_password || !passwords.confirm}>
            Change password
          </button>
        </form>
      </Card>
    </div>
  );
}