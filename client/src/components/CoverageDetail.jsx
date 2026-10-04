import {pollingUnitStatus} from '../lib/polling-unit-status.js';
import React,{useEffect,useState} from 'react';
import {Modal,Loading,Alert} from './ui.jsx';
import {api,num} from '../lib/api.js';
import {exportReportRows} from '../lib/report-csv.js';
export default function CoverageDetail({row,kind='lga',onClose}) {
  const [wards,setWards]=useState(null),[units,setUnits]=useState(null),[search,setSearch]=useState(''),[error,setError]=useState('');
  useEffect(()=>{
    if(kind==='unit')return;
    let active=true;
    setError(''); setWards(null); setUnits(null); setSearch('');
    let fullLoaded=false;
    const apply=data=>{if(!active)return;if(kind==='ward')setUnits(data.units.filter(u=>u.lga===row.lga&&u.ward===row.ward));else setWards(data.wards.filter(w=>w.lga===row.lga));};
    api.get('/dashboard/area-report?view=coverage').then(data=>{if(!fullLoaded)apply(data);}).catch(e=>{if(active&&!fullLoaded)setError(e.message);});
    api.get('/dashboard/area-report').then(data=>{fullLoaded=true;if(active)setError('');apply(data);}).catch(e=>{if(active)setError(e.message);});
    return ()=>{active=false;};
  },[kind,row.lga,row.ward]);
  const visibleUnits=(units||[]).filter(u=>u.polling_unit.toLowerCase().includes(search.trim().toLowerCase()));
  const unit=kind==='unit';
  const reached=unit?Number(Boolean(row.reached)):Number(row.units_reached??row.units??row.reached??0);
  const total=unit?1:Number(row.polling_units??row.units_expected??row.expected??0);
  const allocated=row.promoters_allocated??(unit?row.promoters:null);
  const unallocated=row.promoters_unallocated??(allocated==null?null:Math.max(0,Number(row.promoters||0)-allocated));
  const details=[['LGA',row.lga],...(kind!=='lga'?[['Ward',row.ward]]:[]),...(unit?[['Polling unit',row.polling_unit]]:[]),
    ['Registered promoters',num(row.promoters||0)],['PDP',(row.pdp_people==null?'Not loaded':num(row.pdp_people))],...(row.promoters_expected!=null?[['Expected promoters',num(row.promoters_expected)],['Target calculation',num(row.units_expected)+' PUs × '+num(row.promoters_per_pu)+' promoters']]:[]),...(allocated!=null?[['Promoters with valid PU allocation',num(allocated)]]:[]),...(unallocated!=null?[['Promoters needing PU allocation',num(unallocated)]]:[]),
    ...(kind==='lga'?[['Ward coverage',num(row.wards)+' / '+num(row.wards_expected)],['Wards remaining',num(Math.max(0,row.wards_expected-row.wards))]]:[]),
    ['PU coverage',num(reached)+' / '+num(total)],['Polling units remaining',num(Math.max(0,total-reached))],['PU coverage percentage',total?Math.round(reached/total*100)+'%':'--'],
    ...(row.people!=null?[['All registrations',num(row.people)]]:[]),
    ...(kind!=='lga'?[['Voters',row.voters==null?'Not loaded':num(row.voters)],['Projects',num(Array.isArray(row.projects)?row.projects.length:row.projects||0)]]:[]),
  ];
  return <Modal title={kind==='lga'?row.lga:kind==='ward'?row.lga+' / '+row.ward:row.polling_unit} onClose={onClose}>
    <dl className="kv">{details.map(([label,value])=><React.Fragment key={label}><dt>{label}</dt><dd>{value}</dd></React.Fragment>)}</dl>
    <p className="hint">Promoter totals include registered unit promoters. PU allocation counts only recognised polling units. A polling unit is reached when it has a registration. A ward is reached when at least one recognised polling unit is reached. Voters are records in the uploaded voter register.</p>
    {unallocated>0&&<Alert type="warn">{num(unallocated)} promoter record(s) still need a valid polling-unit allocation. Check the submitted LGA, ward and PU against the official directory. These records remain registered and do not increase coverage until resolved.</Alert>}
    {reached===0&&<p>No recognised polling unit is reached in this {kind==='lga'?'LGA':kind==='ward'?'ward':'location'} yet.</p>}
    {kind==='lga'&&<>
      <h3>Ward breakdown</h3>
      {error?<Alert type="error">{error}</Alert>:wards===null?<Loading label="Loading ward breakdown"/>:<>
        <p>{num(wards.length)} wards · Voters: {wards.some(w=>w.voters!=null)?num(wards.reduce((n,w)=>n+(w.voters||0),0)):'Not loaded'} · Projects: {num(wards.reduce((n,w)=>n+w.projects,0))}</p>
        <div className="table-wrap" style={{maxHeight:260,overflowY:'auto'}}><table><thead><tr><th>Ward</th><th>PU cov</th><th>Unit gap</th><th>PDP</th><th>Voters</th><th>Projects</th></tr></thead><tbody>{wards.map(w=><tr key={w.ward}><td>{w.ward}</td><td>{w.units_reached}/{w.polling_units}</td><td>{w.units_remaining}</td><td>{(w.pdp_people==null?'Not loaded':num(w.pdp_people))}</td><td>{w.voters==null?'Not loaded':num(w.voters)}</td><td>{w.projects}</td></tr>)}</tbody></table></div>
      </>}
    </>}
    {kind==='ward'&&<>
      <h3>Polling units in this ward</h3>
      {error?<Alert type="error">{error}</Alert>:units===null?<Loading label="Loading polling units"/>:<>
        <div className="toolbar"><input type="search" aria-label="Search ward polling units" placeholder="Search polling units" value={search} onChange={e=>setSearch(e.target.value)}/><button className="btn sm secondary" onClick={()=>exportReportRows(visibleUnits.map(u=>({LGA:u.lga,Ward:u.ward,'Polling unit':u.polling_unit,'PU cov':pollingUnitStatus(u.promoters),Promoters:u.promoters,PDP:u.pdp_people??'Not loaded',Voters:u.voters??'Not loaded',Projects:u.projects.length})),'ward-polling-units.csv')}>Export polling units</button></div>
        <p className="muted">Showing {num(visibleUnits.length)} of {num(units.length)} polling units</p>
        <div className="table-wrap" style={{maxHeight:340,overflowY:'auto'}}><table data-native-tools="true"><thead><tr><th>Polling unit</th><th>PU cov</th><th>Promoter</th><th>PDP</th><th>Voters</th><th>Projects</th></tr></thead><tbody>{visibleUnits.map(u=><tr key={u.polling_unit}><td>{u.polling_unit}</td><td>{pollingUnitStatus(u.promoters)}</td><td>{num(u.promoters)}</td><td>{(u.pdp_people==null?'Not loaded':num(u.pdp_people))}</td><td>{u.voters==null?'Not loaded':num(u.voters)}</td><td>{num(u.projects.length)}</td></tr>)}</tbody></table></div>
      </>}
    </>}
    {unit&&row.projects?.length>0&&<><h3>Projects</h3>{row.projects.map(p=><p key={p.id}>{p.title}</p>)}</>}
    <button className="btn sm secondary" onClick={()=>exportReportRows(details.map(([Metric,Value])=>({Metric,Value})),'coverage-detail.csv')}>Export this summary</button>
  </Modal>;
}
