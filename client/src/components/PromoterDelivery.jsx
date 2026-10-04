import React, {useMemo, useState} from 'react';
import {Card,Empty} from './ui.jsx';
import {num} from '../lib/api.js';
import {exportReportRows} from '../lib/report-csv.js';
import {deliveryRow,deliveryGroups,sortDelivery,achievementBand} from '../lib/promoter-delivery.js';

export default function PromoterDelivery({rows}) {
  const [search,setSearch]=useState(''),[office,setOffice]=useState(''),[band,setBand]=useState('');
  const [group,setGroup]=useState(''),[sort,setSort]=useState('percentage'),[direction,setDirection]=useState('desc');
  const all=useMemo(()=>rows.map(deliveryRow),[rows]);
  const filtered=useMemo(()=>sortDelivery(all.filter(r=>(!office||r.title===office)&&(!band||achievementBand(r)===band)&&[r.candidate_name,r.title,r.constituency].join(' ').toLowerCase().includes(search.trim().toLowerCase())),sort,direction),[all,office,band,search,sort,direction]);
  const groups=deliveryGroups(filtered,group);
  const percentage=value=>value===null?'—':Math.ceil(value)+'%';
  const exportRows=()=>exportReportRows(groups.flatMap(([label,list])=>list.map(r=>({...(group?{group:label}:{}),name:r.candidate_name,title:r.title,constituency_district:r.constituency,pu_coverage:`${r.polling_units_covered}/${r.total_polling_units}`,promoters:`${r.achieved}/${r.nominees_target}`,gap:r.gap ?? 'Not applicable',percentage_achieved:r.percentage === null?'Not applicable':Math.ceil(r.percentage),ward_coverage:`${r.wards_covered}/${r.total_wards}`,voters:r.no_of_voters,PDP:r.pdp_people??'Not loaded',projects_count:r.projects}))), 'kwarax10-promoter-delivery.csv');
  return <Card title="Promoter delivery" note="Gap = expected − achieved; a negative gap means the target was exceeded. Unlimited or unset targets have no achievement percentage. PU and ward coverage show covered / total.">
    <div className="toolbar">
      <input type="search" aria-label="Search promoter delivery" placeholder="Search name, title or constituency" value={search} onChange={e=>setSearch(e.target.value)} />
      <select aria-label="Filter title" value={office} onChange={e=>setOffice(e.target.value)}><option value="">All titles</option>{[...new Set(all.map(r=>r.title))].sort().map(v=><option key={v}>{v}</option>)}</select>
      <select aria-label="Filter percentage achieved" value={band} onChange={e=>setBand(e.target.value)}><option value="">All achievement levels</option>{['Below 25%','25–49%','50–74%','75–99%','100% and above','No numeric target'].map(v=><option key={v}>{v}</option>)}</select>
      <button className="btn secondary sm" onClick={()=>{setSearch('');setOffice('');setBand('');}}>Clear filters</button>
    </div>
    <div className="toolbar">
      <label>Group by <select aria-label="Group promoter delivery" value={group} onChange={e=>setGroup(e.target.value)}><option value="">No grouping</option><option value="constituency">Constituency / District</option><option value="percentage">Percentage achieved</option><option value="title">Title / Office</option><option value="gap">Target completion</option></select></label>
      <label>Order by <select aria-label="Order promoter delivery" value={sort} onChange={e=>setSort(e.target.value)}><option value="percentage">Percentage achieved</option><option value="voters">Voters</option><option value="coverage">Polling-unit coverage %</option><option value="gap">Gap</option><option value="projects">Projects count</option><option value="name">Name</option></select></label>
      <select aria-label="Sort direction" value={direction} onChange={e=>setDirection(e.target.value)}><option value="desc">Highest first</option><option value="asc">Lowest first</option></select>
      <span className="muted">{num(filtered.length)} of {num(all.length)} candidates</span>
      <button className="btn secondary sm" disabled={!filtered.length} onClick={exportRows}>Export filtered report</button>
    </div>
    {!filtered.length?<Empty title="No candidates match these filters"/>:groups.map(([label,list])=><div key={label} style={{marginBottom:20}}>
      {group&&<h3>{label} <span className="muted">({list.length})</span></h3>}
      <div className="table-wrap"><table data-native-tools="true"><thead><tr><th>Name</th><th>Title</th><th>Con/Dis</th><th>PU cov</th><th>Promoters</th><th>Gap</th><th>% achieved</th><th>Ward coverage</th><th>Voters</th><th>PDP</th><th>#Project</th></tr></thead><tbody>{list.map(r=><tr key={r.candidate_id}><td className="promoter-name-cell"><span className="promoter-name" title={r.candidate_name}>{r.candidate_name}</span></td><td>{r.title}</td><td>{r.constituency}</td><td>{num(r.polling_units_covered)} / {num(r.total_polling_units)}</td><td>{num(r.achieved)} / {r.expected===null?r.nominees_target:num(r.expected)}</td><td>{r.gap===null?'—':num(r.gap)}</td><td>{percentage(r.percentage)}</td><td>{num(r.wards_covered)} / {num(r.total_wards)}</td><td>{typeof r.no_of_voters==='number'?num(r.no_of_voters):r.no_of_voters}</td><td>{(r.pdp_people==null?'Not loaded':num(r.pdp_people))}</td><td>{num(r.projects)}</td></tr>)}</tbody></table></div>
    </div>)}
  </Card>;
}
