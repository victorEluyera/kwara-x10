import React, { createContext, useContext, useEffect, useState, lazy, Suspense } from 'react';
import { Routes, Route, NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom';

import { api, getToken, clearToken, ROLE_LABEL, isCandidateRole, isUnitPromoterRole, normalizeRole } from './lib/api.js';
import { Loading, Alert, Field, PasswordInput } from './components/ui.jsx';
import { Crest, CAMPAIGN } from './components/Brand.jsx';

const Login = lazy(() => import('./pages/Login.jsx'));
const ReportPage = lazy(() => import('./pages/ReportPage.jsx'));
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const RegisterMember = lazy(() => import('./pages/RegisterMember.jsx'));
const MemberDetail = lazy(() => import('./pages/MemberDetail.jsx'));
const Members = lazy(() => import('./pages/Members.jsx'));
const Network = lazy(() => import('./pages/Network.jsx'));
const Tasks = lazy(() => import('./pages/Tasks.jsx'));
const FieldWork = lazy(() => import('./pages/FieldWork.jsx'));
const DgWork = lazy(() => import('./pages/DgWork.jsx'));
const Users = lazy(() => import('./pages/Users.jsx'));
const Compliance = lazy(() => import('./pages/Compliance.jsx'));
const MyNominations = lazy(() => import('./pages/MyNominations.jsx'));
const Projects = lazy(() => import('./pages/Projects.jsx'));
const PublicRegistration = lazy(() => import('./pages/PublicRegistration.jsx'));
const Profile = lazy(() => import('./pages/Profile.jsx'));

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

/** Shown in place of the whole app while an account is still on the password
 * it was issued with. The server enforces this too -- this screen exists so
 * the person sees what to do instead of a wall of permission errors. */
function ForcePasswordChange({ onDone, onSignOut, loggingOut }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (next !== confirm) { setError('The two new passwords do not match.'); return; }
    if (next.length < 8) { setError('Your new password must be at least 8 characters.'); return; }
    if (next === current) { setError('Please choose a different password from the one you were given.'); return; }
    setBusy(true);
    try {
      await api.post('/auth/change-password', { current_password: current, new_password: next });
      await onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
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
          <h2>Choose your password</h2>
          <div className="sub">
            This account is still using the password it was issued with. Set your
            own before continuing — it keeps your constituency's data private to you.
          </div>

          {error && <Alert type="error">{error}</Alert>}

          <form onSubmit={submit}>
            <Field label="Password you were given" required>
              <PasswordInput value={current} autoFocus autoComplete="current-password"
                             onChange={(e) => setCurrent(e.target.value)} />
            </Field>
            <Field label="New password" required hint="At least 8 characters">
              <PasswordInput value={next} autoComplete="new-password"
                             onChange={(e) => setNext(e.target.value)} />
            </Field>
            <Field label="Confirm new password" required>
              <PasswordInput value={confirm} autoComplete="new-password"
                             onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            <button className="btn" disabled={busy || !current || !next || !confirm}>
              {busy && <span className="spinner" />} Save new password
            </button>
          </form>

          <div className="btn-row" style={{ marginTop: 12 }}>
            <button type="button" className="btn secondary"
                    onClick={onSignOut} disabled={loggingOut}>
              {loggingOut && <span className="spinner" />} Sign out
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

const NAV = [
  { group: 'Programme' },
  { to: '/', label: 'Dashboard', icon: '▤', end: true },
  { to: '/promoter-delivery', label: 'Promoter delivery', icon: '▥', needs: 'compliance' },
  { to: '/aspirants-directory', label: 'Aspirants directory', icon: '☷', needs: 'compliance' },
  { to: '/project-intelligence', label: 'Project intelligence', icon: '▧', needs: 'compliance' },
  { to: '/network', label: 'Network', icon: '⑃', needs: 'network' },
  // Candidate nominations stay reachable from their dashboard card.
  { group: 'Field work' },
  { to: '/register', label: 'Register network', icon: '＋', needs: 'register' },
  { to: '/tasks', label: 'Tasks & reports', icon: '✓' },
  { group: 'Administration', admin: true },
  { to: '/members', label: 'Members', icon: '☷', admin: true },
  { to: '/users', label: 'Platform accounts', icon: '⚿', admin: true },
  { to: '/projects', label: 'Projects', icon: '▧', admin: true },
  { to: '/projects', label: 'Projects', icon: '▧', needs: 'candidate' },
  { group: 'Oversight', needs: 'compliance' },
  { to: '/compliance', label: 'Reports & challenges', icon: '⚑', needs: 'compliance' },
];

function Shell({ children }) {
  const { me, signOut, loggingOut } = useAuth();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const isAdmin = me.permissions.is_admin;
  const canSeeCompliance = me.permissions.can_see_compliance;
  const isCandidate = isCandidateRole(me.user.role);
  const isField = ['unit_promoter', 'mobiliser', 'grassroot'].includes(normalizeRole(me.user.role));
  const isGovernorCandidate = isCandidate && me.user.office === 'Governor';
  const canRegister = me.permissions.can_register_levels.length > 0;
  const canReview = me.permissions.can_review;

  const visible = NAV.filter((item) => {
    if (isAdmin && item.to && ['/network', '/register'].includes(item.to)) return false;
    if (isField && item.to && !['/', '/tasks', '/profile'].includes(item.to)) return false;
    // The Governor's dashboard is deliberately a statewide overview rather
    // than a working area -- except for Projects, where they are one of the
    // people who needs to see every candidate's register.
    if (isGovernorCandidate && item.to
        && !['/', '/profile', '/projects'].includes(item.to)) return false;
    if (item.admin && !isAdmin) return false;
    if (normalizeRole(me.user.role) === 'campaign_admin' && item.to === '/compliance') return false;
    if (item.needs === 'register' && !canRegister) return false;
    if (item.needs === 'review' && !canReview) return false;
    if (item.needs === 'compliance' && !canSeeCompliance) return false;
    if (item.needs === 'candidate' && !isCandidate) return false;
    // Candidates keep their own project register; the Governor, D.G. and
    // admins see everyone's.
    return true;
  }).filter((item, index, items) => !item.group || items[index + 1]?.to);

  useEffect(() => { setMobileNavOpen(false); }, [location.pathname]);

  const current = visible.find((i) => i.to && (i.end
    ? location.pathname === i.to
    : location.pathname.startsWith(i.to)));

  const scope = me.user.scope_value || 'Kwara State (all 16 LGAs)';

  // Pages reached from a card rather than the sidebar still need a heading,
  // so the title cannot come from the nav alone.
  const OFF_NAV_TITLES = {
    '/projects': 'Projects',
    '/my-nominations': 'My nominations',
    '/network': 'Network',
  };

  // A candidate's dashboard is named for the seat they are contesting --
  // "Senatorial Dashboard", not a generic one shared with every other role.
  const DASHBOARD_BY_OFFICE = {
    Governor: 'Governor Dashboard',
    'Deputy Governor': 'Deputy Governor Dashboard',
    Stakeholder: 'Stakeholder Dashboard',
    Senator: 'Senatorial Dashboard',
    'House of Representatives': 'Federal Dashboard',
    'House of Assembly': 'State Assembly Dashboard',
  };

  const title = location.pathname === '/'
    ? (DASHBOARD_BY_OFFICE[me.user.office] || 'Dashboard')
    : (current?.label
       || Object.entries(OFF_NAV_TITLES)
            .find(([path]) => location.pathname.startsWith(path))?.[1]
       || 'KWARA X10');

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <Crest size={38} />
          <div>
            <div className="brand-mark">KWARA<em>X10</em></div>
            <div className="brand-sub">{CAMPAIGN.strapline}</div>
          </div>
        </div>
        <nav className="nav">
          {visible.map((item, i) => item.group ? (
            <div className="nav-group" key={'g' + i}>{item.group}</div>
          ) : (
            <NavLink key={item.to} to={item.to} end={item.end}
              className={({ isActive }) => (isActive ? 'active' : '')}>
              <span className="nav-icon">{item.icon}</span>
              {item.to === '/register' && isCandidate ? 'Add nominee' : item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="sidebar-user">{me.user.full_name}</div>
          <div className="sidebar-role">
            {me.user.office || ROLE_LABEL[normalizeRole(me.user.role)] || me.user.role}
          </div>
          <button className="signout" onClick={signOut} disabled={loggingOut}>
            {loggingOut && <span className="spinner" />}
            {loggingOut ? 'Signing out' : 'Sign out'}
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="mobile-nav-toggle"
              aria-label="Open navigation menu"
              onClick={() => setMobileNavOpen((value) => !value)}
            >
              ☰
            </button>
            <div>
              <div className="topbar-title">{title}</div>
              <div className="topbar-sub">{scope}</div>
            </div>
          </div>
          <div className="topbar-actions">
            <div className="topbar-strap">
              {CAMPAIGN.party}
              <span>{CAMPAIGN.tagline}</span>
            </div>
            <NavLink to="/profile" className="btn secondary sm topbar-profile">My profile</NavLink>
            <span className="badge green">
              <span className="dot" />{ROLE_LABEL[normalizeRole(me.user.role)] || me.user.role}
            </span>
          </div>
        </header>

        <div className={`mobile-backdrop ${mobileNavOpen ? 'visible' : ''}`} onClick={() => setMobileNavOpen(false)} />
        <nav className={`mobile-nav-panel nav ${mobileNavOpen ? 'open' : ''}`}>
          <div className="mobile-nav-head">
            <div>
              <div className="brand-mark">KWARA<em>X10</em></div>
              <div className="brand-sub">{CAMPAIGN.strapline}</div>
            </div>
            <button className="mobile-close" onClick={() => setMobileNavOpen(false)} aria-label="Close menu">✕</button>
          </div>
          {visible.map((item, i) => item.group ? (
            <div className="nav-group" key={'g' + i}>{item.group}</div>
          ) : (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setMobileNavOpen(false)}
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.to === '/register' && isCandidate ? 'Add nominee' : item.label}
            </NavLink>
          ))}
          <button className="signout mobile-signout" onClick={signOut} disabled={loggingOut}>
            {loggingOut && <span className="spinner" />}
            {loggingOut ? 'Signing out' : 'Sign out'}
          </button>
        </nav>

        <div className="content">{children}</div>
      </div>
    </div>
  );
}

export default function App() {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const navigate = useNavigate();

  const load = async () => {
    if (!getToken()) { setMe(null); setLoading(false); return; }
    try {
      setMe(await api.get('/me'));
    } catch {
      // Invalid or expired token -- without clearing `me` here, a stale
      // authenticated value stays in state even though the account is no
      // longer signed in, which is exactly what let a bfcache-restored page
      // keep rendering as authenticated.
      clearToken();
      setMe(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Back/forward can restore an earlier page from the browser's bfcache --
  // the full JS state exactly as it was at that point in history, with no
  // remount and no effects re-running. If that earlier snapshot was taken
  // while signed in and the user has since signed out, this is what would
  // otherwise show a fully authenticated page for an account that is no
  // longer signed in. `pageshow` with `event.persisted` is the one reliable
  // signal a page was served from that cache rather than freshly loaded, so
  // re-validate against the current token whenever it fires.
  useEffect(() => {
    const onPageShow = (event) => {
      if (!event.persisted) return;
      // Show the loading screen immediately rather than the stale cached
      // page for the instant it takes load() to resolve -- otherwise an
      // already-signed-out user would still briefly see the old authenticated
      // view rendered from the cached state, even though it corrects itself
      // a moment later.
      setLoading(true);
      load();
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  const signIn = async (username, password) => {
    const res = await api.post('/auth/login', { username, password });
    localStorage.setItem('kwarax10.token', res.token);
    setMe(await api.get('/me'));
    navigate('/');
  };

  const signOut = async () => {
    setLoggingOut(true);
    try {
      // Best-effort -- record the logout in the audit trail, but don't let a
      // slow or failing request keep someone signed in against their will.
      await api.post('/auth/logout', {});
    } catch { /* sign them out locally regardless */ }
    clearToken();
    setMe(null);
    setLoggingOut(false);
    navigate('/login');
  };

  if (loading) return <Loading label="Starting KWARA X10" />;

  if (!me) {
    return (
      <Suspense fallback={<Loading label="Loading page" />}><Routes>
        <Route path="/complete-registration/:token" element={<PublicRegistrationRoute />} />
        <Route path="*" element={<Login onSignIn={signIn} />} />
      </Routes></Suspense>
    );
  }

  // Accounts are handed out with a shared starting password, so the server
  // refuses every other endpoint until it is changed. Show the change form
  // instead of the app, rather than a dashboard full of permission errors.
  if (Number(me.user.must_reset) === 1) {
    return <ForcePasswordChange onDone={load} onSignOut={signOut} loggingOut={loggingOut} />;
  }

  const isAdmin = me.permissions.is_admin;
  const canSeeCompliance = me.permissions.can_see_compliance;
  const isCandidate = isCandidateRole(me.user.role);
  const isGovernorCandidate = isCandidate && me.user.office === 'Governor';
  const isField = ['unit_promoter', 'mobiliser', 'grassroot'].includes(normalizeRole(me.user.role));

  return (
    <AuthContext.Provider value={{ me, signOut, loggingOut, reload: load }}>
      <Shell>
        <Suspense fallback={<Loading label="Loading page" />}><Routes>
          <Route path="/" element={<Dashboard />} />
          {canSeeCompliance && <><Route path="/promoter-delivery" element={<ReportPage view="candidates" />} /><Route path="/aspirants-directory" element={<ReportPage view="directory" />} /><Route path="/project-intelligence" element={<ReportPage view="projects" />} /></>}
          {/* Reachable for candidates by tapping the Network card on their
              dashboard, but deliberately kept out of the sidebar -- the nav
              is meant to stay short. The server scopes what they see. */}
          {!isField && <Route path="/network" element={<Network />} />}
          {isCandidate && !isGovernorCandidate && <Route path="/my-nominations" element={<MyNominations />} />}
          {(isCandidate || canSeeCompliance || isAdmin) && <Route path="/projects" element={<Projects />} />}
          <Route path="/profile" element={<Profile />} />
          {!isCandidate && <Route path="/register" element={<RegisterMember />} />}
          {isCandidate && !isGovernorCandidate && <Route path="/register" element={<Navigate to="/my-nominations" replace />} />}
          <Route path="/members/:id" element={<MemberDetail />} />
          {isAdmin && <Route path="/members" element={<Members />} />}
          {isField ? <Route path="/tasks" element={<FieldWork />} />
            : me.permissions.is_admin && normalizeRole(me.user.role) === 'campaign_admin'
              ? <Route path="/tasks" element={<DgWork />} />
            : !isGovernorCandidate && <Route path="/tasks" element={<Tasks />} />}
          {isAdmin && <Route path="/users" element={<Users />} />}
          {me.permissions.can_see_compliance && normalizeRole(me.user.role) !== 'campaign_admin'
            && <Route path="/compliance" element={<Compliance />} />}
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes></Suspense>
      </Shell>
    </AuthContext.Provider>
  );
}

function PublicRegistrationRoute() {
  const location = window.location.pathname;
  return <PublicRegistration token={location.split('/').pop()} />;
}
