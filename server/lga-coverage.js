import {nominationQuota} from './nominations.js';
import {canonicalLocation,hasPollingUnit,POLLING_UNITS} from './data/geo.js';
import {coverageOf,scopedWards} from './scope.js';
export const EXPECTED_PROMOTERS_PER_PU = nominationQuota('Senator') + nominationQuota('House of Representatives') + nominationQuota('House of Assembly');
export function lgaCoverageRows(rawRows,places,user,targets) {
  const grouped=new Map();
  for(const raw of rawRows) {
    const lga=canonicalLocation(raw).lga;
    if(!grouped.has(lga))grouped.set(lga,{...raw,lga,total:0,promoters:0,vin_matched:0});
    const row=grouped.get(lga);
    for(const key of ['total','promoters','vin_matched'])row[key]+=Number(raw[key]||0);
  }
  return [...grouped.values()].map(row=>{
    const wards=scopedWards(user,row.lga),allowed=new Set(wards);
    const locations=places.filter(p=>canonicalLocation(p).lga===row.lga);
    const reached=coverageOf(locations,targets,user);
    const allocated=locations.reduce((sum,p)=>{
      const place=canonicalLocation(p);
      return sum+(allowed.has(place.ward)&&hasPollingUnit(place)?Number(p.promoters||0):0);
    },0);
    const expectedUnits=wards.reduce((n,w)=>n+(POLLING_UNITS[row.lga]?.[w]||[]).length,0);
    return {...row,promoters_expected:expectedUnits*EXPECTED_PROMOTERS_PER_PU,promoters_per_pu:EXPECTED_PROMOTERS_PER_PU,wards:reached.wards,units:reached.units,wards_expected:wards.length,
      units_expected:expectedUnits,
      promoters_allocated:allocated,promoters_unallocated:Math.max(0,row.promoters-allocated)};
  });
}
