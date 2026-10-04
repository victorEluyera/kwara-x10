import React,{useState} from 'react';
import {Modal,Alert} from './ui.jsx';
import {api} from '../lib/api.js';
export default function DeleteProject({project,onClose,onDeleted}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const remove=async()=>{
    setBusy(true);setError('');
    try{await api.delete('/projects/'+project.id);await onDeleted(project.id);onClose();}
    catch(e){setError(e.message);}finally{setBusy(false);}
  };
  return <Modal title="Delete project" onClose={()=>{if(!busy)onClose();}}>
    {error&&<Alert type="error">{error}</Alert>}
    <p><strong>{project.project_name||project.title}</strong></p>
    <p>{project.candidate_name||''} · {project.lga} / {project.ward}</p>
    <p>This permanently deletes this project and its linked location and evidence records. Project counts and costs will update.</p>
    <div className="btn-row"><button className="btn danger" disabled={busy} onClick={remove}>{busy?'Deleting…':'Delete project'}</button><button className="btn secondary" disabled={busy} onClick={onClose}>Cancel</button></div>
  </Modal>;
}
