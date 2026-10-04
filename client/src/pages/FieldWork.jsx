import React, { useEffect, useState } from 'react';
import Tasks from './Tasks.jsx';
import { api } from '../lib/api.js';
import { Alert, Card, Field, Loading } from '../components/ui.jsx';

function FieldReport() {
  const [report, setReport] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [disparities, setDisparities] = useState('');
  const [challenges, setChallenges] = useState('');
  const [positives, setPositives] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [gps, setGps] = useState(null);

  const captureGps = () => new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Turn on location services before submitting this report.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const captured = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        };
        setGps(captured);
        resolve(captured);
      },
      () => reject(new Error('Turn on location services before submitting this report.')),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });

  useEffect(() => {
    navigator.permissions?.query({ name: 'geolocation' })
      .then((permission) => {
        if (permission.state === 'granted') captureGps().catch(() => {});
      }).catch(() => {});
  }, []);

  useEffect(() => {
    api.get('/disparity-report').then((data) => {
      setReport(data.report);
      setDisparities(data.report?.disparities || '');
      setChallenges(data.report?.challenges || '');
      setPositives(data.report?.positives || '');
      setLoaded(true);
    }).catch((err) => { setError(err.message); setLoaded(true); });
    return () => setLoaded(false);
  }, []);

  const save = async (event) => {
    event.preventDefault();
    setBusy(true); setMessage(''); setError('');
    try {
      const capturedGps = gps || await captureGps();
      const data = await api.post('/disparity-report', { disparities, challenges, positives, ...capturedGps });
      setReport(data.report);
      setMessage('Report submitted successfully.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (error && !report) return <Alert type="error">{error}</Alert>;
  if (!loaded && error === '') return <Loading label="Loading report" />;

  return (
    <Card title="Field report" note="Share challenges, disparities, or issues from your assigned area">
      {error && <Alert type="error">{error}</Alert>}
      {message && <Alert type="success">{message}</Alert>}
      <form onSubmit={save}>
        <Field label="Disparities">
          <textarea value={disparities} onChange={(event) => setDisparities(event.target.value)}
                    placeholder="Describe gaps in people, services, infrastructure, or support." />
        </Field>
        <Field label="Challenges">
          <textarea value={challenges} onChange={(event) => setChallenges(event.target.value)}
                    placeholder="Describe the practical challenges in your area." />
        </Field>
        <Field label="Positives">
          <textarea value={positives} onChange={(event) => setPositives(event.target.value)}
                    placeholder="Describe what is a positive or progress worth reporting." />
        </Field>
        <button className="btn" disabled={busy}>
          {busy && <span className="spinner" />}{report ? 'Update report' : 'Submit report'}
        </button>
      </form>
    </Card>
  );
}

export default function FieldWork() {
  const [tab, setTab] = useState('tasks');

  return (
    <>
      <div className="tabs">
        <button className={'tab' + (tab === 'tasks' ? ' active' : '')} onClick={() => setTab('tasks')}>
          Tasks
        </button>
        <button className={'tab' + (tab === 'report' ? ' active' : '')} onClick={() => setTab('report')}>
          Report
        </button>
      </div>
      {tab === 'tasks' ? <Tasks /> : <FieldReport />}
    </>
  );
}
