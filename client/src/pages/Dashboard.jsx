import PdpPromoterOverlap from '../components/PdpPromoterOverlap.jsx';
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, num, pct, naira, timeAgo, LEVEL_LABEL, isCandidateRole, normalizeRole } from '../lib/api.js';
import { Card, Stat, Status, Loading, Empty, Bar, Alert, Modal } from '../components/ui.jsx';
import { useAuth } from '../App.jsx';
import Verification from './Verification.jsx';
import OperationalReport from '../components/OperationalReport.jsx';
import ConstituencyReport from '../components/ConstituencyReport.jsx';
import AreaReport from '../components/AreaReport.jsx';
import AreaTotals from '../components/AreaTotals.jsx';
import CoverageTable from '../components/CoverageTable.jsx';
import DashboardTables from '../components/DashboardTables.jsx';

const FIELD_ROLES = new Set(['unit_promoter', 'mobiliser', 'grassroot']);

function hasFlag(member, code) {
  try {
    return JSON.parse(member.risk_flags || '[]').some((flag) => flag.code === code);
  } catch {
    return false;
  }
}

function DashboardHeading({ title, note }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div className="eyebrow">KWARA X10 programme</div>
      <h1>{title}</h1>
      <div className="card-note">{note}</div>
    </div>
  );
}

function LocationCoverage({ coverage, targets, note, statewide = false }) {
  const wards = Number(coverage.wards || 0);
  const units = Number(coverage.units || 0);
  const wardTarget = Number(targets.wards || 0);
  const unitTarget = Number(targets.polling_units || 0);
  const wardPercent = wardTarget ? Math.round(wards / wardTarget * 100) : 0;
  const unitPercent = unitTarget ? Math.round(units / unitTarget * 100) : 0;
  const unmappedUnits = Number(coverage.unrecognised_units || 0);
  return (
    <div style={{ marginBottom: 16 }}>
      <Card title={(statewide ? 'Statewide' : 'Your area') + ' ward and polling-unit coverage'} note={note}>
        <div className="grid grid-4">
          <Stat label="Polling units reached" value={num(units)} accent
            foot={'of ' + num(unitTarget) + ' polling units · ' + num(unitPercent) + '% reached'
              + (unmappedUnits > 0 ? ' · ' + num(unmappedUnits) + ' uploaded locations awaiting mapping' : '')}
            progress={unitPercent} />
          <Stat label="Polling units remaining" value={num(Math.max(0, unitTarget - units))} />
          <Stat label="Wards reached" value={num(wards)}
            foot={'of ' + num(wardTarget) + ' wards · ' + num(wardPercent) + '% covered'}
            progress={wardPercent} />
          <Stat label="Wards remaining" value={num(Math.max(0, wardTarget - wards))} />
        </div>
      </Card>
    </div>
  );
}


