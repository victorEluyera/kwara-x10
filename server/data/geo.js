// Kwara geography from the official INEC public polling-unit locator.
import fs from 'node:fs';
import { WARD_CONSTITUENCY } from './ward-constituencies.js';
import { locationKey, locationIdentifiers, uniqueSpellingMatch } from '../location-spelling.js';
import { SENATORIAL, FEDERAL, STATE_CONST } from './kwara-constituencies.js';
export { SENATORIAL, FEDERAL, STATE_CONST };
export const INEC_DIRECTORY = JSON.parse(fs.readFileSync(new URL('./inec-kwara-polling-units.json', import.meta.url), 'utf8'));
const normaliseLga = value => String(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
const displayLga = name => ({ 'ILORIN-SOUTH':'Ilorin South', 'ILORIN-WEST':'Ilorin West', 'OKE - ERO':'Oke Ero' }[name] || name.toLowerCase().replace(/\b\w/g, c=>c.toUpperCase()));
export const LGAS = [...new Set(INEC_DIRECTORY.records.map(r=>displayLga(r.lga)))].sort();
const canonicalLgas=Object.fromEntries(LGAS.map(name=>[normaliseLga(name),name]));
canonicalLgas.PATEGI='Patigi';
export const canonicalLga=value=>canonicalLgas[normaliseLga(value)] || null;
const officialByWard=new Map(), wardAliases=new Map();
const nameKey=locationKey;
for(const raw of INEC_DIRECTORY.records){
 const lga=canonicalLga(raw.lga), ward=raw.ward;
 const key=lga+'|'+ward;
 if(!officialByWard.has(key))officialByWard.set(key,[]);
 officialByWard.get(key).push({...raw,lga,ward});
 wardAliases.set(key,new Set([ward]));
}
export const POLLING_UNITS=Object.fromEntries(LGAS.map(lga=>[lga,{}]));
for(const [key,records] of officialByWard){
 const [lga,ward]=key.split('|');const frequencies=new Map();
 for(const r of records)frequencies.set(nameKey(r.name),(frequencies.get(nameKey(r.name))||0)+1);
 for(const r of records)r.display=frequencies.get(nameKey(r.name))>1?r.name+' [PU '+r.unit_code+']':r.name;
 POLLING_UNITS[lga][ward]=records.map(r=>r.display);
}
export const WARDS=Object.fromEntries(LGAS.map(lga=>[lga,Object.keys(POLLING_UNITS[lga])]));

const locationName = (value) => String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
const uniqueLocationName = (values, value) => {
  const raw = String(value || '').trim();
  if (values.includes(raw)) return raw;
  const matches = values.filter((v) => locationName(v) === locationName(raw));
  return matches.length === 1 ? matches[0] : raw;
};

// Resolve only clear spelling-format matches within the recorded LGA and ward.
// Unknown names remain unknown; missing units are never guessed.
export function canonicalLocation(place) {
  const lga = canonicalLga(place.lga) || String(place.lga || '').trim();
  const ward = resolveWard(lga, place.ward);
  const polling_unit = resolvePollingUnit(lga, ward, place.polling_unit);
  return { lga, ward, polling_unit };
}

const wardNumbers = {ONE:1,TWO:2,THREE:3,FOUR:4,FIVE:5,SIX:6,SEVEN:7,EIGHT:8,NINE:9,TEN:10,ELEVEN:11,TWELVE:12,THIRTEEN:13,FOURTEEN:14,
  I:1,II:2,III:3,IV:4,V:5,VI:6,VII:7,VIII:8,IX:9,X:10,XI:11,XII:12,XIII:13,XIV:14};
const wardResolutionCache = new Map(), unitResolutionCache = new Map();
function rememberResolution(cache,key,resolve) {
  if(cache.has(key))return cache.get(key);
  const result=resolve();
  if(cache.size>=20000)cache.delete(cache.keys().next().value);
  cache.set(key,result);return result;
}
export function resolveWard(lga,value) {
  return rememberResolution(wardResolutionCache,JSON.stringify([lga,value]),()=>resolveWardUncached(lga,value));
}
function resolveWardUncached(lga, value) {
  const raw=String(value || '').trim();
  if((WARDS[lga] || []).includes(raw))return raw;
  const full=/^23[\/-](\d{2})[\/-](\d{1,3})$/.exec(raw);
  if(full) return Object.entries(WARD_CONSTITUENCY[lga] || {}).find(([,m])=>m.code===`23/${full[1]}/${String(Number(full[2])).padStart(2,'0')}`)?.[0] || raw;
  const explicit=/\bWARD\s*(?:(?:NO\.?|NUMBER)\s*)?[:#-]?\s*(\d{1,3}|ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN|ELEVEN|TWELVE|THIRTEEN|FOURTEEN|XIV|XIII|XII|XI|IX|VIII|VII|VI|IV|III|II|X|V|I)\b/i.exec(raw);
  const bare=/^\d{1,3}$/.test(raw)?raw:null;
  const number=explicit ? wardNumbers[explicit[1].toUpperCase()] || Number(explicit[1]) : bare ? Number(bare) : null;
  const clean=raw.replace(explicit?.[0] || /\b(?:REGISTRATION\s+AREA|WARD|WARDS)\b/gi,'').trim();
  const choices=(WARDS[lga] || []).map(ward=>({value:ward,aliases:[...(wardAliases.get(lga+'|'+ward) || [ward])]}));
  const exact=choices.filter(c=>c.aliases.some(a=>nameKey(a)===nameKey(clean)));
  if(number) {
    const found=Object.entries(WARD_CONSTITUENCY[lga] || {}).find(([,m])=>Number(m.code.split('/').at(-1))===number)?.[0];
    const named=exact.length===1?exact[0].value:uniqueSpellingMatch(clean,choices);
    if(found && named && named!==found)return raw;
    if(!named && nameKey(clean).length>=5 && [...wardAliases.entries()].some(([key,aliases])=>!key.startsWith(lga+'|') && [...aliases].some(a=>nameKey(a)===nameKey(clean))))return raw;
    return found || raw;
  }
  if(exact.length===1)return exact[0].value;
  // A component name is valid only when it belongs to exactly one ward.
  const componentChoices=choices.map(c=>({...c,aliases:c.aliases.flatMap(a=>[a,...a.split(/[/,;]/).map(v=>v.trim()).filter(v=>nameKey(v).length>=4)])}));
  const component=componentChoices.filter(c=>c.aliases.some(a=>nameKey(a)===nameKey(clean)));
  if(component.length===1)return component[0].value;
  return uniqueSpellingMatch(clean,componentChoices) || raw;
}

export function resolvePollingUnit(lga,ward,value) {
  return rememberResolution(unitResolutionCache,JSON.stringify([lga,ward,value]),()=>resolvePollingUnitUncached(lga,ward,value));
}
function resolvePollingUnitUncached(lga, ward, value) {
  const raw = String(value || '').trim();
  const records = officialByWard.get(lga + '|' + ward) || [];
  if ((POLLING_UNITS[lga]?.[ward] || []).includes(raw)) return raw;
  const fullCode = /^23[\/-](\d{2})[\/-](\d{2})[\/-](\d{1,3})$/.exec(raw);
  if (fullCode) {
    const r = records.find(r => r.lga_code === fullCode[1] && r.ward_code === fullCode[2] && Number(r.unit_code) === Number(fullCode[3]));
    return r?.display || raw;
  }
  const numbered = /^(?:(?:POLLING\s*UNIT|P\.?\s*U\.?|UNIT)\s*[:#-]?\s*)?0*(\d{1,3})(?:(?:\s*[-:]\s*|\s+)(.+))?$/i.exec(raw);
  if (numbered) {
    const r = records.find(r => Number(r.unit_code) === Number(numbered[1]));
    if (r && (!numbered[2] || nameKey(numbered[2]) === nameKey(r.name))) return r.display;
    if(r&&numbered[2]) {
      const part=nameKey(numbered[2]);
      const ids=locationIdentifiers(numbered[2]);
      if(part.length>=5 && nameKey(r.name).includes(part) && (!ids || ids===locationIdentifiers(r.name)))return r.display;
      const match=uniqueSpellingMatch(numbered[2],records.map(r=>({value:r.display,aliases:[r.name]})));
      if(match===r.display)return r.display;
    }
    return raw;
  }
  const exact = records.filter(r => nameKey(r.display) === nameKey(raw) || nameKey(r.name) === nameKey(raw));
  if (exact.length === 1) return exact[0].display;
  // A full address must be uniquely present in an official location description.
  // Require a substantial address; short labels such as "school" are ambiguous.
  const address = nameKey(raw);
  const generic = new Set(['PRIMARYSCHOOL','COMMUNITYSCHOOL','OPENSPACE','TOWNHALL','MOSQUE','CHURCH','VILLAGE']);
  const matches = address.length >= 12 && !generic.has(address) ? records.filter(r => nameKey(r.name).includes(address)) : [];
  if(matches.length===1)return matches[0].display;
  if(generic.has(address))return raw;
  return uniqueSpellingMatch(raw,records.map(r=>({value:r.display,aliases:[r.name]}))) || raw;
}

export function hasPollingUnit(place) {
  const p = canonicalLocation(place);
  return (POLLING_UNITS[p.lga]?.[p.ward] || []).includes(p.polling_unit);
}

export const TOTAL_WARDS = Object.values(WARDS).reduce((a, w) => a + w.length, 0);
export const TOTAL_POLLING_UNITS = Object.values(POLLING_UNITS)
  .flatMap((wards) => Object.values(wards).flat()).length;

export const BANKS = [
  'Access Bank', 'Citibank Nigeria', 'Ecobank Nigeria', 'Fidelity Bank',
  'First Bank of Nigeria', 'First City Monument Bank (FCMB)', 'Globus Bank',
  'Guaranty Trust Bank (GTB)', 'Heritage Bank', 'Jaiz Bank', 'Keystone Bank',
  'Kuda Microfinance Bank', 'Lotus Bank', 'Moniepoint MFB', 'Opay (Paycom)',
  'Palmpay', 'Parallex Bank', 'Polaris Bank', 'Premium Trust Bank',
  'Providus Bank', 'Stanbic IBTC Bank', 'Standard Chartered Bank',
  'Sterling Bank', 'SunTrust Bank', 'TAJBank', 'Titan Trust Bank',
  'Union Bank of Nigeria', 'United Bank for Africa (UBA)', 'Unity Bank',
  'VFD Microfinance Bank', 'Wema Bank', 'Zenith Bank',
];

export function lgasForScope(scopeType, scopeValue) {
  if (scopeType === 'state' || !scopeValue) return LGAS;
  if (scopeType === 'senatorial') return SENATORIAL[scopeValue] || [];
  if (scopeType === 'federal') return FEDERAL[scopeValue] || [];
  if (scopeType === 'state_const') return STATE_CONST[scopeValue] || [];
  if (scopeType === 'lga') return [scopeValue];
  return LGAS;
}
