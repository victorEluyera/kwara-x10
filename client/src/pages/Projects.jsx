import DeleteProject from '../components/DeleteProject.jsx';
import ProjectCostEditor from '../components/ProjectCostEditor.jsx';
import {compareProjects,projectComparisonTotals} from '../lib/project-comparison.js';
import {exportReportRows} from '../lib/report-csv.js';
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, naira, num, timeAgo, isCandidateRole, downloadFile } from '../lib/api.js';
import { Card, Stat, Loading, Empty, Alert, Field, Modal } from '../components/ui.jsx';
import { useAuth } from '../App.jsx';
import WardMap from '../components/WardMap.jsx';
import SheetImport from '../components/SheetImport.jsx';

const STATUS_TONE = { promised: 'amber', ongoing: '', completed: 'green' };

function pricedItemForName(name, items) {
  const value = String(name || '').toLowerCase();
  return items.find((item) => {
    if (!item.unit_cost) return false;
    if (item.id === 'borehole_solar') return /solar/.test(value) && /borehole/.test(value);
    if (item.id === 'solar_street_light') return /solar/.test(value) && /street ?lights?/.test(value);
    if (item.id === 'transformer') return /transformer/.test(value) && !/repair|cable|rewind/.test(value);
    if (item.id === 'borehole') return /borehole/.test(value)
      && !/solar|repair|rehabilitat/.test(value);
    return false;
  });
}

/* ------------------------------- add form -------------------------------- */

function AddProject({framework,geo,items,onClose,onSaved}) {
  const [form,setForm]=useState({lga:'',ward:'',community:'',polling_unit:'',sector:'',item_id:'',project_name:'',need:'',quantity:1,unit:'',requested_by:'',contact_person:'',contact_phone:'',beneficiaries:'',request_date:'',target_completion_date:''});
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const set=(key,value)=>setForm(f=>({...f,[key]:value,...(key==='lga'?{ward:'',polling_unit:''}:key==='ward'?{polling_unit:''}:{} )}));
  const save=async()=>{setBusy(true);setError('');try{await api.post('/projects',{...form,title:form.project_name,scale:'medium'});onSaved();onClose();}catch(e){setError(e.message);}finally{setBusy(false);}};
  const pricedItem=items.find(i=>i.id===form.item_id)||pricedItemForName(form.project_name,items);
  const requestCost=pricedItem?.unit_cost==null?null:pricedItem.unit_cost*Math.max(1,Number(form.quantity)||1);
  const fields=[['community','Community/Area','text'],['polling_unit','Polling Unit','text'],['need','Description','text'],['quantity','Quantity','number'],['unit','Unit','text'],['requested_by','Requested By','text'],['contact_person','Contact Person','text'],['contact_phone','Contact Phone','tel'],['beneficiaries','Estimated Beneficiaries','number'],['request_date','Request Date','date'],['target_completion_date','Target Completion Date','date']];
  const input=([key,label,type])=><Field key={key} label={label}>{key==='need'?<textarea rows={3} value={form[key]} onChange={e=>set(key,e.target.value)}/>:<input type={type} min={type==='number'?key==='quantity'?1:0:undefined} value={form[key]} onChange={e=>set(key,e.target.value)}/>}</Field>;
  return <Modal title="Add project request" onClose={onClose} wide>
    {error&&<Alert type="error">{error}</Alert>}
    <div className="grid grid-2">
      <Field label="LGA"><select value={form.lga} onChange={e=>set('lga',e.target.value)}><option value="">Select LGA</option>{(geo.lgas||[]).map(l=><option key={l}>{l}</option>)}</select></Field>
      <Field label="Ward"><select value={form.ward} onChange={e=>set('ward',e.target.value)}><option value="">Select ward</option>{(geo.wards?.[form.lga]||[]).map(w=><option key={w}>{w}</option>)}</select></Field>
      {fields.slice(0,2).map(input)}
      <Field label="Project Category"><select value={form.sector} onChange={e=>setForm(f=>({...f,sector:e.target.value,item_id:'',project_name:''}))}><option value="">Select category</option>{framework.sectors.map(v=><option key={v}>{v}</option>)}</select></Field>
      <Field label="Item"><input list="project-request-items" value={form.project_name} onChange={e=>{const item=items.find(i=>i.label===e.target.value);setForm(f=>({...f,project_name:e.target.value,item_id:item?.id||'',unit:item?.unit||f.unit}));}}/><datalist id="project-request-items">{items.filter(i=>!form.sector||i.sector===form.sector).map(i=><option key={i.id} value={i.label}/>)}</datalist></Field>
      {fields.slice(2).map(input)}
      <Field label="Estimated request cost"><output>{requestCost==null?'--':naira(requestCost)}</output><div className="hint">Item catalogue cost × quantity.</div></Field>
    </div><div className="btn-row"><button className="btn secondary" onClick={onClose}>Cancel</button><button className="btn" disabled={busy||!form.lga||!form.ward||!form.sector||!form.project_name.trim()} onClick={save}>{busy?'Saving…':'Save project'}</button></div>
  </Modal>;
}