function PeopleWithLocation({ rows, title = 'People under you' }) {
  return (
    <Card title={title} note="Most recently added first, with exactly where each one is from"
          bodyClass=""
          actions={<Link className="btn sm secondary" to="/network">View full network</Link>}>
      {rows.length === 0 ? <Empty title="Nobody registered yet" /> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th><th>Phone</th><th>Level</th>
                <th>LGA</th><th>Ward</th><th>Polling unit</th>
                <th>VIN/location</th><th>Added</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td style={{ fontWeight: 600 }}>
                    <Link to={'/members/' + m.id}>{m.first_name} {m.last_name}</Link>
                  </td>
                  <td className="mono muted">{m.phone}</td>
                  <td><span className="badge">{LEVEL_LABEL[m.level] || m.level}</span></td>
                  <td>{m.lga}</td>
                  <td className="muted">{m.ward}</td>
                  <td className="muted">{m.polling_unit}</td>
                  <td>{({verified:'VIN/location match',location_mismatch:'Location differs',missing_vin:'Missing VIN',vin_not_found:'VIN not found',needs_review:'Needs review'})[m.vin_verification_status] || 'Not checked'}</td>
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

function SurveyDesk({ surveys = [], notifications = [] }) {
  return (
    <div style={{ marginBottom: 16 }}>
      {notifications.length > 0 && (
        <Alert type="info" title={notifications.length + ' new survey' + (notifications.length === 1 ? '' : 's') + ' published'}>
          Review the questions below and use the Tasks page to monitor responses.
        </Alert>
      )}
      <Card
        title="Survey desk"
        note="Live questions from your current jurisdiction"
        actions={<Link className="btn sm secondary" to="/tasks">Open tasks</Link>}
        bodyClass=""
      >
        {surveys.length === 0 ? (
          <Empty title="No open surveys yet">
            When a survey is published, it will appear here with its questions and response progress.
          </Empty>
        ) : (
          <div className="grid grid-2" style={{ gap: 12 }}>
            {surveys.slice(0, 4).map((survey) => (
              <div key={survey.id} className="card" style={{ padding: 14, border: '1px solid var(--ink-200)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{survey.title}</div>
                    <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                      {survey.target_scope_value || 'Whole programme'} · {survey.points} points
                    </div>
                  </div>
                  <span className="badge blue">survey</span>
                </div>
                {survey.description && <p className="muted" style={{ fontSize: 13 }}>{survey.description}</p>}
                <div className="section-title" style={{ marginTop: 12 }}>Questions</div>
                {(survey.questions || []).slice(0, 3).map((question, index) => (
                  <div key={question.id || index} className="check-row" style={{ padding: '7px 0' }}>
                    <div className="check-icon none">{index + 1}</div>
                    <div className="check-label">{question.label || 'Question ' + (index + 1)}</div>
                  </div>
                ))}
                {(!survey.questions || survey.questions.length === 0) && (
                  <div className="muted" style={{ fontSize: 13 }}>No questions added yet.</div>
                )}
                <div className="hint" style={{ marginTop: 10 }}>
                  {num(survey.submissions)} response(s) · {num(survey.pending)} awaiting review
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

const CANDIDATE_OFFICES = ['Governor', 'Deputy Governor', 'Stakeholder', 'Senator',
  'House of Representatives', 'House of Assembly'];
const candidateScopeType = (office) => {
  const value = String(office || '').toLowerCase();
  if (value.includes('governor')) return 'state';
  if (value.includes('senator')) return 'senatorial';
  if (value.includes('representative')) return 'federal';
  if (value.includes('assembly')) return 'state_const';
  return 'state';
};

function DgAddPanel() {
  const [tab, setTab] = useState('nominee');
  const [geo, setGeo] = useState(null);
  const [nominationRows, setNominationRows] = useState([]);
  const [candidateId, setCandidateId] = useState('');
  const [rows, setRows] = useState([{ full_name: '', office: 'Senator', scope_value: '' }]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [created, setCreated] = useState(null);

  useEffect(() => {
    api.get('/geo').then(setGeo).catch(() => {});
    api.get('/nominations').then((result) => setNominationRows(result.rows || [])).catch(() => {});
  }, []);

  const options = (office) => {
    if (!geo) return [];
    const type = candidateScopeType(office);
    return type === 'state' ? [] : type === 'senatorial' ? geo.senatorial
      : type === 'federal' ? geo.federal : geo.state_const;
  };
  const setRow = (index, patch) => setRows((items) => items.map((row, i) => i === index ? { ...row, ...patch } : row));
  const addRow = () => setRows((items) => [...items, { full_name: '', office: 'Senator', scope_value: '' }]);
  const saveCandidates = async () => {
    const filled = rows.filter((row) => row.full_name.trim());
    if (!filled.length) return setError('Add at least one candidate name.');
    setBusy(true); setError(''); setMessage('');
    try {
      const accounts = await Promise.all(filled.map((row) => api.post('/users', {
        role: 'candidate', full_name: row.full_name.trim(), office: row.office,
        scope_type: candidateScopeType(row.office), scope_value: row.scope_value,
      })));
      setRows([{ full_name: '', office: 'Senator', scope_value: '' }]);
      setCreated(accounts);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <Card title="Add to the platform" note="Add candidates individually or in a table, or register Unit Promoters for candidates.">
      {created && (
        <Modal title="Candidate accounts created" onClose={() => setCreated(null)} footer={
          <div className="btn-row">
            <button className="btn sm secondary" title="Copy all login details"
              aria-label="Copy all login details" onClick={() => navigator.clipboard?.writeText(
                'Login link: ' + window.location.origin + '/login\n'
                + created.map((account) => 'Username: ' + account.username + '\nPassword: ' + account.password).join('\n'))}>
              ⧉ Copy all login details
            </button>
            <button className="btn secondary" onClick={() => setCreated(null)}>Done</button>
          </div>
        }>
          <Alert type="success" title="Share these details now. They are shown only once.">
            {created.map((account) => (
              <div key={account.username} style={{ marginBottom: 10 }}>
                <strong>{account.username}</strong><br />
                Temporary password: <code>{account.password}</code>
              </div>
            ))}
            Login link: <code>{window.location.origin + '/login'}</code>
          </Alert>
        </Modal>
      )}
      <div className="tabs" style={{ marginBottom: 14 }}>
        <button className={'tab' + (tab === 'candidate' ? ' active' : '')} onClick={() => setTab('candidate')}>Add candidate</button>
        <button className={'tab' + (tab === 'nominee' ? ' active' : '')} onClick={() => setTab('nominee')}>Add nominee</button>
      </div>
      {error && <Alert type="error">{error}</Alert>}
      {message && <Alert type="success">{message}</Alert>}
      {tab === 'candidate' ? (
        <>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Full name</th><th>Office / stakeholder</th><th>Which one</th></tr></thead>
              <tbody>{rows.map((row, index) => (
                <tr key={index}>
                  <td><input value={row.full_name} onChange={(e) => setRow(index, { full_name: e.target.value })} placeholder="Candidate name" /></td>
                  <td><select value={row.office} onChange={(e) => setRow(index, { office: e.target.value, scope_value: '' })}>
                    {CANDIDATE_OFFICES.map((office) => <option key={office}>{office}</option>)}
                  </select></td>
                  <td>{candidateScopeType(row.office) === 'state' ? <span className="muted">Whole state</span> : (
                    <select value={row.scope_value} onChange={(e) => setRow(index, { scope_value: e.target.value })}>
                      <option value="">Select constituency</option>
                      {options(row.office).map((option) => <option key={option}>{option}</option>)}
                    </select>
                  )}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn sm secondary" onClick={addRow} disabled={busy}>+ Add row</button>
            <button className="btn" onClick={saveCandidates} disabled={busy}>{busy && <span className="spinner" />} Create candidate accounts</button>
          </div>
        </>
      ) : (
        <>
          <p className="muted">Select the candidate or stakeholder whose list you received. Legislative limits apply per polling unit; stakeholders and the Deputy Governor have unlimited nominations.</p>
          <div className="grid grid-2" style={{ marginBottom: 12 }}>
            <label>Candidate
              <select value={candidateId} onChange={(event) => setCandidateId(event.target.value)}>
                <option value="">Select a candidate</option>
                {nominationRows.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.full_name} · {row.office}
                  </option>
                ))}
              </select>
            </label>
            <div className="hint" style={{ alignSelf: 'end' }}>
              {candidateId
                ? 'Nominees will be recorded under the selected candidate.'
                : 'Choose a candidate before opening registration.'}
            </div>
          </div>
          <Link className="btn" to={candidateId
            ? '/register?level=unit_promoter&candidate_id=' + candidateId
            : '#'} onClick={(event) => { if (!candidateId) event.preventDefault(); }}>
            Open nominee registration
          </Link>
        </>
      )}
    </Card>
  );
}

function NumbersDashboard({ data, me }) {
  const counts = data.platform_counts || {};
  const byLga = data.by_lga || [];
  const byWard = data.by_ward || [];
  const coverage = data.coverage || {};

  return (
    <>
      <DashboardHeading
        title={normalizeRole(me.user.role) === 'campaign_admin'
          ? 'DG numbers dashboard' : 'Governor numbers dashboard'}
        note="Programme totals and geographic coverage at a glance."
      />
      <div className="grid grid-5" style={{ marginBottom: 16 }}>
        <Stat label="Candidates" value={num(counts.candidates)} accent />
        <Stat label="Nominees" value={num(counts.nominees)} />
        <Stat label="Grassroots" value={num(counts.grassroots)} />
        <Stat label="LGAs" value={num(coverage.lgas)} />
        <Stat label="Total accounts" value={num(counts.total)} />
      </div>

      <div className="grid grid-2">
        <Card title="Coverage by LGA" note="Registered people, VIN/location matches, wards, and polling units" bodyClass="">
          {byLga.length === 0 ? <Empty title="No LGA coverage yet" /> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>LGA</th><th className="num">People</th><th className="num">Wards</th><th className="num">Units</th></tr></thead>
                <tbody>{byLga.map((row) => (
                  <tr key={row.lga}>
                    <td style={{ fontWeight: 600 }}>{row.lga}</td>
                    <td className="num">{num(row.total)}</td>
                    <td className="num">{num(row.wards)}</td>
                    <td className="num">{num(row.units)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Coverage by ward" note="Ward-level registration totals" bodyClass="">
          {byWard.length === 0 ? <Empty title="No ward coverage yet" /> : (
            <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
              <table>
                <thead><tr><th>LGA</th><th>Ward</th><th className="num">People</th><th className="num">Units</th></tr></thead>
                <tbody>{byWard.map((row) => (
                  <tr key={row.lga + row.ward}>
                    <td>{row.lga}</td>
                    <td style={{ fontWeight: 600 }}>{row.ward}</td>
                    <td className="num">{num(row.total)}</td>
                    <td className="num">{num(row.units)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function CampaignAdminDashboard({ data, me, users = [] }) {
  const UNIT_PROMOTER_TARGET = data?.targets?.mobilisers || 0;
  const coverage = data?.coverage || {};
  const counts = users.reduce((acc, user) => {
    const role = normalizeRole(user.role);
    if (role === 'candidate') acc.candidate += 1;
    if (role === 'unit_promoter' || role === 'mobiliser') acc.unit_promoter += 1;
    if (role === 'grassroot') acc.grassroot += 1;
    acc.total += 1;
    return acc;
  }, { candidate: 0, unit_promoter: 0, grassroots: 0, total: 0, grassroot: 0 });
  const totalPeople = data?.totals?.total || 0;
  const nominationCoverage = data?.by_level?.find((entry) => entry.level === 'mobiliser')?.n || 0;

  return (
    <>
      <DashboardHeading
        title="DG command dashboard"
        note="Track candidate activation, nominee coverage, grassroots reach, and total programme accounts from one place."
      />
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Candidates added" value={num(counts.candidate)} accent
          foot={num(totalPeople) + ' total people in view'} />
        <Stat label="Unit Promoters"
          value={num(nominationCoverage) }
          foot={pct(nominationCoverage, UNIT_PROMOTER_TARGET) + '% of ' + num(UNIT_PROMOTER_TARGET) + ' target · 10 per polling unit'}
          progress={pct(nominationCoverage, UNIT_PROMOTER_TARGET)} />
        <Stat label="Grassroots" value={num(counts.grassroot)}
          foot="Community-level platform accounts" />
        <Stat label="Total accounts" value={num(counts.total)}
          foot="All active accounts currently on the platform" />
      </div>

      <div style={{ marginBottom: 16 }}>
        <Card title="Coverage snapshot" note="Current network totals and platform scope">
          <Bar label="Candidates" value={counts.candidate || 0} max={Math.max(counts.candidate || 0, 10)} display={num(counts.candidate || 0)} />
          <Bar label="Unit Promoters" value={nominationCoverage} max={UNIT_PROMOTER_TARGET}
               display={num(nominationCoverage) + ' / ' + num(UNIT_PROMOTER_TARGET)} />
          <Bar label="Polling units reached" value={coverage.units || 0}
            max={data?.targets?.polling_units || 1}
            display={num(coverage.units) + ' / ' + num(data?.targets?.polling_units)} />
          <Bar label="Grassroots" value={counts.grassroot || 0} max={Math.max(counts.grassroot || 0, 10)} display={num(counts.grassroot || 0)} />
        </Card>
      </div>

      <div style={{ marginBottom: 16 }}>
        <DgAddPanel />
      </div>

      <OperationalReport data={data} isAdmin={me.permissions.is_admin} />
      <SurveyDesk surveys={data.survey_tasks || []} notifications={data.survey_notifications || []} />
    </>
  );
}

function CandidateDashboard({ data, me }) {
  const [area,setArea]=useState(null),[areaError,setAreaError]=useState('');
  useEffect(()=>{
    let active=true;
    api.get('/dashboard/area-report?').then(result=>{if(active)setArea(result);}).catch(e=>{if(active)setAreaError(e.message);});
    return ()=>{active=false;};
  },[me.user.id]);
  if(areaError) return <Alert type="error">{areaError}</Alert>;
  if(!area) return <Loading label="Loading constituency totals"/>;
  const nomination=area.nomination;
  const achieved=Number(nomination?.count || 0);
  const expected=nomination?.unlimited?'Unlimited':nomination?.quota==null?'Not set':num(nomination.quota);
  const summary=area.summary;
  return <>
    <DashboardHeading title={'Welcome, '+me.user.full_name} note={'Your constituency: '+area.area}/>
    <div className="grid grid-4" style={{marginBottom:16}}>
      {nomination && <Stat label={nomination.unlimited ? "Promoters added / target" : "Promoters allocated / target"} value={num(achieved)+' / '+expected} accent
        foot={nomination.unlimited ? "Registered promoters on your candidate account" : "Promoters assigned to valid constituency polling units"}
        progress={nomination.quota>0?pct(achieved,nomination.quota):undefined}/>}
      <Stat label="Polling units reached / total" value={num(summary.units_reached)+' / '+num(summary.polling_units)}
        foot={num(summary.units_remaining)+' polling units remaining'} progress={pct(summary.units_reached,summary.polling_units)}/>
      <Stat label="Wards reached / total" value={num(summary.wards_reached)+' / '+num(summary.wards)}
        foot={num(summary.wards_remaining)+' wards remaining'} progress={pct(summary.wards_reached,summary.wards)}/>
      <Stat label="Voters in constituency" value={summary.voters==null?'Not loaded':num(summary.voters)}
        foot={num(summary.projects)+' submitted projects'}/>
    </div>
    <AreaReport me={me} initialData={area} candidateLayout />
    <SurveyDesk surveys={data.survey_tasks || []} notifications={data.survey_notifications || []}/>
  </>;
}

function FieldDashboard({ data, me }) {
  const { totals, coverage, by_level, recent, people_added, tasks } = data;
  const levels = Object.fromEntries(by_level.map((r) => [r.level, r.n]));
  const nextLevel = me.permissions.can_register_levels[0];
  const areaLabel = 'Polling units reached';
  const areaValue = coverage.units || 0;
  const areaFoot = num(totals.with_polling_unit || 0) + ' people with a polling unit';

  return (
    <>
      <DashboardHeading
        title="Your field dashboard"
        note={'Focused on ' + (me.user.scope_value || 'your assigned network') + '. Add Grassroots and complete your assigned tasks.'}
      />
      {me.user.member_id && (
        <Card title="Check your own details"
              note="Confirm or correct your contact and location information so it can be reviewed.">
          <Link className="btn" to={'/members/' + me.user.member_id}>
            Review and confirm my details
          </Link>
        </Card>
      )}
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Stat label="Your registrations" value={num(totals.total)} accent
          foot={num(totals.vin_matched || 0) + ' VIN and location matches'} />
        <Stat label="No resolved polling unit" value={num(totals.without_polling_unit || 0)}
          foot="Location details to resolve" />
        <Stat label={areaLabel} value={areaValue}
          foot={areaFoot} />
        <Stat label="Tasks open" value={num(tasks.open || 0)}
          foot="Check your assigned work" />
      </div>
      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <Card title="Your network" note="The levels currently visible in your branch">
          {Object.entries(levels).map(([level, count]) => (
            <Bar key={level} label={LEVEL_LABEL[level] || level} value={count} max={Math.max(count, 10)} display={num(count)} />
          ))}
          {!Object.keys(levels).length && <Empty title="No registrations yet" />}
        </Card>
        <Card title="Today’s work" note="The quickest way to make progress">
          <div className="btn-row" style={{ marginBottom: 12 }}>
            {nextLevel && <Link className="btn" to="/register">Add Grassroot</Link>}
            <Link className="btn secondary" to="/tasks">View tasks</Link>
          </div>
          <Alert type="info">
            Verified registrations and approved task submissions count toward your performance.
          </Alert>
        </Card>
      </div>
      <RecentRegistrations rows={people_added || recent}
                           title="People you added"
                           note="Grassroots registered directly by you" />
    </>
  );
}

function RecentRegistrations({ rows, title = 'Recent registrations', note }) {
  return (
    <Card title={title} note={note} bodyClass="">
      {rows.length === 0 ? <Empty title="Nothing registered yet" /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Code</th><th>Name</th><th>Level</th><th>LGA</th><th>Ward</th><th>Polling unit</th><th>VIN/location</th><th>Added</th></tr></thead>
            <tbody>{rows.map((m) => (
              <tr key={m.id}>
                <td className="mono">{m.code}</td>
                <td style={{ fontWeight: 600 }}>{m.first_name} {m.last_name}</td>
                <td><span className="badge">{LEVEL_LABEL[m.level] || m.level}</span></td>
                <td>{m.lga}</td>
                <td>{m.ward?.trim() || 'Not recorded'}</td>
                <td>{m.polling_unit?.trim() || 'Not recorded'}</td>
                <td>{({verified:'VIN/location match',location_mismatch:'Location differs',missing_vin:'Missing VIN',vin_not_found:'VIN not found',needs_review:'Needs review'})[m.vin_verification_status] || 'Not checked'}</td>
                <td className="muted nowrap">{timeAgo(m.created_at)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function RecentActivity({ rows }) {
  return (
    <Card title="Recent activity" note="Last 200 audited actions" bodyClass="">
      {!rows || rows.length === 0 ? <Empty title="No activity yet" /> : (
        <div className="table-wrap" style={{ maxHeight: 380, overflowY: 'auto' }}>
          <table>
            <thead>
              <tr><th>Action</th><th>By</th><th>Entity</th><th>When</th></tr>
            </thead>
            <tbody>
              {rows.slice(0, 80).map((a) => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 600 }}>{a.action.replace(/_/g, ' ')}</td>
                  <td className="mono">{a.actor || '--'}</td>
                  <td className="muted">
                    {a.entity ? a.entity + ' #' + a.entity_id : '--'}
                  </td>
                  <td className="muted nowrap">{timeAgo(a.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default function Dashboard() {
  const { me } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (me.permissions.can_see_compliance) api.get('/dashboard/area-report?view=coverage').catch(() => {});
    let active = true;
    setData(null); setError('');
    api.get(me.permissions.can_see_compliance ? '/dashboard?view=summary' : '/dashboard').then((result) => { if (active) setData(result); })
      .catch((e) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [me.user.id]);
  if (isCandidateRole(me.user.role)) {
    if (error) return <Alert type="error">{error}</Alert>;
    if (!data) return <Loading label="Loading your dashboard" />;
    return <DashboardTables><CandidateDashboard data={data} me={me} /></DashboardTables>;
  }
  return <DashboardTables>
    {error ? <Alert type="error">{error}</Alert> : data ? <>
      <DashboardContent data={data} />
    </> : <Loading label="Loading dashboard details" />}
  </DashboardTables>;
}

function DashboardContent({ data }) {
  const { me } = useAuth();
  if (FIELD_ROLES.has(normalizeRole(me.user.role))) return <FieldDashboard data={data} me={me} />;
  const { totals = {}, coverage = {}, targets = {}, by_level = [], by_lga = [] } = data;
  const UNIT_PROMOTER_TARGET = targets.mobilisers || 0;
  const levels = Object.fromEntries(by_level.map(r => [r.level, Number(r.n)]));
  const projects = data.project_overview || {};
  const sources=data.promoter_sources || {};
  return <>
    <DashboardHeading title="Programme administration" note="Coverage, recruitment and projects across your programme." />
    <div className="grid grid-3" style={{marginBottom:20}}>
      <Stat label="LGAs" value={num(coverage.lgas || 0)+' / '+num(targets.lgas || 0)} accent progress={pct(coverage.lgas,targets.lgas)} foot={num(Math.max(0,(targets.lgas || 0)-(coverage.lgas || 0)))+' LGAs remaining'} />
      <Stat label="Wards" value={num(coverage.wards || 0)+' / '+num(targets.wards || 0)} progress={pct(coverage.wards,targets.wards)} foot={num(Math.max(0,(targets.wards || 0)-(coverage.wards || 0)))+' wards remaining'} />
      <Stat label="Polling units" value={num(coverage.units || 0)+' / '+num(targets.polling_units || 0)} progress={pct(coverage.units,targets.polling_units)} foot={pct(coverage.units,targets.polling_units)+'% · '+num(Math.max(0,(targets.polling_units || 0)-(coverage.units || 0)))+' polling units remaining'} />
      <Stat label="Promoters" value={num(levels.mobiliser || 0)+' / '+num(UNIT_PROMOTER_TARGET)} foot={num(sources.candidates || 0)+' from candidates + '+num(sources.stakeholders || 0)+' from candidate stakeholders'+(sources.other?' · '+num(sources.other)+' other/unassigned':'')} progress={pct(levels.mobiliser || 0,UNIT_PROMOTER_TARGET)} />
      <Stat label="Total projects" value={num(projects.total || 0)} foot="Candidate project submissions" />
      <Stat label="Estimated project cost" value={naira(projects.estimated_cost_total || 0)} foot="Total recorded estimated budgets" />
      <Stat label="10X members" value={num(totals.total || 0)} foot={num(levels.mobiliser || 0)+' promoters + '+num((levels.grassroot || 0)+(levels.grassroots || 0))+' grassroots'} />
      {me.permissions.is_admin && <PdpPromoterOverlap />}
      <Stat label="Polling unit saturation" value={num(coverage.saturation_completed || 0)+' / '+num(coverage.saturation_expected || 0)} progress={coverage.saturation_percent || 0} foot={num(coverage.saturation_percent || 0)+'% . with minimum 10 promoters '+num(coverage.saturation_remaining || 0)+'left '} />
    </div>
    <AreaTotals lgaRows={by_lga} />
  </>;
}
