import React, { useEffect, useState, useRef } from 'react';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, naira, num, timeAgo, LEVEL_LABEL, isCandidateRole } from '../lib/api.js';
import { Card, Status, Loading, Alert, Empty, Field, Modal } from '../components/ui.jsx';
import { useAuth } from '../App.jsx';



export default function MemberDetail() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const autoEdited = useRef(null);
  const { me } = useAuth();
  const navigate = useNavigate();
  const isOwnRecord = Number(id) === Number(me.user.member_id);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [login, setLogin] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [geo, setGeo] = useState(null);
  const [editError, setEditError] = useState('');

  const load = () => api.get('/members/' + id).then(setData).catch((e) => setError(e.message));
  useEffect(() => { setData(null); load(); }, [id]);

  const createLogin = async () => {
    setBusy(true); setError('');
    try { setLogin(await api.post('/members/' + id + '/login')); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const beginEdit = async () => {
    setBusy(true); setEditError('');
    try {
      const reference = await api.get('/geo');
      setGeo(reference);
      setEditForm({
        first_name: data.member.first_name || '', last_name: data.member.last_name || '',
        phone: data.member.phone || '', title: data.member.title || '',
        designation: data.member.designation || '', pvc_no: data.member.pvc_no || '',
        nin: data.member.nin || '', bank_name: data.member.bank_name || '',
        account_number: data.member.account_number || '', account_name: data.member.account_name || '',
        lga: data.member.lga || '', ward: data.member.ward || '',
        polling_unit: data.member.polling_unit || '',
      });
      setEditing(true);
    } catch (e) { setEditError(e.message); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    if (data && me.permissions.is_admin && searchParams.get('edit') === '1' && autoEdited.current !== id) {
      autoEdited.current = id;
      beginEdit();
    }
  }, [data, id, me.permissions.is_admin, searchParams]);

  const saveEdit = async () => {
    setBusy(true); setEditError('');
    try {
      await api.patch('/members/' + id, { ...editForm, confirm: isOwnRecord });
      setEditing(false);
      await load();
    } catch (e) { setEditError(e.message); }
    finally { setBusy(false); }
  };

  const setEdit = (key, value) => setEditForm((form) => ({
    ...form,
    ...(key === 'lga' ? { lga: value, ward: '', polling_unit: '' }
      : key === 'ward' ? { ward: value, polling_unit: '' } : { [key]: value }),
  }));

  if (error) return <Alert type="error">{error}</Alert>;
  if (!data) return <Loading label="Loading member" />;

  const { member: m, downline, downline_rows, eligibility: el, points, submissions } = data;

  const canEdit = me.permissions.is_admin
    || isOwnRecord
    || (isCandidateRole(me.user.role) && Number(m.upline_user_id) === Number(me.user.id));
  const lgaOptions = geo && editForm
    ? [...new Set([editForm.lga, ...geo.lgas].filter(Boolean))] : [];

  return (
    <>
      {editing && editForm && geo && (
        <Modal title="Edit nominee details" onClose={() => setEditing(false)} footer={
          <div className="btn-row">
            <button className="btn" onClick={saveEdit}
                    disabled={busy || !editForm.first_name.trim() || !editForm.last_name.trim()}>
              {busy && <span className="spinner" />}{isOwnRecord ? 'Confirm and submit' : 'Save changes'}
            </button>
            <button className="btn secondary" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        }>
          {editError && <Alert type="error">{editError}</Alert>}
          <div className="grid grid-2">
            <Field label="First name" required>
              <input value={editForm.first_name} onChange={(e) => setEdit('first_name', e.target.value)} />
            </Field>
            <Field label="Surname" required>
              <input value={editForm.last_name} onChange={(e) => setEdit('last_name', e.target.value)} />
            </Field>
            <Field label="Phone number">
              <input value={editForm.phone} onChange={(e) => setEdit('phone', e.target.value)} />
            </Field>
            <Field label="Title">
              <input value={editForm.title} onChange={(e) => setEdit('title', e.target.value)} />
            </Field>
            <Field label="Role in the community">
              <input value={editForm.designation} onChange={(e) => setEdit('designation', e.target.value)} />
            </Field>
            <Field label="PVC / VIN">
              <input value={editForm.pvc_no} onChange={(e) => setEdit('pvc_no', e.target.value)} />
            </Field>
            <Field label="NIN">
              <input value={editForm.nin} onChange={(e) => setEdit('nin', e.target.value)} />
            </Field>
            <Field label="Bank">
              <input value={editForm.bank_name} onChange={(e) => setEdit('bank_name', e.target.value)} />
            </Field>
            <Field label="Account number">
              <input value={editForm.account_number} onChange={(e) => setEdit('account_number', e.target.value)} />
            </Field>
            <Field label="Account name">
              <input value={editForm.account_name} onChange={(e) => setEdit('account_name', e.target.value)} />
            </Field>
            <Field label="LGA">
              <select value={editForm.lga} onChange={(e) => setEdit('lga', e.target.value)}>
                <option value="">Select LGA</option>
                {lgaOptions.map((lga) => <option key={lga} value={lga}>{lga}</option>)}
              </select>
            </Field>
            <Field label="Ward" hint="Enter the ward name or number as you know it.">
              <input value={editForm.ward} onChange={(e) => setEdit('ward', e.target.value)} />
            </Field>
            <Field label="Polling unit" hint="Enter the polling-unit name or number as you know it.">
              <input value={editForm.polling_unit} onChange={(e) => setEdit('polling_unit', e.target.value)} />
            </Field>
          </div>
          <p className="hint">{isOwnRecord
            ? 'Confirm these details for VIN and location matching. You may enter ward and polling-unit names or numbers.'
            : 'Updating nominee details clears the previous VIN result so it can be checked again.'}</p>
        </Modal>
      )}
      {editError && !editing && (
        <Alert type="error" onClose={() => setEditError('')}>{editError}</Alert>
      )}
      {login && (
        <Modal title="Member account created" onClose={() => setLogin(null)} footer={
          <div className="btn-row">
            <button type="button" className="btn sm secondary" title="Copy login details"
              aria-label="Copy login details" onClick={() => navigator.clipboard?.writeText(
                'KWARA X10 login\nLogin link: ' + window.location.origin + '/login\nUsername: '
                + login.username + '\nPassword: ' + login.password)}>
              ⧉ Copy login details
            </button>
            <button type="button" className="btn secondary" onClick={() => setLogin(null)}>Done</button>
          </div>
        }>
          <Alert type="success" title="Share these details now.">
            Login link: <code>{window.location.origin + '/login'}</code><br />
            Username: <code>{login.username}</code><br />
            Temporary password: <code>{login.password}</code>
          </Alert>
        </Modal>
      )}
      <div className="toolbar">
        <button className="btn sm secondary" onClick={() => navigate(-1)}>← Back</button>
        <div className="spacer" />
        {!isOwnRecord && <button className="btn sm secondary" onClick={createLogin} disabled={busy}>
          Create login
        </button>}
        {canEdit && (
          <button className="btn sm secondary" onClick={beginEdit} disabled={busy}>
            {isOwnRecord ? 'Review / confirm details' : 'Edit details'}
          </button>
        )}

      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 16 }}>
        <div>
          <Card
            title={(m.title ? m.title + ' ' : '') + m.first_name + ' ' + m.last_name}
            note={m.code + ' · ' + (LEVEL_LABEL[m.level] || m.level)}

          >
            <dl className="kv">
              <dt>Phone</dt><dd className="mono">{m.phone}</dd>
              <dt>Designation</dt><dd>{m.designation || '--'}</dd>
              <dt>LGA</dt><dd>{m.lga}</dd>
              <dt>Ward</dt><dd>{m.ward}</dd>
              <dt>Polling unit</dt><dd>{m.polling_unit}</dd>
              <dt>PVC / VIN</dt><dd className="mono">{m.pvc_no || '--'}</dd>
              <dt>NIN</dt><dd className="mono">{m.nin || '--'}</dd>
              <dt>Bank</dt><dd>{m.bank_name || '--'}</dd>
              <dt>Account</dt>
              <dd className="mono">
                {m.account_number || '--'}
                {m.account_name && <span className="muted"> · {m.account_name}</span>}
              </dd>
              <dt>Registered</dt><dd>{new Date(m.created_at).toLocaleString('en-NG')}</dd>
              <dt>GPS</dt>
              <dd className="mono">
                {m.lat != null
                  ? m.lat.toFixed(5) + ', ' + m.lng.toFixed(5) + ' (±' + (m.accuracy || '?') + 'm)'
                  : 'not captured'}
              </dd>

            </dl>
          </Card>

          <div style={{ height: 14 }} />

          <Card title="VIN and location verification">
            <p>{({verified:'VIN and location match',location_mismatch:'VIN found; submitted location differs',missing_vin:'Missing VIN',vin_not_found:'VIN not found',needs_review:'Needs review',not_checked:'Not checked'})[m.vin_verification_status || 'not_checked']}</p>
            <p>{m.polling_unit_resolved ? 'With polling unit: ' + m.polling_unit : 'No resolved polling unit'}</p>
            <p className="muted">Only VIN and voter location determine this result.</p>
          </Card>

        </div>

        <div>
          <Card title="Payment eligibility"
                note={'Period ' + el.period + ' · ' + (LEVEL_LABEL[el.level] || el.level)}>
            <>
                {Object.entries(el.gates).map(([key, g]) => (
                  <div key={key} className={'gate ' + (g.pass ? 'pass' : 'fail')}>
                    <div className={'check-icon ' + (g.pass ? 'pass' : 'fail')}>
                      {g.pass ? '✓' : '✕'}
                    </div>
                    <div className="gate-text">
                      <div className="gate-title">
                        {key === 'baseline' && 'Activation baseline'}
                        {key === 'own_tasks' && 'Own mandatory tasks'}
                        {key === 'downline_tasks' && 'Downline tasks complete'}
                      </div>
                      <div className="gate-detail">{g.detail}</div>
                    </div>
                  </div>
                ))}

                <div className="grid grid-2" style={{ marginTop: 14, gap: 10 }}>
                  <div className="stat">
                    <div className="stat-label">Points this period</div>
                    <div className="stat-value">{el.capped_points}</div>
                    <div className="stat-foot">
                      cap {el.point_cap}
                      {el.capped_by_ceiling && ' · ' + el.raw_points + ' earned before cap'}
                    </div>
                  </div>
                  <div className="stat stat-accent">
                    <div className="stat-label">{el.eligible ? 'Payable' : 'Withheld'}</div>
                    <div className="stat-value">{naira(el.amount_naira)}</div>
                    <div className="stat-foot">
                      {el.eligible ? 'All gates passed'
                        : 'Would be ' + naira(el.potential_naira) + ' if gates cleared'}
                    </div>
                  </div>
                </div>

                {el.gates.downline_tasks.laggards?.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <div className="section-title">Downline still outstanding</div>
                    {el.gates.downline_tasks.laggards.slice(0, 8).map((l) => (
                      <div key={l.id} className="check-row">
                        <div className="check-icon warn">!</div>
                        <div style={{ flex: 1 }}>
                          <div className="check-label">
                            <Link to={'/members/' + l.id}>{l.name}</Link>
                          </div>
                          <div className="check-detail">
                            {l.outstanding} task(s) outstanding
                          </div>
                        </div>
                      </div>
                    ))}
                    {el.gates.downline_tasks.laggards.length > 8 && (
                      <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
                        and {el.gates.downline_tasks.laggards.length - 8} more
                      </div>
                    )}
                  </div>
                )}
            </>
          </Card>

          <div style={{ height: 14 }} />

          <Card title="Activations"
                note={num(downline.total) + ' registered'}
                bodyClass="">
            {downline_rows.length === 0 ? (
              <Empty title="No one activated yet">
                This member has not yet registered anyone below them.
              </Empty>
            ) : (
              <div className="table-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}>
                <table>
                  <thead>
                    <tr><th>Name</th><th>Level</th><th>Polling unit</th></tr>
                  </thead>
                  <tbody>
                    {downline_rows.map((d) => (
                      <tr key={d.id}>
                        <td><Link to={'/members/' + d.id}>{d.first_name} {d.last_name}</Link></td>
                        <td><span className="badge">{LEVEL_LABEL[d.level] || d.level}</span></td>
                        <td className="muted">{d.polling_unit}</td>

                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div style={{ height: 14 }} />

          <Card title="Points earned" note={'Period ' + el.period} bodyClass="">
            {points.length === 0 ? (
              <Empty title="No points yet">
                Points come from approved task submissions and verified activations above 10.
              </Empty>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Source</th><th className="num">Entries</th><th className="num">Points</th></tr>
                  </thead>
                  <tbody>
                    {points.map((p) => (
                      <tr key={p.source}>
                        <td style={{ textTransform: 'capitalize' }}>{p.source}</td>
                        <td className="num">{p.entries}</td>
                        <td className="num" style={{ fontWeight: 600 }}>{p.points}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <div style={{ height: 14 }} />

          <Card title="Task submissions" bodyClass="">
            {submissions.length === 0 ? <Empty title="No submissions" /> : (
              <div className="table-wrap" style={{ maxHeight: 260, overflowY: 'auto' }}>
                <table>
                  <thead>
                    <tr><th>Task</th><th>Status</th><th className="num">Points</th><th>When</th></tr>
                  </thead>
                  <tbody>
                    {submissions.map((s) => (
                      <tr key={s.id}>
                        <td>{s.task_title}</td>
                        <td><Status value={s.status} /></td>
                        <td className="num">{s.points_awarded || '--'}</td>
                        <td className="muted nowrap">{timeAgo(s.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
