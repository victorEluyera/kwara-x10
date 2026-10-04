import React,{useState} from 'react';
import {Modal,Field,Alert} from './ui.jsx';
import {api,naira,num} from '../lib/api.js';
export default function ProjectCostEditor({project,onClose,onSaved}) {
  const [amount,setAmount]=useState(project.budget??project.estimated_cost??''),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const save=async budget=>{
    setSaving(true);setError('');
    try{await api.patch('/projects/'+project.id,{budget});await onSaved();onClose();}
    catch(e){setError(e.message);}finally{setSaving(false);}
  };
  return <Modal title={project.estimated_cost==null?'Add project cost':'Edit project cost'} onClose={()=>{if(!saving)onClose();}}>
    {error&&<Alert type="error">{error}</Alert>}
    <p><strong>{project.project_name||project.title}</strong> · {project.lga} / {project.ward}</p>
    <p>Quantity: {num(project.quantity)} {project.unit||''}</p>
    <form onSubmit={e=>{e.preventDefault();const value=Number(amount);if(String(amount).trim()===''||!Number.isFinite(value)||value<0){setError('Enter a valid estimated cost');return;}save(value);}}>
      <Field label="Estimated total request cost (NGN)"><input type="number" required min="0" step="0.01" disabled={saving} value={amount} onChange={e=>setAmount(e.target.value)}/></Field>
      <p className="hint">Total for this entire request, including all {num(project.quantity)} {project.unit||'items'}.</p>
      <div className="btn-row"><button className="btn" disabled={saving}>{saving?'Saving…':'Save cost'}</button><button type="button" className="btn secondary" disabled={saving} onClick={onClose}>Cancel</button></div>
    </form>
    {project.budget!=null&&String(project.budget).trim()!==''&&<button className="btn secondary sm" disabled={saving} style={{marginTop:12}} onClick={()=>save(null)}>Use catalogue estimate{project.unit_cost==null?'':': '+naira(project.unit_cost*Math.max(1,Number(project.quantity)||1))}</button>}
  </Modal>;
}
