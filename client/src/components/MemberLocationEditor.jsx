import React,{useEffect,useState} from 'react';
import {Modal,Loading,Alert} from './ui.jsx';
import {api,num} from '../lib/api.js';
export default function MemberLocationEditor({member,geo,onClose,onSaved}) {
  const [preview,setPreview]=useState(null),[error,setError]=useState(''),[saving,setSaving]=useState(false);
  const [mode,setMode]=useState('single');
  const [selected,setSelected]=useState(new Set()),[search,setSearch]=useState(''),[page,setPage]=useState(0);
  const [target,setTarget]=useState({lga:geo.lgas.includes(member.lga)?member.lga:'',ward:'',polling_unit:''});
  useEffect(()=>{let active=true;api.get('/members/'+member.id+'/location-edit').then(r=>{if(active){setPreview(r);setSelected(new Set(r.sample.map(m=>Number(m.id))));}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[member.id]);
  const wards=geo.wards[target.lga]||[],units=geo.polling_units[target.lga]?.[target.ward]||[];
  const matching=(preview?.sample||[]).filter(r=>[r.code,r.first_name,r.last_name,r.phone,r.candidate_name,r.upline_user_id].join(' ').toLowerCase().includes(search.trim().toLowerCase()));
  const visible=matching.slice(page*50,(page+1)*50);
  const count=mode==='single'?1:selected.size;
  const toggle=id=>setSelected(current=>{const next=new Set(current);next.has(Number(id))?next.delete(Number(id)):next.add(Number(id));return next;});
  const save=async e=>{e.preventDefault();setSaving(true);setError('');try{
    const result=await api.patch('/members/'+member.id+'/location-edit',{mode,target,source:preview.source,expected_count:count,...(mode==='selected'?{member_ids:[...selected]}:{})});
    await onSaved(result);onClose();
  }catch(e){setError(e.message);}finally{setSaving(false);}};
  return <Modal title="Edit location" onClose={()=>{if(!saving)onClose();}}>
    {error&&<Alert type="error">{error}</Alert>}
    {!preview?(error?null:<Loading label="Loading matching records"/>):<form onSubmit={save}>
      <p><strong>{member.first_name} {member.last_name}</strong> · {member.code}</p>
      <p>Current: {preview.source.lga||'--'} / {preview.source.ward||'--'} / {preview.source.polling_unit||'--'}</p>
      <label>LGA<select required disabled={saving} value={target.lga} onChange={e=>setTarget({lga:e.target.value,ward:'',polling_unit:''})}><option value="">Select LGA</option>{geo.lgas.map(v=><option key={v}>{v}</option>)}</select></label>
      <label>Ward<select required disabled={saving||!target.lga} value={target.ward} onChange={e=>setTarget({...target,ward:e.target.value,polling_unit:''})}><option value="">Select ward</option>{wards.map(v=><option key={v}>{v}</option>)}</select></label>
      <label>Polling unit<select required disabled={saving||!target.ward} value={target.polling_unit} onChange={e=>setTarget({...target,polling_unit:e.target.value})}><option value="">Select polling unit</option>{units.map(v=><option key={v}>{v}</option>)}</select></label>
      <label>Apply to<select disabled={saving} value={mode} onChange={e=>setMode(e.target.value)}><option value="single">This member only</option><option value="selected">Choose from {num(preview.total)} matching records</option></select></label>
      {mode==='selected'&&<>
        <div className="toolbar"><input type="search" placeholder="Search name, code, phone or candidate" aria-label="Search matching members" disabled={saving} value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}/><button type="button" className="btn sm secondary" disabled={saving} onClick={()=>setSelected(new Set(preview.sample.map(r=>Number(r.id))))}>Select all</button><button type="button" className="btn sm secondary" disabled={saving} onClick={()=>setSelected(new Set())}>Clear selection</button></div>
        <p aria-live="polite">{num(selected.size)} selected · {num(preview.total-selected.size)} unchanged</p>
        <div className="table-wrap" style={{maxHeight:300,overflowY:'auto'}}><table><thead><tr><th>Select</th><th>Code / Name</th><th>Phone</th><th>Current location</th><th>Registered by</th></tr></thead><tbody>{visible.map(r=><tr key={r.id}><td><input type="checkbox" aria-label={'Update '+r.first_name+' '+r.last_name+' '+r.code} disabled={saving} checked={selected.has(Number(r.id))} onChange={()=>toggle(r.id)}/></td><td>{r.code}<div>{r.first_name} {r.last_name}</div></td><td>{r.phone||'--'}</td><td>{r.lga} / {r.ward} / {r.polling_unit||'--'}</td><td>{r.candidate_name||'--'}</td></tr>)}</tbody></table></div>
        <div className="btn-row"><button type="button" className="btn sm secondary" disabled={saving||page===0} onClick={()=>setPage(p=>p-1)}>Previous</button><span>{num(matching.length)} matching records · Page {page+1} of {Math.max(1,Math.ceil(matching.length/50))}</span><button type="button" className="btn sm secondary" disabled={saving||(page+1)*50>=matching.length} onClick={()=>setPage(p=>p+1)}>Next</button></div>
      </>}
      <div className="btn-row" style={{marginTop:16}}><button className="btn" disabled={saving||!target.polling_unit||count===0}>{saving?'Saving…':'Save '+num(count)+' '+(count===1?'member':'members')}</button><button type="button" className="btn secondary" disabled={saving} onClick={onClose}>Cancel</button></div>
    </form>}
  </Modal>;
}
