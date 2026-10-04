import React, { useEffect, useState } from 'react';
import { api, num, LEVEL_LABEL, isCandidateRole } from '../lib/api.js';
import { Card, Status, Loading, Empty, Alert, Field, Modal, Stat } from '../components/ui.jsx';
import { useAuth } from '../App.jsx';
import Submissions from './Submissions.jsx';
import SurveyReports from '../components/SurveyReports.jsx';

const TYPES = [
  { v: 'rally', label: 'Rally attendance', points: 5 },
  { v: 'canvass', label: 'Household canvass', points: 5 },
  { v: 'survey', label: 'Survey / questionnaire', points: 5 },
  { v: 'follow_up', label: 'Follow-up call', points: 3 },
  { v: 'issue_report', label: 'Community issue report', points: 10 },
  { v: 'meeting', label: 'Community meeting', points: 10 },
  { v: 'service', label: 'Community service activity', points: 15 },
  { v: 'training', label: 'Training session', points: 5 },
];

// A ward target is stored as "LGA|WARD" so two LGAs' same-named wards stay apart.
const targetLabel = (t) => {
  if (!t.target_scope_value) return '';
  const [a, b] = String(t.target_scope_value).split('|');
  return b ? b + ', ' + a : a;
};
const FORM_SCOPES = ['state', 'lga', 'ward'];

const BLANK_TASK = {
  title: '', description: '', type: 'canvass', points: 5, mandatory: true,
  requires_location: true, target_level: 'all',
  target_scope_type: 'state', target_scope_value: '', questions: [],
};

