import React, {useMemo,useState} from 'react';
import {Card,Empty,Stat} from './ui.jsx';
import {num,naira} from '../lib/api.js';
import {PROJECT_REPORT_TYPES,projectType} from '../lib/project-report.js';
import {exportReportRows} from '../lib/report-csv.js';

export default function ProjectIntelligence({projects,candidates}) {
  const [q,setQ]=useState(''),[candidate,setCandidate]=useState(''),[lga,setLga]=useState(''),[ward,setWard]=useState(''),[type,setType]=useState('');
  const [minCost,setMinCost]=useState(''),[maxCost,setMaxCost]=useState(''),[minVoters,setMinVoters]=useState(''),[maxVoters,setMaxVoters]=useState('');
  const [group,setGroup]=useState(''),[order,setOrder]=useState('cost'),[direction,setDirection]=useState('desc'),[others,setOthers]=useState(false),[page,setPage]=useState(0);
  const names=useMemo(()=>Object.fromEntries(candidates.map(c=>[c.candidate_id,c.candidate_name])),[candidates]);
  const all=useMemo(()=>projects.map(p=>({...p,candidate_name:names[p.candidate_id]||p.candidate_name||'---',type:projectType(p)})),[projects,names]);
  const range=(v,min,max)=>(min===''||v!==null&&v>=Number(min))&&(max===''||v!==null&&v<=Number(max));
  const filtered=all.filter(p=>(!candidate||String(p.candidate_id)===candidate)&&(!lga||p.lga===lga)&&(!ward||JSON.stringify([p.lga,p.ward])===ward)&&(!type||p.type===type)&&range(p.estimated_cost,minCost,maxCost)&&range(p.ward_voters,minVoters,maxVoters)&&[p.candidate_name,p.title,p.project_name,p.lga,p.ward,p.type].join(' ').toLowerCase().includes(q.trim().toLowerCase()));
  filtered.sort((a,b)=>{const field={cost:'estimated_cost',voters:'ward_voters',count:'quantity',candidate:'candidate_name',lga:'lga',ward:'ward'}[order];const av=a[field],bv=b[field];if(av==null||bv==null)return av==null?(bv==null?0:1):-1;return(typeof av==='number'?av-bv:String(av).localeCompare(String(bv)))*(direction==='asc'?1:-1)||a.id-b.id;});
  const summary=PROJECT_REPORT_TYPES.filter(t=>!type||type===t).map(t=>{
    const list=filtered.filter(p=>p.type===t),wards=new Map();let cost=0;
    for(const p of list){wards.set(JSON.stringify([p.lga,p.ward]),{voters:p.ward_voters,units:p.ward_polling_units,pdp:p.pdp_people});cost+=Number(p.estimated_cost||0);}
    return {pdp:[...wards.values()].some(w=>w.pdp==null)?null:[...wards.values()].reduce((sum,w)=>sum+w.pdp,0),type:t,count:list.reduce((s,p)=>s+Number(p.quantity||1),0),voters:!list.length?0:[...wards.values()].some(v=>v.voters===null)?null:[...wards.values()].reduce((s,v)=>s+v.voters,0),units:[...wards.values()].some(v=>v.units==null)?null:[...wards.values()].reduce((s,v)=>s+v.units,0),cost,list};
  });
  const showCost=v=>v===null?'---':naira(v);
  const priced=filtered.filter(p=>p.estimated_cost!=null);
  const totalCost=priced.reduce((sum,p)=>sum+Number(p.estimated_cost),0);
  const projectWards=new Map(filtered.map(p=>[JSON.stringify([p.lga,p.ward]),p.ward_voters]));
  const knownWardVoters=[...projectWards.values()].filter(v=>v!=null).reduce((sum,v)=>sum+Number(v),0);
  const unknownWards=[...projectWards.values()].filter(v=>v==null).length;
  const showVoters=v=>v===null?'---':num(v);
  const format=p=>({candidate:p.candidate_name,lga:p.lga,ward:p.ward,projects:p.title,type:p.type,count:p.quantity,project_cost:p.estimated_cost??'---',voter_per_ward:p.ward_voters??'---',PDP:p.pdp_people??'Not loaded'});
  const groups=new Map();for(const p of filtered.slice(page*100,(page+1)*100)){const label=group==='candidate'?p.candidate_name:group==='lga'?p.lga:group==='ward'?`${p.lga} / ${p.ward}`:group==='type'?p.type:'All projects';if(!groups.has(label))groups.set(label,[]);groups.get(label).push(p);}
  const costOptions=[...new Set([0,100000,500000,1000000,2000000,5000000,10000000,25000000,50000000,100000000,250000000,500000000,1000000000,...all.map(p=>p.estimated_cost).filter(v=>v!=null)])].sort((a,b)=>a-b);
  const voterOptions=[...new Set([0,1000,5000,10000,25000,50000,100000,250000,...all.map(p=>p.ward_voters).filter(v=>v!=null)])].sort((a,b)=>a-b);
  const change=setter=>e=>{setter(e.target.value);setPage(0);};
  return <>
    <Card title="Project intelligence" note="Voters are counted once per project ward within each type; type totals can overlap. Polling units total all official units in distinct project wards, counted once per type. Cost sums available project estimates.">
      <div className="toolbar">
        <input type="search" aria-label="Search project intelligence" placeholder="Search projects, candidates or locations" value={q} onChange={change(setQ)}/>
        <select aria-label="Project candidate" value={candidate} onChange={change(setCandidate)}><option value="">All candidates</option>{candidates.map(c=><option key={c.candidate_id} value={c.candidate_id}>{c.candidate_name}</option>)}</select>
        <select aria-label="Project LGA" value={lga} onChange={e=>{setLga(e.target.value);setWard('');setPage(0);}}><option value="">All LGAs</option>{[...new Set(all.map(p=>p.lga))].sort().map(v=><option key={v}>{v}</option>)}</select>
        <select aria-label="Project ward" value={ward} onChange={change(setWard)}><option value="">All wards</option>{[...new Set(all.filter(p=>!lga||p.lga===lga).map(p=>JSON.stringify([p.lga,p.ward])))].sort().map(v=><option key={v} value={v}>{JSON.parse(v).join(' / ')}</option>)}</select>
        <select aria-label="Project type" value={type} onChange={change(setType)}><option value="">All types</option>{PROJECT_REPORT_TYPES.map(v=><option key={v}>{v}</option>)}</select>
      </div>
      <div className="toolbar">{[['Min cost (₦)',minCost,setMinCost],['Max cost (₦)',maxCost,setMaxCost],['Min ward voters',minVoters,setMinVoters],['Max ward voters',maxVoters,setMaxVoters]].map(([label,value,setter])=><label key={label}>{label}<select aria-label={label} value={value} onChange={change(setter)} style={{width:160}}><option value="">{label.startsWith('Min')?'No minimum':'No maximum'}</option>{(label.includes('cost')?costOptions:voterOptions).map(n=><option key={n} value={n}>{label.includes('cost')?naira(n):num(n)}</option>)}</select></label>)}<button className="btn secondary sm" onClick={()=>{setQ('');setCandidate('');setLga('');setWard('');setType('');setMinCost('');setMaxCost('');setMinVoters('');setMaxVoters('');setPage(0);}}>Clear filters</button></div>
      <div className="grid grid-3" style={{marginBottom:20}}>
        <Stat label="Total cost" value={naira(totalCost)} accent foot="Available estimated costs · updates with every filter" />
        <Stat label="Voters in project wards" value={unknownWards===projectWards.size&&unknownWards>0?'---':num(knownWardVoters)} foot={`${projectWards.size} distinct wards${unknownWards?` · ${unknownWards} without voter totals`:''} · each ward counted once`} />
        <Stat label="Matching projects" value={num(filtered.length)} foot={`${num(filtered.reduce((sum,p)=>sum+Number(p.quantity||1),0))} recorded project units`} />
      </div>
      <button className="btn secondary sm" onClick={()=>exportReportRows([{total_estimated_cost:totalCost,matching_projects:filtered.length,distinct_project_wards:projectWards.size,known_ward_voters:knownWardVoters,wards_without_voter_totals:unknownWards}], 'kwarax10-filtered-project-totals.csv')}>Export filtered totals</button>
      <button className="btn secondary sm" onClick={()=>exportReportRows(summary.map(s=>({project_type:s.type,counts:s.count,cost:s.cost,pu_imparted:s.units,voter_per_ward:s.voters??'---',PDP:s.pdp})), 'kwarax10-project-types.csv')}>Export type summary</button>
      <div className="table-wrap"><table data-native-tools="true"><thead><tr><th>Project type</th><th>Counts</th><th>Cost</th><th>PU imparted</th><th>Voter Imparted</th><th>PDP</th></tr></thead><tbody>{summary.map(s=><React.Fragment key={s.type}><tr><td>{s.type==='Others'?<button className="btn secondary sm" aria-expanded={others} onClick={()=>setOthers(v=>!v)}>Others {others?'▴':'▾'}</button>:s.type}</td><td>{num(s.count)}</td><td>{naira(s.cost)}</td><td>{s.units===null?'---':num(s.units)}</td><td>{showVoters(s.voters)}</td><td>{s.pdp==null?'Not loaded':num(s.pdp)}</td></tr>{s.type==='Others'&&others&&<tr><td colSpan={6}>{s.list.length?[...new Set(s.list.map(p=>p.project_name||p.title))].sort().map(name=><div key={name}>{name}</div>):'No other projects match the filters'}</td></tr>}</React.Fragment>)}</tbody></table></div>
    </Card>
    <Card title="Project details" note="Ward voter totals repeat for projects in the same ward; they should not be added together.">
      <div className="toolbar"><label>Group by <select value={group} onChange={change(setGroup)} aria-label="Group project details"><option value="">No grouping</option>{['candidate','lga','ward','type'].map(v=><option key={v} value={v}>{v.toUpperCase()}</option>)}</select></label><label>Order by <select value={order} onChange={change(setOrder)} aria-label="Order project details">{['cost','voters','count','candidate','lga','ward'].map(v=><option key={v} value={v}>{v.toUpperCase()}</option>)}</select></label><select value={direction} onChange={change(setDirection)} aria-label="Project sort direction"><option value="desc">Highest first</option><option value="asc">Lowest first</option></select><button className="btn secondary sm" onClick={()=>exportReportRows(filtered.map(format),'kwarax10-project-details.csv')}>Export all matching projects</button></div>
      {!filtered.length?<Empty title="No projects match the filters"/>:[...groups.entries()].map(([label,list])=><div key={label}>{group&&<h3>{label}</h3>}<div className="table-wrap"><table data-native-tools="true"><thead><tr>{['Candidate','LGA','Ward','Projects','Type','Count','Project cost','Voter Imparted','PDP'].map(v=><th key={v}>{v}</th>)}</tr></thead><tbody>{list.map(p=><tr key={p.id}><td>{p.candidate_name}</td><td>{p.lga}</td><td>{p.ward}</td><td>{p.title}</td><td>{p.type}</td><td>{num(p.quantity)}</td><td>{showCost(p.estimated_cost)}</td><td>{showVoters(p.ward_voters)}</td><td>{(p.pdp_people==null?'Not loaded':num(p.pdp_people))}</td></tr>)}</tbody></table></div></div>)}
      {filtered.length>100&&<div className="btn-row"><button className="btn secondary sm" disabled={page===0} onClick={()=>setPage(v=>v-1)}>Previous</button><span>Page {page+1} / {Math.ceil(filtered.length/100)} · {num(filtered.length)} projects</span><button className="btn secondary sm" disabled={(page+1)*100>=filtered.length} onClick={()=>setPage(v=>v+1)}>Next</button></div>}
    </Card>
  </>;
}
