import React, { useEffect, useState } from 'react';
import { api, num } from '../lib/api.js';
import { Card, Alert, Loading } from './ui.jsx';

import PromoterDelivery from './PromoterDelivery.jsx';
import AspirantsDirectory from './AspirantsDirectory.jsx';
import ProjectIntelligence from './ProjectIntelligence.jsx';
export default function AdminCandidateReport({view = 'candidates'}) {
  const [data, setData] = useState(null), [error, setError] = useState('');
  const tab = view;
  useEffect(() => { api.get(view === 'projects' ? '/dashboard/candidate-report' : '/dashboard/candidate-report?view=summary').then(setData).catch(e => setError(e.message)); }, [view]);
  if (error) return <Alert type="error">{error}</Alert>;
  if (!data) return <Loading label="Loading promoter delivery" />;
  return <>
    {tab === 'candidates' && <PromoterDelivery rows={data.rows} />}
    {tab === 'directory' && <AspirantsDirectory rows={data.rows} />}
    {tab === 'projects' && <ProjectIntelligence projects={data.projects} candidates={data.rows} />}
  </>;
}