function TaskSubmissionForm({ task, onClose, onSubmitted }) {
  const { me } = useAuth();
  const [answers, setAnswers] = useState(() => Object.fromEntries((task.questions || []).map((q) => [q.id, ''])));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [location, setLocation] = useState({ lat: null, lng: null, accuracy: null });

  const captureLocation = () => new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Turn on location services before submitting this task.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const captured = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        };
        setLocation(captured);
        resolve(captured);
      },
      () => reject(new Error('Turn on location services before submitting this task.')),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });

  useEffect(() => {
    navigator.permissions?.query({ name: 'geolocation' })
      .then((permission) => {
        if (permission.state === 'granted') captureLocation().catch(() => {});
      }).catch(() => {});
  }, [task]);

  const setAnswer = (qid, value) => {
    setAnswers((s) => ({ ...s, [qid]: value }));
  };

  const submit = async () => {
    setBusy(true); setError('');
    try {
      const capturedLocation = location.lat != null && location.lng != null
        ? location : await captureLocation();
      const form = new FormData();
      if (me?.user?.member_id) form.append('member_id', String(me.user.member_id));
      form.append('answers', JSON.stringify(answers));
      if (note) form.append('note', note);
      form.append('lat', String(capturedLocation.lat));
      form.append('lng', String(capturedLocation.lng));
      if (capturedLocation.accuracy != null) form.append('accuracy', String(capturedLocation.accuracy));
      await api.form('/tasks/' + task.id + '/submit', form);
      onSubmitted();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <Modal title={task.title} onClose={onClose} footer={
      <div className="btn-row">
        <button className="btn" onClick={submit} disabled={busy}>
          {busy && <span className="spinner" />} Submit task
        </button>
        <button className="btn secondary" onClick={onClose}>Cancel</button>
      </div>
    }>
      {error && <Alert type="error">{error}</Alert>}

      <div className="card" style={{ padding: 12, marginBottom: 14 }}>
        <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>{task.type.replace(/_/g, ' ')}</div>
        <div style={{ fontWeight: 600 }}>{task.description || 'Complete the required task evidence below.'}</div>
      </div>

      {(task.questions || []).map((q, index) => (
        <Field key={q.id || index} label={q.label || 'Question ' + (index + 1)} required>
          {q.type === 'select' ? (
            <select value={answers[q.id] || ''} onChange={(e) => setAnswer(q.id, e.target.value)}>
              <option value="">Select an answer</option>
              {(q.options || []).map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          ) : (
            <textarea
              value={answers[q.id] || ''}
              onChange={(e) => setAnswer(q.id, e.target.value)}
              placeholder="Type your answer here..."
            />
          )}
        </Field>
      ))}

      <Field label="Notes">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note for the reviewer" />
      </Field>
    </Modal>
  );
}

function TaskForm({ geo, task = null, period, onSave, onClose, isAdmin, jurisdiction }) {
  const blank = isAdmin ? BLANK_TASK
    : { ...BLANK_TASK, target_scope_type: 'jurisdiction', mandatory: false };
  const initialTask = task ? {
    title: task.title || '',
    description: task.description || '',
    type: task.type || 'canvass',
    points: task.points || 5,
    mandatory: task.mandatory !== false,
    requires_location: true,
    target_level: task.target_level || 'all',
    target_scope_type: FORM_SCOPES.includes(task.target_scope_type) ? task.target_scope_type : 'jurisdiction',
    target_scope_value: task.target_scope_value || '',
    questions: Array.isArray(task.questions) ? task.questions : [],
  } : blank;

  const [t, setT] = useState(initialTask);
  const [wardLga, setWardLga] = useState(
    initialTask.target_scope_type === 'ward' ? String(initialTask.target_scope_value).split('|')[0] : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setT((s) => {
      const next = { ...s, [k]: v };
      if (k === 'type') next.points = (TYPES.find((x) => x.v === v) || {}).points || 5;
      if (k === 'target_scope_type') next.target_scope_value = '';
      return next;
    });
  };

  const addQuestion = () =>
    setT((s) => ({ ...s, questions: [...s.questions,
      { id: 'q' + (s.questions.length + 1), label: '', type: 'text', options: [] }] }));

  const setQuestion = (i, patch) =>
    setT((s) => ({ ...s, questions: s.questions.map((q, j) => (j === i ? { ...q, ...patch } : q)) }));

  const save = async () => {
    setBusy(true); setError('');
    try {
      const payload = { ...t, points: Number(t.points), period: task?.period || period };
      if (t.target_scope_type === 'jurisdiction') payload.target_scope_value = null;
      if (task?.id) {
        await api.patch('/tasks/' + task.id, payload);
      } else {
        await api.post('/tasks', payload);
      }
      onSave();
    } catch (e) { setError(e.message); setBusy(false); }
  };

  return (
    <Modal title={task ? 'Edit task' : 'Create a task'} onClose={onClose} footer={
      <div className="btn-row">
        <button className="btn" onClick={save}
                disabled={busy || !t.title.trim()
                  || (['lga', 'ward'].includes(t.target_scope_type) && !t.target_scope_value)}>
          {busy && <span className="spinner" />} {task ? 'Save changes' : 'Create task'}
        </button>
        <button className="btn secondary" onClick={onClose}>Cancel</button>
      </div>
    }>
      {error && <Alert type="error">{error}</Alert>}

      <Field label="Task title" required>
        <input type="text" value={t.title} onChange={set('title')}
               placeholder="e.g. Attend the ward mobilisation rally" />
      </Field>
      <Field label="Instructions">
        <textarea value={t.description} onChange={set('description')}
                  placeholder="What exactly should the field agent do?" />
      </Field>

      <div className="grid grid-2">
        <Field label="Activity type">
          <select value={t.type} onChange={set('type')}>
            {TYPES.map((x) => <option key={x.v} value={x.v}>{x.label}</option>)}
          </select>
        </Field>
        <Field label="Points awarded" hint="1 point = ₦100 of approved field support">
          <input type="number" value={t.points} onChange={set('points')} min="0" max="50" />
        </Field>
      </div>

      <div className="grid grid-2">
        <Field label="Who must do this">
          <select value={t.target_level} onChange={set('target_level')}>
            <option value="all">Everyone (Unit Promoters and Grassroots)</option>
            <option value="mobiliser">Unit Promoters only</option>
            <option value="grassroot">Grassroots only</option>
          </select>
        </Field>
        <Field label="Where">
          <select value={t.target_scope_type} onChange={(e) => { setWardLga(''); set('target_scope_type')(e); }}>
            {isAdmin
              ? <option value="state">Whole state</option>
              : <option value="jurisdiction">My whole jurisdiction ({jurisdiction})</option>}
            <option value="lga">A single LGA</option>
            <option value="ward">A single ward</option>
          </select>
        </Field>
      </div>

      {t.target_scope_type === 'lga' && geo && (
        <Field label="Local Government Area" required>
          <select value={t.target_scope_value} onChange={set('target_scope_value')}>
            <option value="">Select an LGA</option>
            {geo.lgas.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </Field>
      )}
      {t.target_scope_type === 'ward' && geo && (
        <div className="grid grid-2">
          <Field label="Local Government Area" required>
            <select value={wardLga} onChange={(e) => {
              setWardLga(e.target.value); setT((s) => ({ ...s, target_scope_value: '' }));
            }}>
              <option value="">Select an LGA</option>
              {geo.lgas.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </Field>
          <Field label="Ward" required>
            <select value={t.target_scope_value} disabled={!wardLga} onChange={set('target_scope_value')}>
              <option value="">Select a ward</option>
              {(geo.wards[wardLga] || []).map((w) => (
                <option key={w} value={wardLga + '|' + w}>{w}</option>
              ))}
            </select>
          </Field>
        </div>
      )}

      <div className="section-title">Requirements</div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <input type="checkbox" checked={t.mandatory} onChange={set('mandatory')}
               style={{ width: 'auto' }} />
        <span>Mandatory — payment is withheld until this is approved</span>
      </label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
         <input type="checkbox" checked disabled style={{ width: 'auto' }} />
         <span>GPS location required for every submission</span>
      </label>

      <div className="section-title">Survey questions (optional)</div>
      {t.questions.map((q, i) => (
        <div key={i} className="card" style={{ padding: 12, marginBottom: 8 }}>
          <Field label={'Question ' + (i + 1)}>
            <input type="text" value={q.label}
                   onChange={(e) => setQuestion(i, { label: e.target.value })}
                   placeholder="What do you want to ask?" />
          </Field>
          <div className="grid grid-2">
            <Field label="Answer type">
              <select value={q.type} onChange={(e) => setQuestion(i, { type: e.target.value })}>
                <option value="text">Free text</option>
                <option value="select">Choose one</option>
              </select>
            </Field>
            {q.type === 'select' && (
              <Field label="Options" hint="Separate with commas">
                <input type="text" value={(q.options || []).join(', ')}
                       onChange={(e) => setQuestion(i, {
                         options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                       })} placeholder="Roads, Water, Electricity" />
              </Field>
            )}
          </div>
        </div>
      ))}
      <button className="btn sm secondary" onClick={addQuestion}>+ Add a question</button>
    </Modal>
  );
}

export default function Tasks() {
  const { me } = useAuth();
  const [data, setData] = useState(null);
  const [geo, setGeo] = useState(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [selectedTask, setSelectedTask] = useState(null);
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));

  const load = () => api.get('/tasks?period=' + encodeURIComponent(period)).then(setData).catch((e) => setError(e.message));
  useEffect(() => {
    let active = true;
    setData(null);
    api.get('/tasks?period=' + encodeURIComponent(period))
      .then((result) => { if (active) setData(result); })
      .catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [period]);
  useEffect(() => { api.get('/geo').then(setGeo).catch(() => {}); }, []);

  const isAdmin = me.permissions.is_admin;
  const isCandidate = isCandidateRole(me.user.role);
  const canCreate = isAdmin || isCandidate;
  const canManage = (t) => isAdmin || (isCandidate && Number(t.created_by) === Number(me.user.id));
  const jurisdiction = me.user.scope_value || 'Kwara State';

  const toggle = async (t) => {
    try {
      await api.patch('/tasks/' + t.id, { status: t.status === 'open' ? 'closed' : 'open' });
      load();
    } catch (e) { setError(e.message); }
  };

  const remove = async (task) => {
    if (!window.confirm('Delete "' + task.title + '"? Its submissions and task points will also be removed.')) return;
    try {
      await api.delete('/tasks/' + task.id);
      load();
    } catch (e) { setError(e.message); }
  };

  if (error) return <Alert type="error" onClose={() => setError('')}>{error}</Alert>;
  if (!data) return <Loading label="Loading tasks" />;

  const open = data.rows.filter((t) => t.status === 'open').length;
  const mandatory = data.rows.filter((t) => t.mandatory).length;
  const totalSubs = data.rows.reduce((a, t) => a + t.submissions, 0);
  const approved = data.rows.reduce((a, t) => a + t.approved, 0);

  return (
    <>
      {creating && (
        <TaskForm geo={geo} period={period} isAdmin={isAdmin} jurisdiction={jurisdiction}
                  onClose={() => setCreating(false)}
                  onSave={() => { setCreating(false); load(); }} />
      )}
      {editingTask && (
        <TaskForm geo={geo} task={editingTask} period={period} isAdmin={isAdmin} jurisdiction={jurisdiction}
                  onClose={() => setEditingTask(null)}
                  onSave={() => { setEditingTask(null); load(); }} />
      )}
      {selectedTask && (
        <TaskSubmissionForm task={selectedTask} onClose={() => setSelectedTask(null)}
                           onSubmitted={() => { setSelectedTask(null); load(); }} />
      )}

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Tasks this period" value={data.rows.length}
              foot={open + ' open · ' + mandatory + ' mandatory'} accent />
        <Stat label="Submissions" value={num(totalSubs)} />
        <Stat label="Approved" value={num(approved)}
              foot={totalSubs ? Math.round((approved / totalSubs) * 100) + '% approval rate' : ''} />
        <Stat label="Period" value={data.period} foot="Points reset each month" />
      </div>

      <div className="toolbar">
        <label htmlFor="task-period">Report month</label>
        <input id="task-period" type="month" value={period} style={{ width: 'auto' }}
          onChange={(e) => { if (e.target.value) setPeriod(e.target.value); }} />
        <div className="spacer" />
        {canCreate && (
          <button className="btn sm" onClick={() => setCreating(true)}>
            + Create task{isAdmin ? '' : ' for my jurisdiction'}
          </button>
        )}
      </div>

      {(me.permissions.is_admin || isCandidateRole(me.user.role)) &&
        <SurveyReports key={period} tasks={data.rows} isAdmin={me.permissions.is_admin}
          jurisdiction={me.user.scope_value || 'the full state'} onReviewed={load} />}

      <Card title="Tasks"
            note="Mandatory tasks gate monthly payment for the member and their upline"
            bodyClass="">
        {data.rows.length === 0 ? (
          <Empty title="No tasks for this period">
            {canCreate
              ? 'Create the first task to start field activity.'
              : 'The programme office has not published tasks yet.'}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Task</th><th>Type</th><th>Who</th>
                  <th className="num">Points</th><th>Requires</th>
                  <th className="num">Submitted</th><th className="num">Approved</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{t.title}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{t.description}</div>
                      {t.questions.length > 0 && (
                        <div className="muted" style={{ fontSize: 12 }}>
                          {t.questions.length} survey question(s)
                        </div>
                      )}
                    </td>
                    <td><span className="badge">{t.type.replace(/_/g, ' ')}</span></td>
                    <td>
                      {t.target_level === 'all' ? 'All levels'
                        : t.target_level === 'grassroot' ? 'Grassroots'
                        : (LEVEL_LABEL[t.target_level] || t.target_level) + 's'}
                      {t.target_scope_value && (
                        <div className="muted" style={{ fontSize: 12 }}>{targetLabel(t)}</div>
                      )}
                    </td>
                    <td className="num" style={{ fontWeight: 600 }}>{t.points}</td>
                    <td>
                      {t.mandatory
                        ? <span className="badge amber">mandatory</span>
                        : <span className="badge">optional</span>}
                      {t.requires_location ? <span className="badge blue" style={{ marginLeft: 4 }}>GPS</span> : null}
                    </td>
                    <td className="num">{num(t.submissions)}</td>
                    <td className="num">{num(t.approved)}</td>
                    <td><Status value={t.status} /></td>
                    {!canManage(t) && (
                      <td className="task-action-cell">
                        {me.user.member_id ? (
                          <button className="btn sm secondary task-action-btn" onClick={() => setSelectedTask(t)}>
                            Open task
                          </button>
                        ) : (
                          <span className="muted" style={{ fontSize: 12 }}>
                            Field task — nothing to submit here
                          </span>
                        )}
                      </td>
                    )}
                    {canManage(t) && (
                      <td className="task-action-cell">
                        <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
                          <button className="btn sm secondary task-action-btn" onClick={() => setEditingTask(t)}>
                            Edit
                          </button>
                          <button className="btn sm secondary task-action-btn" onClick={() => toggle(t)}>
                            {t.status === 'open' ? 'Close' : 'Reopen'}
                          </button>
                          <button className="btn sm danger task-action-btn" onClick={() => remove(t)}>
                            Delete
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div style={{ marginTop: 22 }}>
        <Submissions compact />
      </div>
    </>
  );
}
