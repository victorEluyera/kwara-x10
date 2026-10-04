import React,{useEffect,useState} from 'react';
import {api,num} from '../lib/api.js';
import {Stat,Modal,Alert} from './ui.jsx';
export default function PdpPromoterOverlap(){
  const [data,setData]=useState(null),[open,setOpen]=useState(false),[file,setFile]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const load=()=>api.get('/dashboard/pdp-promoters').then(setData).catch(error=>setError(error.message));
  useEffect(()=>{load();},[]);
  const upload=async()=>{
    setBusy(true);setError('');
    try{const body=new FormData();body.append('file',file);await api.form('/admin/pdp-contact-list',body);await load();setOpen(false);}
    catch(error){setError(error.message);}finally{setBusy(false);}
  };
  return <div>
    <Stat label="PDP members who are 10X promoters" value={data?.loaded?num(data.matched_promoters):data?'Not loaded':'Loading...'}
      foot={data?.loaded?'Matched by name + phone against the supplied PDP list; each person counted once.':'Load the PDP contact list to calculate the overlap.'}/>
    <button className="btn secondary sm" style={{marginTop:8}} onClick={()=>setOpen(true)}>Load / update PDP matching list</button>
    {error&&!open&&<Alert type="error">{error}</Alert>}
    {open&&<Modal title="Load PDP list for promoter matching" onClose={()=>{if(!busy)setOpen(false);}}>
      {error&&<Alert type="error">{error}</Alert>}
      <p>Upload the supplied PDP contact CSV, including names and phone numbers. This replaces the matching index and recalculates the overlap. It does not change members or the existing PDP area totals.</p>
      <p>Only private keyed matching hashes are stored. A match means the person appears in the supplied list; it does not independently confirm party membership.</p>
      <input type="file" accept=".csv" disabled={busy} onChange={event=>setFile(event.target.files?.[0]||null)}/>
      <div className="btn-row" style={{marginTop:16}}><button className="btn" disabled={!file||busy} onClick={upload}>{busy?'Loading matching list...':'Load and calculate'}</button><button className="btn secondary" disabled={busy} onClick={()=>setOpen(false)}>Cancel</button></div>
    </Modal>}
  </div>;
}
