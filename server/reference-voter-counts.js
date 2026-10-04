import {readFileSync} from 'node:fs';
import {canonicalLocation} from './data/geo.js';
let source;
export function referenceVoterCounts(){
  if(!source){
    source=JSON.parse(readFileSync(new URL('./data/kwara-voter-location-counts.json',import.meta.url),'utf8'));
    if(source.rows.reduce((sum,row)=>sum+Number(row.voters),0)!==source.total)throw new Error('Reference voter counts do not reconcile');
  }
  return source.rows;
}
export function wardVoterCounts(rows){
  const counts=new Map();
  for(const row of rows){const place=canonicalLocation(row),key=JSON.stringify([place.lga,place.ward]);counts.set(key,(counts.get(key)||0)+Number(row.voters||0));}
  return counts;
}
export function withReferenceVoters(rows){return rows.length?rows:referenceVoterCounts();}