function ImportProjects({ onClose, onSaved }) {
  return (
    <SheetImport
      title="Upload a project list"
      noun="project"
      endpoint="/projects/import"
      templatePath="/projects/template.xlsx"
      templateName="project-list.xlsx"
      onClose={onClose}
      onSaved={onSaved}
      guidance={
        <>
          <p className="hint">
            Your own wards are already typed into it, and the Item column is a dropdown —
            so the spellings match and nothing has to be guessed when it comes back.
          </p>
          <p className="hint">
            One row for each item, in each place. A ward getting a borehole and fifty
            street lights is two rows. Only LGA, Ward and Item have to be filled in.
          </p>
        </>
      }
      duplicateHint="To promise more of the same thing in the same place, edit the quantity on the one you already have rather than adding it twice."
      describe={(r) => r.project && (
        <>
          <strong>{r.project.project_name}</strong>
          {r.project.quantity > 1 && ' × ' + num(r.project.quantity)}
          {r.duplicate && <span className="badge red" style={{ marginLeft: 6 }}>duplicate</span>}
          <div className="muted" style={{ fontSize: 11 }}>
            {r.project.community ? r.project.community + ', ' : ''}{r.project.ward}
          </div>
        </>
      )}
    />
  );
}

/* -------------------------------- editing --------------------------------- */

/**
 * Editing an existing project.
 *
 * Everything an upload can set, the form has to be able to correct -- a list
 * of ninety projects arriving by spreadsheet with no way to fix one of them
 * afterwards would just move the problem. Only what actually changed is sent,
 * so two people editing different fields do not overwrite each other.
 */
