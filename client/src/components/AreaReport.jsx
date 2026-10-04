import CoverageDetail from './CoverageDetail.jsx';
import {areaTableRows} from '../lib/area-table-analysis.js';
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, num } from '../lib/api.js';
import { Card, Stat, Alert, Loading, Empty } from './ui.jsx';
import { exportReportRows } from '../lib/report-csv.js';

const voterNumber = (n) => n == null ? 'Not loaded' : num(n);

function TableAnalysisControls({kind,value,onChange,rows}) {
  const set=(key,next)=>onChange({...value,[key]:next,...(key==='lga'?{ward:''}:{})});
  return <div className="toolbar" style={{flexWrap:'wrap',gap:8}}>
    <input type="search" aria-label={kind+' table search'} placeholder={kind==='ward'?'Search wards':'Search polling units'} value={value.search} onChange={e=>set('search',e.target.value)}/>
    <select aria-label={kind+' LGA filter'} value={value.lga} onChange={e=>set('lga',e.target.value)}><option value="">All LGAs</option>{[...new Set(rows.map(r=>r.lga))].sort().map(l=><option key={l}>{l}</option>)}</select>
    {kind==='unit'&&<select aria-label="Polling-unit ward filter" value={value.ward} onChange={e=>set('ward',e.target.value)}><option value="">All wards</option>{[...new Set(rows.filter(r=>!value.lga||r.lga===value.lga).map(r=>r.ward))].sort().map(w=><option key={w}>{w}</option>)}</select>}
    <select aria-label={kind+' coverage filter'} value={value.coverage} onChange={e=>set('coverage',e.target.value)}><option value="">All coverage</option><option value="none">Not reached</option>{kind==='ward'&&<option value="partial">Partly covered</option>}<option value="complete">{kind==='ward'?'Fully covered':'Reached'}</option></select>
    <select aria-label={kind+' projects filter'} value={value.projects} onChange={e=>set('projects',e.target.value)}><option value="">All projects</option><option value="with">With projects</option><option value="without">Without projects</option></select>
    <select aria-label={kind+' sort by'} value={value.sort} onChange={e=>set('sort',e.target.value)}>{[[kind==='ward'?'ward':'polling_unit','Name'],['voters','Voters'],['coverage','PU coverage'],['gap','Unit gap'],['projects','Project count'],['promoters','Promoter'],['lga','LGA']].map(([key,label])=><option key={key} value={key}>{label}</option>)}</select>
    <select aria-label={kind+' sort order'} value={value.direction} onChange={e=>set('direction',e.target.value)}><option value="asc">Lowest first / A–Z</option><option value="desc">Highest first / Z–A</option></select>
    <button className="btn sm secondary" onClick={()=>onChange({search:'',lga:'',ward:'',coverage:'',projects:'',sort:kind==='ward'?'ward':'polling_unit',direction:'asc'})}>Clear</button>
  </div>;
}

