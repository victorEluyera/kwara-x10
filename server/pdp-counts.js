import {readFileSync} from 'node:fs';
import {canonicalLocation,LGAS,WARDS,hasPollingUnit} from './data/geo.js';
import {scopedLgas,scopedWards} from './scope.js';
const key=(...parts)=>JSON.stringify(parts);
export function createPdpCounts(rows) {
  const lgas=new Map(),wards=new Map(),units=new Map();
  let total=0,wardAllocated=0,unitAllocated=0;const unmapped=[];
  for(const raw of rows){
    const place=canonicalLocation(raw),count=Number(raw.count||0);total+=count;
    const add=(map,k)=>map.set(k,(map.get(k)||0)+count);
    add(lgas,place.lga);add(wards,key(place.lga,place.ward));add(units,key(place.lga,place.ward,place.polling_unit));
    if(LGAS.includes(place.lga)&&(WARDS[place.lga]||[]).includes(place.ward))wardAllocated+=count;
    if(hasPollingUnit(place))unitAllocated+=count;
    else unmapped.push({...place,count});
  }
  return {total,wardAllocated,unitAllocated,lgas,wards,units,unmapped};
}
let index;
export function pdpIndex(){
  if(!index){const source=JSON.parse(readFileSync(new URL('./data/pdp-location-counts.json',import.meta.url),'utf8'));index=createPdpCounts(source.rows);index.loaded=source.loaded!==false;if(index.total!==source.total)throw new Error('PDP count reconciliation failed');}
  return index;
}
export function pdpCount(place,level='unit') {
  const p=canonicalLocation(place),data=pdpIndex();
  if(!data.loaded)return null;
  return level==='lga'?data.lgas.get(p.lga)||0:level==='ward'?data.wards.get(key(p.lga,p.ward))||0:data.units.get(key(p.lga,p.ward,p.polling_unit))||0;
}
export function candidatePdpCount(user){
  const data=pdpIndex();
  if(!data.loaded)return null;
  if(user.scope_type==='state')return data.total;
  return scopedLgas(user).reduce((sum,lga)=>sum+scopedWards(user,lga).reduce((n,ward)=>n+(data.wards.get(key(lga,ward))||0),0),0);
}
export function attachPdpCounts(report){
  const data=pdpIndex();
  for(const row of report.units)row.pdp_people=data.loaded?(data.units.get(key(row.lga,row.ward,row.polling_unit))||0):null;
  for(const row of report.wards)row.pdp_people=data.loaded?(data.wards.get(key(row.lga,row.ward))||0):null;
  for(const row of report.lgas)row.pdp_people=data.loaded?(data.lgas.get(row.lga)||0):null;
  const allowedWards=new Set(report.wards.map(row=>key(row.lga,row.ward)));
  report.pdp_unmapped=data.unmapped.filter(row=>allowedWards.has(key(row.lga,row.ward)));
  report.pdp_source={loaded:data.loaded,total:data.loaded?data.total:null,ward_allocated:data.wardAllocated,unit_allocated:data.unitAllocated,ward_unallocated:data.total-data.wardAllocated,unit_unallocated:data.total-data.unitAllocated};
  return report;
}
