import React, { useState } from 'react';

export function Card({ title, note, actions, children, bodyClass = 'card-body' }) {
  return (
    <div className="card">
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {note && <div className="card-note">{note}</div>}
          </div>
          {actions && <div className="btn-row">{actions}</div>}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </div>
  );
}

export function Stat({ label, value, foot, accent, progress, progressTone }) {
  return (
    <div className={'stat' + (accent ? ' stat-accent' : '')}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {progress !== undefined && (
        <div className="progress">
          <div className={'progress-bar' + (progressTone ? ' ' + progressTone : '')}
               style={{ width: Math.min(100, progress) + '%' }} />
        </div>
      )}
      {foot && <div className="stat-foot">{foot}</div>}
    </div>
  );
}

const STATUS_TONE = {
  verified: 'green', approved: 'green', active: 'green', open: 'green',
  pending: 'amber', flagged: 'amber',
  rejected: 'red', suspended: 'red', closed: '',
};

export function Status({ value }) {
  const tone = STATUS_TONE[value] || '';
  return (
    <span className={'badge ' + tone}>
      <span className="dot" />{value}
    </span>
  );
}

export function Alert({ type = 'info', title, children, onClose }) {
  return (
    <div className={'alert ' + type}>
      <div style={{ flex: 1 }}>
        {title && <strong>{title}</strong>}
        {children}
      </div>
      {onClose && (
        <button className="btn sm secondary" onClick={onClose}>Dismiss</button>
      )}
    </div>
  );
}

export function Empty({ icon = '○', title, children }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <div style={{ fontWeight: 600, color: 'var(--ink-600)' }}>{title}</div>
      {children && <div style={{ marginTop: 5, fontSize: 13 }}>{children}</div>}
    </div>
  );
}

export function Loading({ label = 'Loading' }) {
  return (
    <div className="loading">
      <span className="spinner dark" /> {label}...
    </div>
  );
}

export function Field({ label, required, hint, error, children }) {
  return (
    <div className="field">
      {label && (
        <label>{label}{required && <span className="req"> *</span>}</label>
      )}
      {children}
      {hint && !error && <div className="hint">{hint}</div>}
      {error && <div className="error-text">{error}</div>}
    </div>
  );
}

/** Password box with a Show/Hide toggle. Field workers type these on phones
 * where a mistyped password is invisible and the only feedback is a failed
 * login, so every password box in the app uses this rather than a bare input. */
export function PasswordInput({ value, onChange, autoFocus, autoComplete = 'current-password',
                                placeholder, name, id }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-field">
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        placeholder={placeholder}
        name={name}
        id={id}
      />
      <button type="button" className="password-toggle"
              onClick={() => setVisible((shown) => !shown)}
              aria-label={visible ? 'Hide password' : 'Show password'}>
        {visible ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}

export function Bar({ label, value, max, display }) {
  const width = max ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="bar-row">
      <div className="bar-label">{label}</div>
      <div className="bar-track">
        <div className="bar-fill" style={{ width: width + '%' }}>
          {width > 14 ? Math.round(width) + '%' : ''}
        </div>
      </div>
      <div className="bar-value">{display ?? value}</div>
    </div>
  );
}

export function Modal({ title, onClose, children, footer }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h2>{title}</h2>
          <button className="btn sm secondary" onClick={onClose}>Close</button>
        </div>
        <div className="card-body">{children}</div>
        {footer && (
          <div className="card-body" style={{ borderTop: '1px solid var(--ink-200)' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

const CHECK_TONE = {
  pass: 'pass', fail: 'fail', mismatch: 'fail', error: 'fail',
  missing: 'warn', not_configured: 'none', skipped: 'none',
};
const CHECK_GLYPH = {
  pass: '✓', fail: '✕', mismatch: '✕', error: '!',
  missing: '?', not_configured: '–', skipped: '–',
};

export function CheckRow({ name, result }) {
  if (!result) return null;
  const tone = CHECK_TONE[result.status] || 'none';
  return (
    <div className="check-row">
      <div className={'check-icon ' + tone}>{CHECK_GLYPH[result.status] || '?'}</div>
      <div style={{ flex: 1 }}>
        <div className="check-label">{name}</div>
        <div className="check-detail">
          {result.reason
            || (result.status === 'pass' ? 'Passed' : result.status.replace(/_/g, ' '))}
          {result.account_name && ' — ' + result.account_name}
          {result.count ? ' (' + result.count + ' match)' : ''}
        </div>
      </div>
      <span className={'badge ' + (tone === 'pass' ? 'green' : tone === 'fail' ? 'red'
        : tone === 'warn' ? 'amber' : '')}>{result.status.replace(/_/g, ' ')}</span>
    </div>
  );
}