export default function AreaReport({ me, onCandidateChange, initialData = null, candidateLayout = false }) {
  const [data, setData] = useState(null);
  const [selected,setSelected]=useState(null);
  const [base, setBase] = useState(null);
  const [candidates, setCandidates] = useState([]);
  const [candidate, setCandidate] = useState('');
  const [filters, setFilters] = useState({ lga: '', ward: '', polling_unit: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reach, setReach] = useState('');
  const [project, setProject] = useState('');
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [wardAnalysis,setWardAnalysis]=useState({search:'',lga:'',ward:'',coverage:'',projects:'',sort:'ward',direction:'asc'});
  const [unitAnalysis,setUnitAnalysis]=useState({search:'',lga:'',ward:'',coverage:'',projects:'',sort:'polling_unit',direction:'asc'});
  useEffect(()=>{setPage(0);},[unitAnalysis,data]);
  useEffect(() => {
    if (!candidateLayout && me.permissions.can_see_compliance) api.get('/nominations').then((r) => setCandidates(r.rows)).catch((e) => setError(e.message));
  }, [me.permissions.can_see_compliance,candidateLayout]);
  useEffect(() => {
    if(initialData && !candidate) {setData(initialData);setBase({...initialData,candidate_key:candidate});setLoading(false);return;}
    let active = true;
    setLoading(true); setError(''); setData(null); setBase(null);
    const qs = new URLSearchParams();
    if (candidate) qs.set('candidate_id', candidate);
    api.get('/dashboard/area-report?' + qs).then((r) => { if (active) { setData(r); setBase({ ...r, candidate_key: candidate }); } })
      .catch((e) => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [candidate,initialData]);
  useEffect(() => {
    if (!base || base.candidate_key !== candidate) return;
    let active = true;
    if (!Object.values(filters).some(Boolean)) { setData(base); setLoading(false); return; }
    setLoading(true); setData(null); setError('');
    const qs = new URLSearchParams(filters);
    if (candidate) qs.set('candidate_id', candidate);
    api.get('/dashboard/area-report?' + qs).then((r) => { if (active) setData(r); })
      .catch((e) => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [base, filters, candidate]);
  const choose = (key) => (e) => {
    setFilters((f) => ({ ...f, [key]: e.target.value,
      ...(key === 'lga' ? { ward: '', polling_unit: '' } : {}), ...(key === 'ward' ? { polling_unit: '' } : {}) }));
    setPage(0);
    setProject('');
  };
  const wards = areaTableRows(data?.wards || [],wardAnalysis,'ward');
  const units = areaTableRows((data?.units || []).filter((u) => (!reach || (reach === 'reached' ? u.reached : !u.reached))
    && (!search || [u.lga,u.ward,u.polling_unit,...u.projects.map(p => p.title)].join(' ').toLowerCase().includes(search.toLowerCase().trim()))
    && (!project || (project === 'with' ? u.projects.length > 0 : project === 'without' ? u.projects.length === 0 : u.projects.some((p) => String(p.id) === project)))),unitAnalysis,'unit');
  const projectOptions = [...(data?.units || []).flatMap((u) => u.projects), ...(data?.ward_projects || [])];
  const s = data?.summary;
  return <Card title={candidateLayout ? "Ward and polling-unit totals" : "Constituency dashboard"} note="A polling unit is reached when it has a registration. A ward is covered when at least one recognised polling unit is reached. Promoter counts registered unit promoters. Projects are shown separately. Voter numbers count records in the uploaded register; an incomplete upload is not the full electorate.">
    {!candidateLayout && <div className="toolbar">
      {!candidateLayout && me.permissions.can_see_compliance && <select aria-label="Dashboard constituency" value={candidate} onChange={(e) => {
        onCandidateChange?.(e.target.value);
        setCandidate(e.target.value); setFilters({ lga: '', ward: '', polling_unit: '' }); setPage(0); setProject(''); setReach('');
      }}><option value="">Whole state</option>{candidates.map((c) => <option key={c.id} value={c.id}>{c.scope_value || 'Statewide'} · {c.full_name} · {c.office}</option>)}</select>}
      <select aria-label="Area LGA" value={filters.lga} onChange={choose('lga')}><option value="">All LGAs</option>{(base?.lgas || []).map((l) => <option key={l.lga}>{l.lga}</option>)}</select>
      <select aria-label="Area ward" value={filters.ward} onChange={choose('ward')} disabled={!filters.lga}><option value="">All wards</option>{(base?.wards || []).filter((w) => w.lga === filters.lga).map((w) => <option key={w.ward}>{w.ward}</option>)}</select>
      <select aria-label="Area polling unit" value={filters.polling_unit} onChange={choose('polling_unit')} disabled={!filters.ward}><option value="">All polling units</option>{(base?.units || []).filter((u) => u.lga === filters.lga && u.ward === filters.ward).map((u) => <option key={u.polling_unit}>{u.polling_unit}</option>)}</select>
    </div>}
    {error && <Alert type="error">{error}</Alert>}
    {loading ? <Loading label="Loading area coverage and voter totals" /> : s && <>
      <p><strong>{data.area}</strong>{data.candidate_name ? ` · ${data.candidate_name}` : ''}</p>
      {!candidateLayout && <div className="grid grid-4" style={{ marginBottom: 16 }}>
        {!candidateLayout && <>
        <Stat label="Wards reached" value={`${num(s.wards_reached)} / ${num(s.wards)}`} foot={`${num(s.wards_remaining)} wards remain`} />
        <Stat label="Polling units reached" value={`${num(s.units_reached)} / ${num(s.polling_units)}`} foot={`${num(s.units_remaining)} polling units remain`} />
        </>}
        <Stat label="PDP" value={data.pdp_source?.loaded ? num(data.wards.reduce((sum,w)=>sum+(w.pdp_people||0),0)) : 'Not loaded'} />
        <Stat label="Voters in selected area" value={voterNumber(s.voters)} foot={`${num(s.projects)} submitted projects`} />
      </div>}
      {!data.pdp_source?.loaded && <Alert type="info">No Kwara PDP membership counts have been loaded.</Alert>}
      {!data.voter_roll_loaded && <Alert type="info">Upload the voter register under Admin → Data sources to see voter totals.</Alert>}
      {s.unlisted_polling_units > 0 && <p className="muted">{num(s.unlisted_polling_units)} expected polling units have no location record yet. They remain in the target and are not counted as reached.</p>}
      {s.unmapped_voters > 0 && <Alert type="warn">{num(s.unmapped_voters)} voter records count towards ward and LGA totals but cannot be matched to a listed polling unit.</Alert>}
      <div className={candidateLayout ? "grid candidate-coverage-tables" : "grid grid-2"}>
        {!candidateLayout && <Card title="LGA totals" bodyClass=""><div className="table-wrap"><table><thead><tr><th>LGA</th><th>Wards reached</th><th>PU cov</th><th>PDP</th><th>Voters</th><th>Projects</th></tr></thead><tbody>{data.lgas.map((l) => <tr key={l.lga}><td>{l.lga}</td><td>{l.wards_reached}/{l.wards}</td><td>{l.units_reached}/{l.polling_units}</td><td>{(l.pdp_people==null?'Not loaded':num(l.pdp_people))}</td><td>{voterNumber(l.voters)}</td><td>{l.projects}</td></tr>)}</tbody></table></div></Card>}
        <Card title="Ward totals" bodyClass="">
          <TableAnalysisControls kind="ward" value={wardAnalysis} onChange={setWardAnalysis} rows={data.wards}/>
          <p className="muted">Showing {num(wards.length)} of {num(data.wards.length)} wards · PU cov: {num(wards.reduce((n,w)=>n+w.units_reached,0))}/{num(wards.reduce((n,w)=>n+w.polling_units,0))} · Voters: {data.voter_roll_loaded?num(wards.reduce((n,w)=>n+(w.voters||0),0)):'Not loaded'} · Projects: {num(wards.reduce((n,w)=>n+w.projects,0))}</p>
          <button className="btn sm secondary" disabled={!wards.length} onClick={()=>exportReportRows(wards.map(w=>({LGA:w.lga,Ward:w.ward,'PU reached':w.units_reached,'PU total':w.polling_units,'Unit gap':w.units_remaining,Voters:w.voters ?? 'Not loaded',Promoter:w.promoters || 0,PDP:w.pdp_people??'Not loaded',Projects:w.projects})),'matching-ward-totals.csv')}>Export matching wards</button>
          <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}><table data-native-tools="true"><thead><tr><th>LGA / ward</th><th>PU cov</th><th>Unit gap</th><th>PDP</th><th>Voters</th><th>Projects</th></tr></thead><tbody>{wards.map((w) => <tr key={JSON.stringify([w.lga, w.ward])} className="coverage-clickable-row" tabIndex={0} aria-haspopup="dialog" aria-label={'View details for '+w.ward} onClick={()=>setSelected({row:w,kind:'ward'})} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSelected({row:w,kind:'ward'});}}}><td>{w.lga}<div>{w.ward}</div></td><td>{w.units_reached}/{w.polling_units}</td><td>{w.units_remaining}</td><td>{(w.pdp_people==null?'Not loaded':num(w.pdp_people))}</td><td>{voterNumber(w.voters)}</td><td>{w.projects}</td></tr>)}</tbody></table></div></Card>
      <div className={candidateLayout ? "candidate-pu-totals" : "area-pu-totals"} style={candidateLayout ? undefined : {gridColumn:"1 / -1"}}>
      {!candidateLayout && <div className="toolbar">
        <input type="search" placeholder="Search all polling units and projects" aria-label="Search all polling units" value={search} onChange={e => {setSearch(e.target.value);setPage(0);}} />
        <button className="btn sm secondary" onClick={() => exportReportRows(units.map(u => ({lga:u.lga,ward:u.ward,polling_unit:u.polling_unit,coverage:u.reached?'Reached':'Remaining',promoter:u.promoters || 0,PDP:u.pdp_people??'Not loaded',voters:u.voters ?? 'Not loaded',projects:u.projects.map(p=>p.title).join('; ')})), 'kwarax10-area-polling-units.csv')}>Export all matching units</button>
        <select aria-label="Polling unit coverage" value={reach} onChange={(e) => { setReach(e.target.value); setPage(0); }}><option value="">All polling units</option><option value="reached">Reached</option><option value="remaining">Still to cover</option></select>
        <select aria-label="Project filter" value={project} onChange={(e) => { setProject(e.target.value); setPage(0); }}><option value="">All projects</option><option value="with">With projects</option><option value="without">Without projects</option>{projectOptions.map((p) => <option key={p.id} value={p.id}>{p.title} · {p.ward}</option>)}</select>
        <span className="muted">Project and reached filters apply to the polling-unit table below.</span>
      </div>}
      <Card title="Polling-unit totals" bodyClass="">
      <TableAnalysisControls kind="unit" value={unitAnalysis} onChange={setUnitAnalysis} rows={data.units}/>
      <p className="muted">Showing {num(units.length)} of {num(data.units.length)} polling units · Reached: {num(units.filter(u=>u.reached).length)} · Remaining: {num(units.filter(u=>!u.reached).length)} · Voters: {data.voter_roll_loaded?num(units.reduce((n,u)=>n+(u.voters||0),0)):'Not loaded'}</p>
      <button className="btn sm secondary" disabled={!units.length} onClick={()=>exportReportRows(units.map(u=>({LGA:u.lga,Ward:u.ward,'Polling unit':u.polling_unit,Coverage:u.reached?'Reached':'Remaining',Promoter:u.promoters || 0,PDP:u.pdp_people??'Not loaded',Voters:u.voters ?? 'Not loaded',Projects:u.projects.map(p=>p.title).join('; ')})),'matching-polling-unit-totals.csv')}>Export matching polling units</button>
      {!units.length ? <Empty title="No polling units match these filters" /> : <div className="table-wrap" style={{maxHeight:300,overflowY:"auto"}}><table data-native-tools="true">
        <thead><tr><th>LGA</th><th>Ward</th><th>Polling unit</th><th>Coverage</th><th>Promoter</th><th>PDP</th><th>Voters</th><th>Projects</th></tr></thead>
        <tbody>{units.slice(page * 50, (page + 1) * 50).map((u) => <tr key={JSON.stringify([u.lga, u.ward, u.polling_unit])} className="coverage-clickable-row" tabIndex={0} aria-haspopup="dialog" aria-label={'View details for '+u.polling_unit} onClick={e=>{if(!e.target.closest('a,button'))setSelected({row:u,kind:'unit'});}} onKeyDown={e=>{if(e.target===e.currentTarget&&(e.key==='Enter'||e.key===' ')){e.preventDefault();setSelected({row:u,kind:'unit'});}}}><td>{u.lga}</td><td>{u.ward}</td><td>{u.polling_unit}</td><td>{u.reached ? 'Reached' : 'Still to cover'}</td><td>{num(u.promoters || 0)}</td><td>{(u.pdp_people==null?'Not loaded':num(u.pdp_people))}</td><td>{voterNumber(u.voters)}</td><td>{u.projects.length ? u.projects.map((p) => <div key={p.id}><Link to="/projects">{p.title}</Link> · {p.status}</div>) : 'No projects'}</td></tr>)}</tbody>
      </table></div>}
      {units.length > 50 && <div className="btn-row"><button className="btn sm secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><span>{page * 50 + 1}–{Math.min((page + 1) * 50, units.length)} of {num(units.length)}</span><button className="btn sm secondary" disabled={(page + 1) * 50 >= units.length} onClick={() => setPage(page + 1)}>Next</button></div>}
      </Card>
      </div>
      </div>
      {data.ward_projects.filter((p) => !project || project === 'with' || String(p.id) === project).length > 0 && <Card title="Ward projects without a matched polling unit" note="These projects count towards ward totals and do not mark a polling unit as reached.">
        {data.ward_projects.filter((p) => !project || project === 'with' || String(p.id) === project).map((p) => <p key={p.id}>{p.lga} / {p.ward} · <Link to="/projects">{p.title}</Link> · {p.status}</p>)}
      </Card>}
    </>}
    {selected&&<CoverageDetail row={selected.row} kind={selected.kind} onClose={()=>setSelected(null)}/>}
  </Card>;
}
