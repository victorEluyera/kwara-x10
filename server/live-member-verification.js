import {vinKey,verifyMemberLocation} from './member-vin-verification.js';
import {applyMemberVerificationReport} from './apply-member-verification.js';

export async function verifyExistingMembers(db, members) {
  if (!members.length) return {ok:true,updated:0,assigned:0,statuses:{}};
  if (!(await db.prepare('SELECT vin FROM voter_roll LIMIT 1').get())) {
    const error=Error('Upload a voter register under Admin data sources before checking members.');error.reportError=true;throw error;
  }
  const frequencies=new Map();
  for(const m of await db.prepare('SELECT pvc_no FROM members WHERE pvc_no IS NOT NULL').all()) {
    const key=vinKey(m.pvc_no);if(key)frequencies.set(key,(frequencies.get(key)||0)+1);
  }
  const wanted=[...new Set(members.map(m=>vinKey(m.pvc_no)).filter(Boolean))],locations=new Map();
  for(let i=0;i<wanted.length;i+=1000) {
    const rows=await db.prepare('SELECT vin,lga,ward,polling_unit FROM voter_roll WHERE vin = ANY(?::text[])').all(wanted.slice(i,i+1000));
    for(const r of rows){const key=vinKey(r.vin);if(!locations.has(key))locations.set(key,[]);locations.get(key).push(r);}
  }
  const statuses={};
  const updates=members.map(m=>{
    const key=vinKey(m.pvc_no),verification=verifyMemberLocation(m,locations.get(key)||[],frequencies.get(key)>1);
    statuses[verification.status]=(statuses[verification.status]||0)+1;
    return {id:m.id,code:m.code,upline_user_id:m.upline_user_id,pvc_no:m.pvc_no,original:{lga:m.lga,ward:m.ward,polling_unit:m.polling_unit},verification};
  });
  const result=await applyMemberVerificationReport(db,{version:1,sources:[{source:'Uploaded live voter register'}],updates});
  return {...result,statuses};
}
