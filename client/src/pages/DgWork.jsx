import React, { useState } from 'react';
import Tasks from './Tasks.jsx';
import Compliance from './Compliance.jsx';

export default function DgWork() {
  const [tab, setTab] = useState('tasks');

  return (
    <>
      <div className="tabs">
        <button className={'tab' + (tab === 'tasks' ? ' active' : '')} onClick={() => setTab('tasks')}>
          Task responses
        </button>
        <button className={'tab' + (tab === 'reports' ? ' active' : '')} onClick={() => setTab('reports')}>
          Challenges & disparity reports
        </button>
      </div>
      {tab === 'tasks' ? <Tasks /> : <Compliance />}
    </>
  );
}
