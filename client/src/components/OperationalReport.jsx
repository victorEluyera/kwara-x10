import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Stat, Bar, Modal } from './ui.jsx';
import { api, naira, num, pct } from '../lib/api.js';

function EstimatedCostInput({ project, onSaved }) {
  const [cost, setCost] = useState(project.budget ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      await api.patch('/projects/' + project.id, { budget: cost });
      setSaved(true);
      onSaved(project.id, cost);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ marginTop: 6 }}>
      <div className="toolbar" style={{ gap: 6, justifyContent: 'flex-start' }}>
        <label className="muted" style={{ fontSize: 12 }}>
          Estimated cost (₦){' '}
          <input type="number" min="0" step="0.01" value={cost}
                 style={{ width: 140 }}
                 aria-label={'Estimated cost for ' + project.title}
                 onChange={(event) => { setCost(event.target.value); setSaved(false); }} />
        </label>
        <button className="btn sm secondary" type="button" onClick={save} disabled={saving}>
          {saving ? 'Saving' : 'Save'}
        </button>
        {saved && <span className="muted" role="status">Saved</span>}
      </div>
      {error && <div className="error-text">{error}</div>}
    </div>
  );
}

export default function OperationalReport({ data, isAdmin = false }) {
  const report = data.report;
  const [projectOverview, setProjectOverview] = useState(data.project_overview);
  const [selectedUnit, setSelectedUnit] = useState(null);
  const [reportTab, setReportTab] = useState('overview');
  const [dataQuality, setDataQuality] = useState(null);
  const [qualityListTab, setQualityListTab] = useState('duplicates');
  const [qualityLoading, setQualityLoading] = useState(false);
  const [qualityError, setQualityError] = useState('');
  if (!report) return null;
  const saveProjectCost = (projectId, value) => {
    const enteredCost = String(value || '').trim();
    const newCost = enteredCost ? Number(enteredCost) : 0;
    setProjectOverview((current) => {
      if (!current) return current;
      let previousCost = 0;
      const byPollingUnit = current.by_polling_unit.map((unit) => ({
        ...unit,
        projects: unit.projects.map((project) => {
          if (project.id !== projectId) return project;
          const previous = Number(project.budget);
          if (project.budget != null && String(project.budget).trim() !== ''
              && Number.isFinite(previous) && previous >= 0) previousCost = previous;
          return { ...project, budget: enteredCost ? String(newCost) : null };
        }),
      }));
      return {
        ...current,
        estimated_cost_total: Math.max(0, Number(current.estimated_cost_total || 0)
          - previousCost + newCost),
        by_polling_unit: byPollingUnit,
      };
    });
  };
  function exportReport() {
    const rows = [
      ['Metric', 'Count'],
      ['Registered members', report.total],
      ...report.statuses.map((s) => ['Status: ' + s.status, s.n]),
      ['Reviews waiting over 7 days', report.overdue_reviews],
      ...(projectOverview ? [
        ['Total projects', projectOverview.total],
        ['Total estimated project cost', projectOverview.estimated_cost_total],
        ...Object.entries(projectOverview.by_status).map(([status, count]) => [
          'Project status: ' + status, count,
        ]),
        ...projectOverview.by_polling_unit.map((row) => [
          'Projects: ' + row.polling_unit + ' · ' + row.ward + ', ' + row.lga,
          row.projects.map((project) => project.title + ' (estimated cost: '
            + (project.budget ? '₦' + project.budget : 'not set') + ')').join('; '),
        ]),
      ] : []),
      ['Missing phone', report.missing_phone],
      ...data.submissions.map((s) => ['Submission status: ' + s.status, s.n]),
    ];
    const csv = rows.map((r) => r.map((v) => '"' + String(v).replaceAll('"', '""') + '"').join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'administrative-report-' + report.generated_at.slice(0, 10) + '.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const loadDataQuality = async (offset = 0) => {
    setQualityLoading(true);
    setQualityError('');
    try {
      setDataQuality(await api.get('/admin/member-data-quality?limit=50&offset=' + offset));
    } catch (e) {
      setQualityError(e.message);
    } finally {
      setQualityLoading(false);
    }
  };
  const openDataTab = () => {
    setReportTab('data');
    setQualityListTab('duplicates');
    setSelectedUnit(null);
    loadDataQuality(0);
  };
  const openQualityList = (tab) => {
    setQualityListTab(tab);
    loadDataQuality(0);
  };
  const qualityTotal = qualityListTab === 'duplicates'
    ? dataQuality?.duplicate_total || 0 : dataQuality?.problem_total || 0;
  return <div style={{ marginBottom: 20 }}>
    <Card title={isAdmin ? 'Statewide administrative intelligence' : 'Jurisdiction administrative intelligence'}
      note={(isAdmin ? 'All jurisdictions' : 'Your authorised jurisdiction') + ' · All registered records · Updated ' + new Date(report.generated_at).toLocaleString()}
      actions={<button className="btn sm secondary" onClick={exportReport}>Download summary</button>}>
      <div className="tabs" style={{ marginBottom: 16 }} role="tablist" aria-label="Administrative report views">
        <button type="button" role="tab" aria-selected={reportTab === 'overview'}
                className={'tab' + (reportTab === 'overview' ? ' active' : '')}
                onClick={() => setReportTab('overview')}>Overview</button>
        {isAdmin && (
          <button type="button" role="tab" aria-selected={reportTab === 'data'}
                  className={'tab' + (reportTab === 'data' ? ' active' : '')}
                  onClick={openDataTab}>Data received</button>
        )}
      </div>
      {reportTab === 'overview' && (
        <>
      <div className={isAdmin ? 'grid grid-5' : 'grid grid-4'} style={{ marginBottom: 18 }}>
        <Stat label="Verified people" value={num(data.totals.verified)} foot="Records marked verified" />
        <Stat label="People in dataset" value={num(report.total)} foot="All registered records" />
        {isAdmin ? (
              <Stat label="Total projects" value={num(projectOverview?.total)}
                foot="Across all candidate submissions" />
        ) : (
          <Stat label="Reviews over 7 days" value={num(report.overdue_reviews)}
                foot="Pending or flagged since registration" />
        )}
        {isAdmin ? (
          <Stat label="Project status"
                value={num(projectOverview?.by_status?.ongoing) + ' ongoing'}
                foot={num(projectOverview?.by_status?.promised) + ' promised · '
                  + num(projectOverview?.by_status?.completed) + ' completed'} />
        ) : (
          <Stat label="High verification risk" value={num(data.high_risk)}
                foot="Automated check score ≥ 50; requires review" />
        )}
        {isAdmin && (
          <Stat label="Estimated project cost"
                value={naira(projectOverview?.estimated_cost_total)}
                foot="Sum of entered project estimates" />
        )}
      </div>
      {isAdmin && projectOverview && (
        <>
          <h3>Projects by polling unit</h3>
          <p className="muted">All projects grouped by their recorded LGA, ward, and polling unit.</p>
          {projectOverview.by_polling_unit.length ? (
            <div className="table-wrap" style={{ maxHeight: 380, overflowY: 'auto', marginBottom: 18 }}>
              <table>
                <thead><tr><th>LGA</th><th>Ward</th><th>Polling unit</th><th className="num">Projects</th></tr></thead>
                <tbody>{projectOverview.by_polling_unit.map((row) => (
                  <tr key={row.lga + '|' + row.ward + '|' + row.polling_unit}>
                    <td>{row.lga}</td><td>{row.ward}</td><td>{row.polling_unit}</td>
                    <td className="num">
                      <button className="btn sm secondary" type="button"
                              aria-label={'Manage projects for ' + row.polling_unit}
                              onClick={() => setSelectedUnit(row)}>
                        {num(row.project_count)} project{row.project_count === 1 ? '' : 's'}
                      </button>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p className="muted">No projects have been recorded yet.</p>}
        </>
      )}
      <h3>Submission review status</h3>
      <p className="muted">All recorded submissions for members in this scope.</p>
      {data.submissions.length ? data.submissions.map((s) => <Bar key={s.status} label={s.status}
        value={s.n} max={data.submissions.reduce((total, item) => total + item.n, 0)} display={num(s.n)} />)
        : <p className="muted">No submissions recorded yet.</p>}
        </>
      )}
      {isAdmin && reportTab === 'data' && (
        <>
          {qualityError && <div className="alert error">{qualityError}</div>}
          {qualityLoading && <div className="loading">Loading received-data summary...</div>}
          {!qualityLoading && dataQuality && (
            <>
              <p className="muted" style={{ marginTop: 0 }}>
                Data-quality counts cover received member records. Duplicate and verification-problem lists can overlap.
              </p>
              <div className="grid grid-5" style={{ marginBottom: 16 }}>
                <Stat label="Data received" value={num(dataQuality.total_received)} foot="All member records" />
                <Stat label="Unique records" value={num(dataQuality.unique_total)} foot="Excludes duplicates and rejected records" accent />
                <Stat label="Duplicates" value={num(dataQuality.duplicate_total)} foot="Repeated records, counted once each" />
                <Stat label="Rejected records" value={num(dataQuality.rejected_total)} foot="Not included in unique total" />
                <Stat label="Records with issues" value={num(dataQuality.problem_total)} foot="Verification flags; may include duplicates" />
              </div>
              <div className="tabs" style={{ marginBottom: 12 }} role="tablist" aria-label="Received record lists">
                <button type="button" role="tab" aria-selected={qualityListTab === 'duplicates'}
                        className={'tab' + (qualityListTab === 'duplicates' ? ' active' : '')}
                        onClick={() => openQualityList('duplicates')}>Duplicates</button>
                <button type="button" role="tab" aria-selected={qualityListTab === 'problems'}
                        className={'tab' + (qualityListTab === 'problems' ? ' active' : '')}
                        onClick={() => openQualityList('problems')}>Records with problems</button>
              </div>
              {qualityListTab === 'duplicates' ? (
                <>
                  <h3>Duplicate records</h3>
                  <p className="muted">Records sharing a phone, NIN, PVC/VIN, or account number with an earlier non-rejected record.</p>
                  {dataQuality.rows.length ? (
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>Name</th><th>Location</th><th>Status</th><th>Matched on</th><th>Earlier record</th></tr></thead>
                        <tbody>{dataQuality.rows.map((row) => (
                          <tr key={row.id}>
                            <td>
                              <Link to={'/members/' + row.id}>{row.first_name} {row.last_name}</Link>
                              <div className="muted mono">{row.code}</div>
                            </td>
                            <td>{row.polling_unit}<div className="muted">{row.ward}, {row.lga}</div></td>
                            <td>{row.status}</td>
                            <td>{(row.duplicate_fields || []).join(', ')}</td>
                            <td>{(row.duplicate_of || []).map((id) => (
                              <Link key={id} to={'/members/' + id} style={{ marginRight: 8 }}>#{id}</Link>
                            ))}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  ) : <p className="muted">No duplicate records found.</p>}
                </>
              ) : (
                <>
                  <h3>Records with verification problems</h3>
                  <p className="muted">Records with a verification risk score above zero.</p>
                  {dataQuality.problem_rows.length ? (
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>Name</th><th>Location</th><th>Status</th><th>Risk</th><th>Problems</th></tr></thead>
                        <tbody>{dataQuality.problem_rows.map((row) => (
                          <tr key={row.id}>
                            <td>
                              <Link to={'/members/' + row.id}>{row.first_name} {row.last_name}</Link>
                              <div className="muted mono">{row.code}</div>
                            </td>
                            <td>{row.polling_unit}<div className="muted">{row.ward}, {row.lga}</div></td>
                            <td>{row.status}</td>
                            <td><span className="badge amber">{num(row.risk_score)}</span></td>
                            <td>{(row.flags || []).map((flag, index) => (
                              <div key={flag.code + index}>{flag.message || flag.code}</div>
                            ))}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  ) : <p className="muted">No records with verification problems.</p>}
                </>
              )}
              {qualityTotal > dataQuality.limit && (
                <div className="btn-row" style={{ marginTop: 12 }}>
                  <button className="btn sm secondary" disabled={qualityLoading || dataQuality.offset === 0}
                          onClick={() => loadDataQuality(Math.max(0, dataQuality.offset - dataQuality.limit))}>
                    Previous
                  </button>
                  <span className="muted">
                    {dataQuality.offset + 1}–{Math.min(dataQuality.offset + dataQuality.limit, qualityTotal)} of {num(qualityTotal)}
                  </span>
                  <button className="btn sm secondary" disabled={qualityLoading || dataQuality.offset + dataQuality.limit >= qualityTotal}
                          onClick={() => loadDataQuality(dataQuality.offset + dataQuality.limit)}>
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </Card>
    {selectedUnit && (
      <Modal title={'Projects at ' + selectedUnit.polling_unit}
             onClose={() => setSelectedUnit(null)}>
        <p className="muted" style={{ marginTop: 0 }}>
          {selectedUnit.ward}, {selectedUnit.lga} · {num(selectedUnit.project_count)} project{selectedUnit.project_count === 1 ? '' : 's'}
        </p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Project</th><th>Candidate</th><th>Status</th><th>Estimated cost</th></tr></thead>
            <tbody>{selectedUnit.projects.map((project, index) => (
              <tr key={project.id || project.title + index}>
                <td style={{ fontWeight: 600 }}>{project.title}</td>
                <td className="muted">{project.candidate_name}</td>
                <td>{project.status}</td>
                <td><EstimatedCostInput project={project} onSaved={saveProjectCost} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Modal>
    )}
  </div>;
}
