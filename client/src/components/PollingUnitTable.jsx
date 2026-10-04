import React,{useMemo,useState,useEffect} from 'react';
import {Card} from './ui.jsx';
import {num} from '../lib/api.js';
import {pollingUnitStatus} from '../lib/polling-unit-status.js';
import {exportReportRows} from '../lib/report-csv.js';
import CoverageDetail from './CoverageDetail.jsx';
export default function PollingUnitTable({rows,unmapped=[],votersLoading=false}) {
  const [search,setSearch]=useState(''),[lga,setLga]=useState(''),[ward,setWard]=useState(''),[status,setStatus]=useState(''),[sort,setSort]=useState('polling_unit'),[direction,setDirection]=useState('asc'),[page,setPage]=useState(0),[selected,setSelected]=useState(null);
  useEffect(()=>setPage(0),[search,lga,ward,status,sort,direction]);
  const lgas=useMemo(()=>[...new Set(rows.map(r=>r.lga))].sort(),[rows]);
  const wards=useMemo(()=>[...new Set(rows.filter(r=>!lga||r.lga===lga).map(r=>r.ward))].sort(),[rows,lga]);
  const filtered=useMemo(()=>rows.filter(r=>(!lga||r.lga===lga)&&(!ward||r.ward===ward)&&(!status||pollingUnitStatus(r.promoters)===status)&&[r.lga,r.ward,r.polling_unit].join(' ').toLowerCase().includes(search.trim().toLowerCase())).sort((a,b)=>{
    const value=r=>sort==='projects'?r.projects.length:r[sort];
    const av=value(a),bv=value(b);if(av==null)return bv==null?0:1;if(bv==null)return -1;
    return (['promoters','voters','projects'].includes(sort)?Number(av)-Number(bv):String(av).localeCompare(String(bv),undefined,{numeric:true}))*(direction==='asc'?1:-1);
  }),[rows,search,lga,ward,status,sort,direction]);
  const currentPage=Math.min(page,Math.max(0,Math.ceil(filtered.length/50)-1));
  const visible=filtered.slice(currentPage*50,(currentPage+1)*50);
  return <Card title="Polling units" bodyClass="">
    <div className="toolbar"><input type="search" aria-label="Search polling units" placeholder="Search polling units" value={search} onChange={e=>setSearch(e.target.value)}/><select aria-label="Polling unit LGA" value={lga} onChange={e=>{setLga(e.target.value);setWard('');}}><option value="">All LGAs</option>{lgas.map(v=><option key={v}>{v}</option>)}</select><select aria-label="Polling unit ward" value={ward} onChange={e=>setWard(e.target.value)}><option value="">All wards</option>{wards.map(v=><option key={v}>{v}</option>)}</select><select aria-label="Polling unit promoter coverage" value={status} onChange={e=>setStatus(e.target.value)}><option value="">All coverage</option>{['Not reached','Partially reached','Reached'].map(v=><option key={v}>{v}</option>)}</select></div>
    <div className="toolbar"><select aria-label="Polling unit sort" value={sort} onChange={e=>setSort(e.target.value)}>{[['polling_unit','Polling unit'],['lga','LGA'],['ward','Ward'],['promoters','Promoters'],['voters','Voters'],['projects','Projects']].map(([v,label])=><option key={v} value={v}>{label}</option>)}</select><select aria-label="Polling unit sort direction" value={direction} onChange={e=>setDirection(e.target.value)}><option value="asc">Lowest first / A–Z</option><option value="desc">Highest first / Z–A</option></select><button className="btn secondary sm" onClick={()=>exportReportRows(filtered.map(r=>({LGA:r.lga,Ward:r.ward,'Polling unit':r.polling_unit,'PU cov':pollingUnitStatus(r.promoters),Promoters:r.promoters,PDP:r.pdp_people??'Not loaded',Voters:r.voters??'Not loaded',Projects:r.projects.length})),'polling-units.csv')}>Export</button></div>
    <p className="muted">{num(filtered.length)} of {num(rows.length)} polling units{votersLoading?' · Loading voter totals…':''}</p>
    <div className="table-wrap coverage-table-scroll"><table data-native-tools="true"><thead><tr><th>LGA</th><th>Ward</th><th>Polling unit</th><th>PU cov</th><th>Promoters</th><th>PDP</th><th>Voters</th><th>Projects</th></tr></thead><tbody>{visible.map(r=><tr key={JSON.stringify([r.lga,r.ward,r.polling_unit])} className="coverage-clickable-row" tabIndex={0} aria-haspopup="dialog" onClick={()=>setSelected(r)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelected(r);}}}><td>{r.lga}</td><td>{r.ward}</td><td>{r.polling_unit}</td><td>{pollingUnitStatus(r.promoters)}</td><td>{num(r.promoters)}</td><td>{(r.pdp_people==null?'Not loaded':num(r.pdp_people))}</td><td>{r.voters==null?'--':num(r.voters)}</td><td>{num(r.projects.length)}</td></tr>)}</tbody></table></div>
    <div className="toolbar"><button className="btn secondary sm" disabled={currentPage===0} onClick={()=>setPage(currentPage-1)}>Previous</button><span>Page {currentPage+1} of {Math.max(1,Math.ceil(filtered.length/50))}</span><button className="btn secondary sm" disabled={(currentPage+1)*50>=filtered.length} onClick={()=>setPage(currentPage+1)}>Next</button></div>
    {unmapped.length>0&&<details><summary>PDP needing PU allocation: {num(unmapped.reduce((sum,r)=>sum+r.count,0))}</summary><button className="btn secondary sm" onClick={()=>exportReportRows(unmapped.map(r=>({LGA:r.lga,Ward:r.ward,'Submitted polling unit':r.polling_unit,PDP:r.count})),'pdp-pu-allocation.csv')}>Export</button><div className="table-wrap" style={{maxHeight:240,overflowY:'auto'}}><table><thead><tr><th>LGA</th><th>Ward</th><th>Submitted polling unit</th><th>PDP</th></tr></thead><tbody>{unmapped.map((r,i)=><tr key={i}><td>{r.lga}</td><td>{r.ward}</td><td>{r.polling_unit}</td><td>{num(r.count)}</td></tr>)}</tbody></table></div></details>}
    {selected&&<CoverageDetail row={selected} kind="unit" onClose={()=>setSelected(null)}/>}
  </Card>;
}
