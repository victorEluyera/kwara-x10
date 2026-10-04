import React, { useState } from 'react';
import { Card, Stat, Bar, Empty } from './ui.jsx';
import { num, timeAgo } from '../lib/api.js';
import Submissions from '../pages/Submissions.jsx';

export default function SurveyReports({ tasks, isAdmin, jurisdiction, onReviewed }) {
  const surveys = tasks.filter((task) => task.type === 'survey');
  const [selectedId, setSelectedId] = useState('');
  const [showResponses, setShowResponses] = useState(false);
  const selected = surveys.find((s) => String(s.id) === selectedId) || surveys[0];
  return <div style={{ marginBottom: 20 }}>
    <Card title="Survey reports" note={isAdmin
      ? 'All survey tasks · Responses across all jurisdictions'
      : 'Survey responses within ' + (jurisdiction || 'your assigned jurisdiction')}>
      {!selected ? <Empty title="No survey tasks for this month" /> : <>
        <label htmlFor="survey-report">Select survey</label>
        <select id="survey-report" value={selected.id} style={{ margin: '8px 0 16px' }}
          onChange={(e) => { setSelectedId(e.target.value); setShowResponses(false); }}>
          {surveys.map((survey) => <option key={survey.id} value={survey.id}>{survey.title}</option>)}
        </select>
        <div className="grid grid-4" style={{ marginBottom: 16 }}>
          <Stat label="Responses" value={num(selected.submissions)} foot="Submitted member records" />
          <Stat label="Pending review" value={num(selected.pending)} />
          <Stat label="Approved" value={num(selected.approved)} />
          <Stat label="Rejected" value={num(selected.rejected)} />
        </div>
        {['pending', 'approved', 'rejected'].map((status) => <Bar key={status} label={status}
          value={selected[status]} max={selected.submissions} display={num(selected[status])} />)}
        <p className="muted">{selected.questions.length} question(s) · Latest response: {timeAgo(selected.latest_submission)}.
          {' '}Counts describe submitted records, not a population estimate.</p>
        <button className="btn sm secondary" onClick={() => setShowResponses(!showResponses)}>
          {showResponses ? 'Hide responses' : 'View survey responses'}
        </button>
        {showResponses && <div style={{ marginTop: 16 }}>
          <Submissions key={selected.id} taskId={selected.id} initialStatus="" onReviewed={onReviewed} />
        </div>}
      </>}
    </Card>
  </div>;
}
