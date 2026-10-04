import React, {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {api,num,LEVEL_LABEL} from '../lib/api.js';
import {Card,Loading,Empty,Alert,Stat,Modal,Field} from '../components/ui.jsx';
import {exportReportRows} from '../lib/report-csv.js';
import {networkRows,networkExport} from '../lib/network-analysis.js';
const emptyFilters={search:'',level:'',lga:'',ward:'',upline:'',downline:'',issues:'',sort:'total_downline',direction:'desc'};
export default function Network() {
  const [data,setData]=useState(null),[error,setError]=useState(''),[message,setMessage]=useState('');
  const [filters,setFilters]=useState(emptyFilters),[page,setPage]=useState(0);
  const [group,setGroup]=useState(null),[keepId,setKeepId]=useState(null),[busy,setBusy]=useState(false);
  const root=new URLSearchParams(location.search).get('root');
  const load=()=>api.get('/network'+(root?'?root='+root:'')).then(setData).catch(e=>setError(e.message));
  useEffect(()=>{setData(null);load();},[root]);
  useEffect(()=>{setPage(0);},[filters,data]);
  if(!data)return error?<Alert type="error">{error}</Alert>:<Loading label="Loading your network"/>;
  const rows=data.rows||[],visible=networkRows(rows,filters),issues=visible.filter(r=>r.issues.length);
  const groups=data.duplicate_groups||[];
  const set=(key,value)=>setFilters(f=>({...f,[key]:value,...(key==='lga'?{ward:''}:{})}));
  const review=id=>{const found=groups.find(g=>g.id===id);setGroup(found);setKeepId(found.member_ids[0]);};
  const merge=async()=>{
    if(!window.confirm('Keep the selected record and permanently remove '+(group.member_ids.length-1)+' duplicate record(s)? Linked downlines, logins and submissions will be moved to the kept record.'))return;
    setBusy(true);setError('');
    try{const result=await api.post('/network/merge-duplicates',{keep_id:keepId,member_ids:group.member_ids});setGroup(null);setMessage('Kept one record and removed '+result.removed+' duplicate(s).');await load();}
    catch(e){setError(e.message);}finally{setBusy(false);}
  };
  const groupMembers=group?rows.filter(r=>group.member_ids.includes(r.id)):[];
  return <>
    {root&&<Link className="btn sm secondary" to="/network">Back to full network</Link>}
    {error&&<Alert type="error" onClose={()=>setError('')}>{error}</Alert>}
    {message&&<Alert type="info" onClose={()=>setMessage('')}>{message}</Alert>}
    <div className="grid grid-4" style={{marginBottom:16}}>
      <Stat label="People in network" value={num(rows.length)} accent/>
      <Stat label="Promoters" value={num(rows.filter(r=>r.level==='mobiliser').length)}/>
      <Stat label="Records needing correction" value={num(rows.filter(r=>r.issues.length).length)}/>
      <Stat label="Duplicate VIN groups" value={num(groups.length)}/>
    </div>
    <Card title="Network" note="Downline counts direct reports. VIN/location matched downline counts those whose voter verification matches. Shared phone numbers require review and are not automatically removed.">
      <div className="grid grid-3">
        <Field label="Search"><input value={filters.search} onChange={e=>set('search',e.target.value)} placeholder="Name, phone, VIN, upline or location"/></Field>
        <Field label="Level"><select value={filters.level} onChange={e=>set('level',e.target.value)}><option value="">All levels</option>{[...new Set(rows.map(r=>r.level))].map(l=><option key={l} value={l}>{LEVEL_LABEL[l]||l}</option>)}</select></Field>
        <Field label="Reports to"><select value={filters.upline} onChange={e=>set('upline',e.target.value)}><option value="">All uplines</option>{[...new Map(rows.map(r=>[String(r.upline_id||'root'),r.upline])).entries()].map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></Field>
        <Field label="LGA"><select value={filters.lga} onChange={e=>set('lga',e.target.value)}><option value="">All LGAs</option>{[...new Set(rows.map(r=>r.lga))].sort().map(l=><option key={l}>{l}</option>)}</select></Field>
        <Field label="Ward"><select value={filters.ward} onChange={e=>set('ward',e.target.value)}><option value="">All wards</option>{[...new Set(rows.filter(r=>!filters.lga||r.lga===filters.lga).map(r=>r.ward))].sort().map(w=><option key={w}>{w}</option>)}</select></Field>
        <Field label="Downline"><select value={filters.downline} onChange={e=>set('downline',e.target.value)}><option value="">All downlines</option><option value="none">No downline</option><option value="some">Has downline</option><option value="below">Fewer than 10</option><option value="target">10 or more</option></select></Field>
        <Field label="Issues"><select value={filters.issues} onChange={e=>set('issues',e.target.value)}><option value="">All records</option><option value="issues">Needs correction</option><option value="clean">No detected issues</option><option value="duplicates">Duplicate VIN</option>{[...new Set(rows.flatMap(r=>r.issues))].filter(i=>i!=='Duplicate VIN').sort().map(i=><option key={i}>{i}</option>)}</select></Field>
        <Field label="Sort by"><select value={filters.sort} onChange={e=>set('sort',e.target.value)}>{[['total_downline','Downline'],['verified_downline','VIN/location matched downline'],['name','Name'],['upline','Reports to'],['lga','LGA'],['ward','Ward']].map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></Field>
        <Field label="Order"><select value={filters.direction} onChange={e=>set('direction',e.target.value)}><option value="desc">Highest first / Z–A</option><option value="asc">Lowest first / A–Z</option></select></Field>
      </div>
      <div className="toolbar" style={{flexWrap:'wrap',gap:8}}>
        <span>Showing {num(visible.length)} of {num(rows.length)} · {num(issues.length)} needing correction</span>
        <button className="btn sm secondary" onClick={()=>setFilters(emptyFilters)}>Clear filters</button>
        <button className="btn sm secondary" disabled={!visible.length} onClick={()=>exportReportRows(networkExport(visible),'network-filtered.csv')}>Export matching records</button>
        <button className="btn sm secondary" disabled={!issues.length} onClick={()=>exportReportRows(networkExport(issues),'network-corrections.csv')}>Export correction list</button>
      </div>
      {!visible.length?<Empty title="No matching records"/>:<div className="table-wrap" style={{maxHeight:480,overflowY:'auto'}}><table data-native-tools="true"><thead><tr><th>Name</th><th>Reports to</th><th>Level</th><th>LGA / Ward</th><th>Polling unit</th><th>Downline</th><th>VIN/location matched</th><th>Issues</th></tr></thead><tbody>{visible.slice(page*100,(page+1)*100).map(r=><tr key={r.id}>
        <td><Link to={'/members/'+r.id}>{r.name}</Link><div className="muted">{r.code}</div></td><td>{r.upline}</td><td>{LEVEL_LABEL[r.level]||r.level}</td><td>{r.lga}<div>{r.ward}</div></td><td>{r.polling_unit||'--'}</td><td>{num(r.total_downline)}</td><td>{num(r.verified_downline)}</td><td>{r.issues.length?r.issues.map(i=><div key={i}>{i}</div>):'--'}{r.duplicate_group&&<button className="btn sm secondary" onClick={()=>review(r.duplicate_group)}>Review duplicates</button>}</td>
      </tr>)}</tbody></table></div>}
      {visible.length>100&&<div className="btn-row"><button className="btn sm secondary" disabled={!page} onClick={()=>setPage(page-1)}>Previous</button><span>{page*100+1}–{Math.min((page+1)*100,visible.length)} of {num(visible.length)}</span><button className="btn sm secondary" disabled={(page+1)*100>=visible.length} onClick={()=>setPage(page+1)}>Next</button></div>}
    </Card>
    {group&&<Modal title="Review duplicate VIN records" onClose={()=>{if(!busy)setGroup(null);}} wide>
      <p>Choose the correct record to keep. Its details and voter verification stay unchanged. Downlines, linked logins and submissions are retained.</p>
      {group.reason&&<Alert type="warn">{group.reason}. Correct the conflicting records before trying to consolidate.</Alert>}
      <div className="table-wrap"><table><thead><tr><th>Keep</th><th>Name / Code</th><th>VIN</th><th>Location</th><th>Downline</th><th>Verification</th></tr></thead><tbody>{groupMembers.map(r=><tr key={r.id}><td><input type="radio" name="keep-duplicate" checked={keepId===r.id} onChange={()=>setKeepId(r.id)} aria-label={'Keep '+r.code}/></td><td><Link to={'/members/'+r.id}>{r.name}</Link><div>{r.code}</div></td><td>{r.pvc_no}</td><td>{r.lga} / {r.ward} / {r.polling_unit}</td><td>{r.total_downline}</td><td>{r.vin_verification_status}</td></tr>)}</tbody></table></div>
      <div className="btn-row"><button className="btn secondary" disabled={busy} onClick={()=>setGroup(null)}>Cancel</button><button className="btn danger" disabled={busy||!group.can_merge||!data.can_merge} onClick={merge}>{busy?'Consolidating…':'Keep selected record; remove duplicates'}</button></div>
    </Modal>}
  </>;
}
