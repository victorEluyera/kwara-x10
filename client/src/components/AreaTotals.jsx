import React,{useEffect,useState} from 'react';
import {api,num} from '../lib/api.js';
import {Alert,Loading} from './ui.jsx';
import CoverageTable from './CoverageTable.jsx';
import PollingUnitTable from './PollingUnitTable.jsx';
export default function AreaTotals({lgaRows=[]}){
  const [data,setData]=useState(null),[error,setError]=useState('');
  const [votersLoading,setVotersLoading]=useState(true);
  useEffect(()=>{
    let active=true,fullLoaded=false;
    api.get('/dashboard/area-report?view=coverage').then(r=>{if(active&&!fullLoaded)setData(r);}).catch(e=>{if(active&&!fullLoaded)setError(e.message);});
    api.get('/dashboard/area-report').then(r=>{fullLoaded=true;if(active){setData(r);setError('');}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setVotersLoading(false);});
    return()=>{active=false;};
  },[]);
  return <>
    {data && !data.pdp_source?.loaded && <Alert type="info">Kwara PDP membership counts are not loaded.</Alert>}
    {error&&<Alert type="error">{error}</Alert>}
    <div className="grid grid-2 dashboard-coverage-tables">
      <CoverageTable rows={lgaRows.map(row=>({...row,voters:data?.lgas.find(l=>l.lga===row.lga)?.voters??null}))}/>
      {data?<CoverageTable rows={data.wards} ward/>:<Loading label="Loading ward totals"/>}
    </div>
    {data?<PollingUnitTable rows={data.units} unmapped={data.pdp_unmapped||[]} votersLoading={votersLoading}/>:<Loading label="Loading polling units"/>}
  </>;
}
