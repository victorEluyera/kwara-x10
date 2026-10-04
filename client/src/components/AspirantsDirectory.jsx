import React, {useMemo,useState} from 'react';
import {Card,Empty} from './ui.jsx';
import {num} from '../lib/api.js';
import {deliveryRow} from '../lib/promoter-delivery.js';
import {exportReportRows} from '../lib/report-csv.js';

const contactStatus=r=>r.phone?.trim()&&r.email?.trim()?'Phone and email available':r.phone?.trim()?'Phone only':r.email?.trim()?'Email only':'No contact details';
export default function AspirantsDirectory({rows}) {
  const [search,setSearch]=useState(''),[title,setTitle]=useState(''),[area,setArea]=useState(''),[contact,setContact]=useState(''),[progress,setProgress]=useState('');
  const [group,setGroup]=useState(''),[order,setOrder]=useState('delivered'),[direction,setDirection]=useState('desc');
  const all=useMemo(()=>rows.map(deliveryRow),[rows]);
  const filtered=all.filter(r=>(!title||r.title===title)&&(!area||r.constituency===area)&&(!contact||contactStatus(r)===contact)&&(!progress||(progress==='none'?r.achieved===0:progress==='outstanding'?r.gap!==null&&r.gap>0:progress==='complete'?r.gap!==null&&r.gap<=0:r.expected===null))&&[r.candidate_name,r.constituency,r.phone,r.email].join(' ').toLowerCase().includes(search.trim().toLowerCase()));
  filtered.sort((a,b)=>{
    const field={name:'candidate_name',title:'title',area:'constituency',delivered:'achieved',target:'people_per_polling_unit_target'}[order];
    const av=a[field],bv=b[field],factor=direction==='asc'?1:-1;
    if(['delivered','target'].includes(order)) {
      const valid=v=>typeof v==='number'&&Number.isFinite(v);
      if(!valid(av)||!valid(bv))return valid(av)?-1:valid(bv)?1:a.candidate_name.localeCompare(b.candidate_name);
      return (av-bv)*factor||a.candidate_name.localeCompare(b.candidate_name);
    }
    return String(av||'').localeCompare(String(bv||''))*factor||a.candidate_name.localeCompare(b.candidate_name);
  });
  const groups=new Map();
  for(const r of filtered){const label=group==='title'?r.title:group==='area'?r.constituency:group==='contact'?contactStatus(r):group==='delivery'?r.achieved===0?'No promoters delivered':'Promoters delivered':'All aspirants';if(!groups.has(label))groups.set(label,[]);groups.get(label).push(r);}
  const exportRows=()=>exportReportRows([...groups.entries()].flatMap(([label,list])=>list.map(r=>({...group?{group:label}:{},name:r.candidate_name,title:r.title,constituency_district:r.constituency,phone:r.phone?.trim()||'--',email:r.email?.trim()||'--',promoter_per_pu_target:r.people_per_polling_unit_target??'--',promoter_delivered:r.achieved,PDP:r.pdp_people??'Not loaded'}))), 'kwarax10-aspirants-directory.csv');
  return <Card title="Aspirants directory" note="Promoter delivered counts the candidate's recorded nominees. The per-PU target is the allowance for their office; unlimited offices have no fixed allowance.">
    <div className="toolbar">
      <input type="search" aria-label="Search aspirants directory" placeholder="Search name, constituency, phone or email" value={search} onChange={e=>setSearch(e.target.value)}/>
      <select aria-label="Filter directory title" value={title} onChange={e=>setTitle(e.target.value)}><option value="">All titles</option>{[...new Set(all.map(r=>r.title))].sort().map(v=><option key={v}>{v}</option>)}</select>
      <select aria-label="Filter directory constituency" value={area} onChange={e=>setArea(e.target.value)}><option value="">All constituencies / districts</option>{[...new Set(all.map(r=>r.constituency))].sort().map(v=><option key={v}>{v}</option>)}</select>
      <select aria-label="Filter contact availability" value={contact} onChange={e=>setContact(e.target.value)}><option value="">All contact details</option>{['Phone and email available','Phone only','Email only','No contact details'].map(v=><option key={v}>{v}</option>)}</select>
      <select aria-label="Filter promoter delivery" value={progress} onChange={e=>setProgress(e.target.value)}><option value="">All delivery progress</option><option value="none">No promoters delivered</option><option value="outstanding">Target outstanding</option><option value="complete">Target achieved</option><option value="unlimited">No numeric target</option></select>
      <button className="btn secondary sm" onClick={()=>{setSearch('');setTitle('');setArea('');setContact('');setProgress('');}}>Clear filters</button>
    </div>
    <div className="toolbar">
      <label>Group by <select aria-label="Group aspirants directory" value={group} onChange={e=>setGroup(e.target.value)}><option value="">No grouping</option><option value="title">Title / Office</option><option value="area">Constituency / District</option><option value="contact">Contact availability</option><option value="delivery">Delivery activity</option></select></label>
      <label>Order by <select aria-label="Order aspirants directory" value={order} onChange={e=>setOrder(e.target.value)}><option value="delivered">Promoters delivered</option><option value="target">Promoter per PU target</option><option value="name">Name</option><option value="title">Title</option><option value="area">Constituency / District</option></select></label>
      <select aria-label="Directory sort direction" value={direction} onChange={e=>setDirection(e.target.value)}><option value="desc">Descending</option><option value="asc">Ascending</option></select>
      <span className="muted">{num(filtered.length)} of {num(all.length)} aspirants</span><button className="btn secondary sm" disabled={!filtered.length} onClick={exportRows}>Export filtered directory</button>
    </div>
    {!filtered.length?<Empty title="No aspirants match these filters"/>:[...groups.entries()].map(([label,list])=><div key={label} style={{marginBottom:20}}>{group&&<h3>{label} <span className="muted">({list.length})</span></h3>}<div className="table-wrap"><table data-native-tools="true"><thead><tr><th>Name</th><th>Title</th><th>Con/Dis</th><th>Phone</th><th>Email</th><th>Promoter/PU</th><th>Promoter delivered</th><th>PDP</th></tr></thead><tbody>{list.map(r=><tr key={r.candidate_id}><td style={{fontWeight:600}}>{r.candidate_name}</td><td>{r.title}</td><td>{r.constituency}</td><td>{r.phone?.trim()||'--'}</td><td>{r.email?.trim()||'--'}</td><td>{r.people_per_polling_unit_target??'--'}</td><td>{num(r.achieved)}</td><td>{(r.pdp_people==null?'Not loaded':num(r.pdp_people))}</td></tr>)}</tbody></table></div></div>)}
  </Card>;
}
