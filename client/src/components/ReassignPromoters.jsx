import React,{useEffect,useMemo,useState} from 'react';
import {Modal,Loading,Alert} from './ui.jsx';
import {api,num,normalizeRole} from '../lib/api.js';
export default function ReassignPromoters({account,accounts,onClose,onSaved}) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[selected,setSelected]=useState(new Set()),[target,setTarget]=useState(''),[search,setSearch]=useState(''),[page,setPage]=useState(0),[review,setReview]=useState(false),[saving,setSaving]=useState(false);
  useEffect(()=>{let active=true;api.get('/users/'+account.id+'/promoter-reassignment').then(r=>{if(active){setData(r);if(r.rows.length===1)setSelected(new Set([Number(r.rows[0].id)]));}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[account.id]);
  const destinations=accounts.filter(a=>normalizeRole(a.role)==='candidate'&&a.status==='active'&&Number(a.id)!==Number(account.id));
  const destination=destinations.find(a=>String(a.id)===target);
  const filtered=useMemo(()=>(data?.rows||[]).filter(r=>[r.code,r.first_name,r.last_name,r.phone,r.lga,r.ward,r.polling_unit].join(' ').toLowerCase().includes(search.trim().toLowerCase())),[data,search]);
  const toggle=id=>setSelected(prev=>{const next=new Set(prev);next.has(Number(id))?next.delete(Number(id)):next.add(Number(id));return next;});
  const save=async()=>{
    setSaving(true);setError('');
    try{
      const owners=Object.fromEntries(data.rows.filter(r=>selected.has(Number(r.id))).map(r=>[r.id,r.upline_user_id]));
      const result=await api.post('/users/'+account.id+'/promoter-reassignment',{target_id:Number(target),member_ids:[...selected],owners});
      await onSaved(result);onClose();
    }catch(e){setError(e.message);}finally{setSaving(false);}
  };
  return <Modal title="Reassign promoters" onClose={()=>{if(!saving)onClose();}}>
    {error&&<Alert type="error">{error}</Alert>}
    {!data?(error?null:<Loading label="Loading promoters"/>):review?<>
      <p>Reassign <strong>{num(selected.size)} promoters</strong> from <strong>{account.full_name}</strong> to <strong>{destination?.full_name}</strong> ({destination?.office||'Candidate'}).</p>
      <p>{num(data.rows.length-selected.size)} unselected promoters stay unchanged. Linked promoter accounts and their existing downlines follow the new ownership.</p>
      <div className="btn-row"><button className="btn" disabled={saving} onClick={save}>{saving?'Reassigning…':'Confirm reassignment'}</button><button className="btn secondary" disabled={saving} onClick={()=>setReview(false)}>Back</button></div>
    </>:<>
      <p><strong>{account.full_name}</strong> · {num(data.rows.length)} promoters available</p>
      <label>Rightful candidate / stakeholder<select value={target} onChange={e=>setTarget(e.target.value)}><option value="">Choose destination</option>{destinations.map(a=><option key={a.id} value={a.id}>{a.full_name} · {a.office||'Candidate'} · {a.scope_value||'Statewide'}</option>)}</select></label>
      <div className="toolbar"><input type="search" aria-label="Search promoters to reassign" placeholder="Search name, code, phone or location" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}/><button className="btn secondary sm" onClick={()=>setSelected(new Set(data.rows.map(r=>Number(r.id))))}>Select all</button><button className="btn secondary sm" onClick={()=>setSelected(new Set())}>Clear</button></div>
      <p aria-live="polite">{num(selected.size)} selected · {num(data.rows.length-selected.size)} unchanged</p>
      <div className="table-wrap" style={{maxHeight:300,overflowY:'auto'}}><table><thead><tr><th>Select</th><th>Name / Code</th><th>Phone</th><th>LGA / Ward</th><th>Polling unit</th></tr></thead><tbody>{filtered.slice(page*50,(page+1)*50).map(r=><tr key={r.id}><td><input type="checkbox" aria-label={'Reassign '+r.first_name+' '+r.last_name+' '+r.code} checked={selected.has(Number(r.id))} onChange={()=>toggle(r.id)}/></td><td>{r.first_name} {r.last_name}<div>{r.code}</div></td><td>{r.phone||'--'}</td><td>{r.lga} / {r.ward}</td><td>{r.polling_unit||'--'}</td></tr>)}</tbody></table></div>
      <div className="btn-row"><button className="btn sm secondary" disabled={page===0} onClick={()=>setPage(p=>p-1)}>Previous</button><span>{num(filtered.length)} matches · Page {page+1} of {Math.max(1,Math.ceil(filtered.length/50))}</span><button className="btn sm secondary" disabled={(page+1)*50>=filtered.length} onClick={()=>setPage(p=>p+1)}>Next</button></div>
      <div className="btn-row" style={{marginTop:16}}><button className="btn" disabled={!destination||selected.size===0} onClick={()=>setReview(true)}>Review {num(selected.size)} reassignment(s)</button><button className="btn secondary" onClick={onClose}>Cancel</button></div>
    </>}
  </Modal>;
}