function EditProject({ project, framework, geo, items, units, onClose, onSaved }) {
  const [form, setForm] = useState({
    title: project.title || '',
    item_id: project.item_id || '',
    quantity: project.quantity ?? 1,
    unit: project.unit || '',
    scale: project.scale || '',
    status: project.status || 'promised',
    lga: project.lga || '',
    ward: project.ward || '',
    community: project.community || '',
    polling_unit: project.polling_unit || '',
    requested_by: project.requested_by || '',
    beneficiaries: project.beneficiaries ?? '',
    timeline: project.timeline || '',
    need: project.need || '',
    contact_person:project.contact_person || '',contact_phone:project.contact_phone || '',request_date:project.request_date || '',target_completion_date:project.target_completion_date || '',
  });
  const [communities, setCommunities] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const wards = form.lga ? (geo?.wards?.[form.lga] || []) : [];

  // Suggestions for the community box, from the GRID3 gazetteer for that ward.
  useEffect(() => {
    if (!form.lga) { setCommunities([]); return; }
    let live = true;
    api.get('/communities?limit=40&lga=' + encodeURIComponent(form.lga)
            + '&ward=' + encodeURIComponent(form.ward || '')
            + '&q=' + encodeURIComponent(form.community || ''))
      .then((d) => { if (live) setCommunities(d.communities || []); })
      .catch(() => {});
    return () => { live = false; };
  }, [form.lga, form.ward, form.community]);

  const save = async () => {
    setBusy(true); setError('');
    try {
      // Only what moved. Sending the whole form would overwrite a field
      // someone else changed while this modal was open.
      const changed = {};
      for (const [key, value] of Object.entries(form)) {
        const before = project[key] ?? (key === 'quantity' ? 1 : '');
        if (String(value ?? '') !== String(before ?? '')) changed[key] = value;
      }
      if (!Object.keys(changed).length) { onClose(); return; }
      if (changed.ward && !changed.lga) changed.lga = form.lga;
      // A number input hands back a string; anything that gets counted or
      // summed downstream has to arrive as a number.
      for (const k of ['quantity', 'beneficiaries']) {
        if (k in changed) changed[k] = changed[k] === '' ? null : Number(changed[k]);
      }
      await api.patch('/projects/' + project.id, changed);
      onSaved();
      onClose();
    } catch (e) { setError(e.message); setBusy(false); }
  };

  return (
    <Modal title="Edit project" onClose={onClose} footer={
      <div className="btn-row">
        <button className="btn" onClick={save} disabled={busy || !form.title.trim()}>
          {busy && <span className="spinner" />} Save changes
        </button>
        <button className="btn secondary" onClick={onClose}>Cancel</button>
      </div>
    }>
      {error && <Alert type="error">{error}</Alert>}
      <div className="grid grid-2">{[['contact_person','Contact Person','text'],['contact_phone','Contact Phone','tel'],['request_date','Request Date','date'],['target_completion_date','Target Completion Date','date']].map(([key,label,type])=><Field key={key} label={label}><input type={type} value={form[key]} onChange={e=>set(key,e.target.value)}/></Field>)}</div>

      <Field label="Title" required>
        <input type="text" value={form.title} onChange={(e) => set('title', e.target.value)} />
      </Field>

      <Field label="What is being provided"
             hint="Changing this also changes the sector it reports under.">
        <select value={form.item_id} onChange={(e) => set('item_id', e.target.value)}>
          <option value="">— not set —</option>
          {items.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
        </select>
      </Field>

      <div className="grid grid-2">
        <Field label="How many">
          <input type="number" min="1" value={form.quantity}
                 onChange={(e) => set('quantity', e.target.value)} />
        </Field>
        <Field label="Counted in">
          <select value={form.unit} onChange={(e) => set('unit', e.target.value)}>
            <option value="">— none —</option>
            {units.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </Field>
      </div>

      <div className="grid grid-2">
        <Field label="LGA">
          <select value={form.lga}
                  onChange={(e) => setForm((f) => ({ ...f, lga: e.target.value, ward: '' }))}>
            {(geo?.lgas || []).map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </Field>
        <Field label="Ward">
          <select value={form.ward} onChange={(e) => set('ward', e.target.value)}>
            <option value="">— choose —</option>
            {wards.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </Field>
      </div>

      <div className="grid grid-2">
        <Field label="Community / area"
               hint="Start typing — suggestions come from the GRID3 settlement list.">
          <input type="text" list={'communities-' + project.id} value={form.community}
                 onChange={(e) => set('community', e.target.value)} />
          <datalist id={'communities-' + project.id}>
            {communities.map((c) => <option key={c.name + c.ward} value={c.name} />)}
          </datalist>
        </Field>
        <Field label="Polling unit">
          <input type="text" value={form.polling_unit}
                 onChange={(e) => set('polling_unit', e.target.value)} />
        </Field>
      </div>

      <Field label="Scale">
        <div className="pill-row">
          {framework.scales.map((s) => (
            <button key={s.id} type="button"
                    className={'pill' + (form.scale === s.id ? ' active' : '')}
                    onClick={() => set('scale', s.id)}>{s.label}</button>
          ))}
        </div>
      </Field>

      <Field label="Status">
        <div className="pill-row">
          {framework.statuses.map((s) => (
            <button key={s.id} type="button"
                    className={'pill' + (form.status === s.id ? ' active' : '')}
                    onClick={() => set('status', s.id)}>{s.label}</button>
          ))}
        </div>
      </Field>

      <div className="grid grid-2">
        <Field label="Requested by" hint="Who asked for it — the community, an association.">
          <input type="text" value={form.requested_by}
                 onChange={(e) => set('requested_by', e.target.value)} />
        </Field>
        <Field label="People who benefit">
          <input type="number" min="1" value={form.beneficiaries}
                 onChange={(e) => set('beneficiaries', e.target.value)} />
        </Field>
      </div>

      <Field label="When">
        <input type="text" value={form.timeline} placeholder="October, or Oct–Dec"
               onChange={(e) => set('timeline', e.target.value)} />
      </Field>

      <Field label="Notes">
        <textarea rows={3} value={form.need} onChange={(e) => set('need', e.target.value)} />
      </Field>
    </Modal>
  );
}

/* ------------------------------ detail view ------------------------------- */

function ProjectDetail({ project, framework, canEdit, onEdit, onClose, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [photos, setPhotos] = useState(project.photos || []);

  const setStatus = async (status) => {
    setBusy(true); setError('');
    try { await api.patch('/projects/' + project.id, { status }); onChanged(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const upload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true); setError('');
    try {
      const body = new FormData();
      body.append('photo', file);
      const added = await api.form('/projects/' + project.id + '/photos', body);
      setPhotos([...photos, added]);
      if (added.durable === false) {
        setError('Saved, but this server stores photos on temporary disk — '
               + 'it will disappear on the next deploy. Tell the programme office.');
      }
      onChanged();
    } catch (e) { setError(e.message); } finally { setBusy(false); event.target.value = ''; }
  };

  return (
    <Modal title={project.title} onClose={onClose}>
      {error && <Alert type="warn">{error}</Alert>}
      <dl className="kv">
        <dt>Project</dt><dd>{project.project_name}{project.is_custom === 1 && ' (not on the framework list)'}</dd>
        <dt>Sector</dt><dd>{project.sector}</dd>
        <dt>Scale</dt><dd style={{ textTransform: 'capitalize' }}>{project.scale}</dd>
        <dt>LGA / Ward</dt><dd>{project.lga} / {project.ward}</dd>
        <dt>Community/Area</dt><dd>{project.community || '--'}</dd>
        <dt>Polling Unit</dt><dd>{project.polling_unit || '--'}</dd>
        <dt>Quantity</dt><dd>{num(project.quantity)} {project.unit || ''}</dd>
        <dt>Voters (ward)</dt><dd>{project.ward_voters==null?'--':num(project.ward_voters)}</dd>
        <dt>PDP</dt><dd>{(project.pdp_people==null?'Not loaded':num(project.pdp_people))}</dd>
        <dt>Estimated unit cost</dt><dd>{project.unit_cost==null?'--':naira(project.unit_cost)}</dd>
        <dt>Estimated request cost</dt><dd>{project.estimated_cost==null?'--':naira(project.estimated_cost)}</dd>
        <dt>Requested By</dt><dd>{project.requested_by || '--'}</dd>
        <dt>Contact Person</dt><dd>{project.contact_person || '--'}</dd>
        <dt>Contact Phone</dt><dd>{project.contact_phone || '--'}</dd>
        <dt>Estimated Beneficiaries</dt><dd>{project.beneficiaries==null?'--':num(project.beneficiaries)}</dd>
        <dt>Request Date</dt><dd>{project.request_date || '--'}</dd>
        <dt>Target Completion Date</dt><dd>{project.target_completion_date || '--'}</dd>
        {project.candidate_name && <><dt>Candidate</dt><dd>{project.candidate_name}</dd></>}
        {project.need && <><dt>Need</dt><dd>{project.need}</dd></>}
        {project.timeline && <><dt>Timeline</dt><dd>{project.timeline}</dd></>}
      </dl>

      {project.sites?.length > 0 && (
        <>
          <div className="section-title">Locations</div>
          <WardMap lga={project.lga} ward={project.ward} sites={project.sites}
                   onChange={() => {}} readOnly height={240} />
        </>
      )}

      {canEdit && (
        <>
          <div className="btn-row" style={{ marginTop: 14 }}>
            <button className="btn sm" onClick={onEdit}>Edit this project</button>
          </div>

          <div className="section-title">Status</div>
          <div className="pill-row">
            {framework.statuses.map((s) => (
              <button key={s.id} type="button" disabled={busy}
                      className={'pill' + (project.status === s.id ? ' active' : '')}
                      onClick={() => setStatus(s.id)}>{s.label}</button>
            ))}
          </div>

          <div className="section-title">Evidence photos (optional)</div>
          <p className="hint">
            Most projects are promises with nothing yet to photograph. Add before
            and after pictures once work actually begins.
          </p>
          <input type="file" accept="image/*" onChange={upload} disabled={busy} />
        </>
      )}

      {photos.length > 0 && (
        <div className="btn-row" style={{ flexWrap: 'wrap', marginTop: 10 }}>
          {photos.map((p) => (
            <a key={p.id || p.url} href={p.url} target="_blank" rel="noreferrer">
              <img src={p.url} alt={p.caption || 'Evidence'}
                   style={{ height: 72, borderRadius: 8, border: '1px solid var(--ink-100)' }} />
            </a>
          ))}
        </div>
      )}
    </Modal>
  );
}

/* -------------------------------- the page -------------------------------- */

/**
 * The projects register. Used twice: as its own page (with filters, and the
 * statewide view for oversight roles) and embedded in a candidate's dashboard
 * in `compact` form. One implementation so the two cannot drift apart.
 */
export function ProjectsPanel({ compact = false }) {
  const { me } = useAuth();
  const [framework, setFramework] = useState(null);
  const [geo, setGeo] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState(null);
  const [costEditing,setCostEditing]=useState(null);
  const [deleting,setDeleting]=useState(null);
  const [catalogue, setCatalogue] = useState({ items: [], units: [] });
  const [open, setOpen] = useState(null);
  const [analysis,setAnalysis]=useState({search:'',candidate:''});
  const [sort,setSort]=useState('ward_voters'),[direction,setDirection]=useState('desc');
  const [filter, setFilter] = useState({
    scale: '', sector: '', status: '', lga: '', ward: '', polling_unit: '' });

  const load = () => api.get('/projects').then(setData).catch((e) => setError(e.message));

  useEffect(() => {
    load();
    api.get('/project-framework').then(setFramework).catch((e) => setError(e.message));
    api.get('/geo').then(setGeo).catch(() => {});
    api.get('/project-items').then(setCatalogue).catch(() => {});
  }, []);

  if (error && !data) return <Alert type="error">{error}</Alert>;
  if (!data || !framework) return <Loading label="Loading projects" />;

  const canSeeAll = data.can_see_all;
  const isCandidate = isCandidateRole(me.user.role);
  const matches = (r, ignore) => ['scale', 'sector', 'status', 'lga', 'ward', 'polling_unit']
    .every((k) => k === ignore || !filter[k] || r[k] === filter[k]);

  const rows = compareProjects(data.rows.filter(r=>matches(r)),analysis,sort,direction);
  const comparison = projectComparisonTotals(rows);

  /**
   * The values actually present, not every ward in Kwara. Offering all 6,364
   * polling units when a candidate has projects in nine of them is a list
   * nobody can use.
   *
   * Each list is built from the rows that pass the OTHER filters, so choosing
   * an LGA narrows the wards, and choosing a ward narrows the units. The
   * currently chosen value is always kept, so a selection never vanishes from
   * the list that produced it.
   */
  const optionsFor = (key) => [...new Set(data.rows
    .filter((r) => matches(r, key))
    .map((r) => r[key])
    .concat(filter[key] || [])
    .filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'en'));

  const places = [
    ['lga', 'All LGAs', 170],
    ['ward', 'All wards', 210],
    ['polling_unit', 'All polling units', 240],
  ];

  const totalSites = rows.reduce((a, r) => a + (r.quantity || 0), 0);
  const estimatedCostTotal = rows.reduce((sum, row) => sum + (Number(row.estimated_cost) || 0), 0);
  const bySector = rows.reduce((a, r) => { a[r.sector] = (a[r.sector] || 0) + r.quantity; return a; }, {});
  const topSector = Object.entries(bySector).sort((a, b) => b[1] - a[1])[0];

  return (
    <>
      {error && <Alert type="error" onClose={() => setError('')}>{error}</Alert>}
      {deleting&&<DeleteProject project={deleting} onClose={()=>setDeleting(null)} onDeleted={async id=>{setData(current=>({...current,rows:current.rows.filter(r=>r.id!==id)}));setOpen(null);await load();}}/>}
      {costEditing&&me.permissions.is_admin&&<ProjectCostEditor project={costEditing} onClose={()=>setCostEditing(null)} onSaved={async()=>{await load();setOpen(null);}}/>}
      {adding && geo && (
        <AddProject framework={framework} geo={geo} items={catalogue.items}
                    onClose={() => setAdding(false)} onSaved={load} />
      )}
      {importing && (
        <ImportProjects onClose={() => setImporting(false)} onSaved={load} />
      )}
      {editing && geo && (
        <EditProject project={editing} framework={framework} geo={geo}
                     items={catalogue.items} units={catalogue.units}
                     onClose={() => setEditing(null)}
                     onSaved={() => { load(); setOpen(null); }} />
      )}
      {open && (
        <ProjectDetail project={open} framework={framework}
                       canEdit={open.candidate_id === me.user.id || me.permissions.is_admin}
                       onEdit={() => { setEditing(open); setOpen(null); }}
                       onClose={() => setOpen(null)}
                       onChanged={() => { load(); setOpen(null); }} />
      )}

      <div className={'grid ' + (compact ? 'grid-4' : 'grid-5')} style={{ marginBottom: 16 }}>
        {/* On the dashboard this is the way through to the full Projects
            page -- it is no longer in the sidebar. */}
        {compact ? (
          <Link to="/projects" className="stat-link">
            <Stat label="Projects" value={num(rows.length)} accent
                  foot="Tap to open your project register" />
          </Link>
        ) : (
          <Stat label="Projects" value={num(rows.length)} accent
                foot={canSeeAll ? 'Across all candidates' : 'Yours'} />
        )}
        <Stat label="Planned units" value={num(totalSites)} foot="Total quantity across wards" />
          <Stat label="Estimated project cost" value={naira(estimatedCostTotal)}
            foot="Fixed unit prices × project quantity" />
        <Stat label="Sectors covered" value={num(Object.keys(bySector).length)}
              foot={'of ' + framework.sectors.length + ' in the framework'} />
        {!compact && (
          <Stat label="Biggest focus" value={topSector ? topSector[0].split(' ')[0] : '—'}
                foot={topSector ? num(topSector[1]) + ' units' : 'Nothing yet'} />
        )}
      </div>

      {!compact && <Card title="Compare project requests" note="Voters are registered voters in the ward, not estimated project beneficiaries. Ward totals are counted once in the summary.">
        <div className="grid grid-3">
          <Field label="Search"><input value={analysis.search} placeholder="Item, candidate, location or description" onChange={e=>setAnalysis({...analysis,search:e.target.value})}/></Field>
          {canSeeAll && <Field label="Candidate"><select value={analysis.candidate} onChange={e=>setAnalysis({...analysis,candidate:e.target.value})}><option value="">All candidates</option>{[...new Map(data.rows.map(r=>[r.candidate_id,r.candidate_name])).entries()].map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></Field>}
          <Field label="Sort by"><select value={sort} onChange={e=>setSort(e.target.value)}>{[['ward_voters','Ward voters'],['estimated_cost','Cost'],['quantity','Quantity'],['project_name','Item'],['candidate_name','Candidate'],['lga','LGA'],['ward','Ward']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></Field>
          <Field label="Order"><select value={direction} onChange={e=>setDirection(e.target.value)}><option value="desc">Highest first / Z–A</option><option value="asc">Lowest first / A–Z</option></select></Field>
        </div>
        <p>Showing {num(rows.length)} of {num(data.rows.length)} requests · Cost: {naira(comparison.cost)} · Voters in matching wards: {num(comparison.voters)} · Wards with voter data: {num(comparison.wards)}</p>
        <div className="btn-row"><button className="btn sm secondary" onClick={()=>setAnalysis({search:'',candidate:''})}>Clear comparison filters</button><button className="btn sm secondary" disabled={!rows.length} onClick={()=>exportReportRows(rows.map(r=>({'Candidate':r.candidate_name,'LGA':r.lga,'Ward':r.ward,'Category':r.sector,'Item':r.project_name,'Description':r.need,'Quantity':r.quantity,'Unit':r.unit,'Requested By':r.requested_by,'Ward voters':r.ward_voters,'PDP':r.pdp_people??'Not loaded','Estimated cost (NGN)':r.estimated_cost})),'filtered-project-requests.csv')}>Export matching requests</button></div>
      </Card>}
      <div className="toolbar" style={{ flexWrap: 'wrap', gap: 8 }}>
        {!compact && (
          <>
            <select value={filter.sector}
                    onChange={(e) => setFilter({ ...filter, sector: e.target.value })}
                    style={{ maxWidth: 260 }}>
              <option value="">All sectors</option>
              {framework.sectors.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={filter.status}
                    onChange={(e) => setFilter({ ...filter, status: e.target.value })}
                    style={{ maxWidth: 170 }}>
              <option value="">Any status</option>
              {framework.statuses.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>

            {places.map(([key, label, width]) => {
              const options = optionsFor(key);
              if (!options.length) return null;
              return (
                <select key={key} value={filter[key]} style={{ maxWidth: width }}
                        onChange={(e) => setFilter({
                          ...filter,
                          [key]: e.target.value,
                          // Picking a wider area drops the narrower choices,
                          // which would otherwise filter everything to nothing.
                          ...(key === 'lga' ? { ward: '', polling_unit: '' } : {}),
                          ...(key === 'ward' ? { polling_unit: '' } : {}),
                        })}>
                  <option value="">{label}</option>
                  {options.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              );
            })}

            {Object.values(filter).some(Boolean) && (
              <button className="btn sm secondary"
                      onClick={() => setFilter({ scale: '', sector: '', status: '',
                        lga: '', ward: '', polling_unit: '' })}>
                Clear filters
              </button>
            )}
          </>
        )}
        {compact && <span className="muted">Your community &amp; constituency projects</span>}
        <div className="spacer" />
        {compact && data.rows.length > 0 && (
          <Link className="btn sm secondary" to="/projects">See all</Link>
        )}
        {!compact && !isCandidate && <button className="btn sm secondary" onClick={async()=>{try{await downloadFile('/projects/item-cost-review.csv','project-item-cost-review.csv');}catch(e){setError(e.message);}}}>Download item cost list</button>}
        {!compact && me.permissions.is_admin && <button className="btn sm secondary" onClick={async()=>{try{await downloadFile('/projects/templates-all.zip','all-candidate-project-templates.zip');}catch(e){setError(e.message);}}}>Download all candidate templates</button>}
        {isCandidate && !compact && (
          <button className="btn sm secondary" onClick={() => setImporting(true)}>
            Upload a list
          </button>
        )}
        {isCandidate && (
          <button className="btn sm" onClick={() => setAdding(true)}>+ Add project</button>
        )}
      </div>

      <Card title={canSeeAll ? 'All community & constituency projects' : 'My projects'}
            note={rows.length === data.rows.length
              ? (canSeeAll
                ? 'Every project entered by every candidate'
                : 'What you intend to deliver, and where')
              : num(rows.length) + ' of ' + num(data.rows.length) + ' projects shown'}
            bodyClass="">
        {rows.length === 0 ? (
          <Empty title="No projects yet">
            {isCandidate
              ? 'Add one at a time, or upload a filled-in spreadsheet if you already have '
                + 'a list — that is usually faster for a whole constituency.'
              : 'Projects appear here as candidates enter them.'}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr>{[...(canSeeAll?['Candidate']:[]),'LGA','Ward','Project Category','Item','Description','Quantity','Unit','Requested By','Voters (ward)','PDP','Cost'].map(label=><th key={label}>{label}</th>)}<th></th></tr></thead>
              <tbody>{rows.map(r=><tr key={r.id}>{canSeeAll&&<td>{r.candidate_name}</td>}<td>{r.lga}</td><td>{r.ward}</td><td>{r.sector}</td><td>{r.project_name}</td><td>{r.need||'--'}</td><td>{num(r.quantity)}</td><td>{r.unit||'--'}</td><td>{r.requested_by||'--'}</td><td>{r.ward_voters==null?'--':num(r.ward_voters)}</td><td>{(r.pdp_people==null?'Not loaded':num(r.pdp_people))}</td><td>{r.estimated_cost==null?'--':naira(r.estimated_cost)}{me.permissions.is_admin&&<div><button className="btn sm secondary" onClick={()=>setCostEditing(r)}>{r.estimated_cost==null?'Add cost':'Edit cost'}</button></div>}</td><td><button className="btn sm secondary" onClick={()=>setOpen(r)}>Detail</button>{(me.permissions.is_admin||(isCandidate&&Number(r.candidate_id)===Number(me.user.id)))&&<button className="btn sm danger" style={{marginLeft:6}} onClick={()=>setDeleting(r)}>Delete</button>}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

/** The Projects tab: full filters, and every candidate's register for oversight. */
export default function Projects() {
  return <ProjectsPanel />;
}
