import {pdpPromoterOverlap} from './pdp-promoter-overlap.js';
import {canonicalLocation,INEC_DIRECTORY,SENATORIAL} from './data/geo.js';
import {WARD_CONSTITUENCY} from './data/ward-constituencies.js';
import {estimatedProjectCost} from './data/project-items.js';
import {aggregateCache} from './aggregate-cache.js';

const number=value=>Number(value)||0;
const json=(value,fallback)=>{try{return typeof value==='string'?JSON.parse(value):value??fallback;}catch{return fallback;}};
const norm=value=>String(value||'').trim().toLowerCase();
const places=new Map();
for(const record of INEC_DIRECTORY.records){
  const wardCode=`23/${record.lga_code}/${record.ward_code}`;
  for(const [lga,wards] of Object.entries(WARD_CONSTITUENCY)){
    const ward=Object.keys(wards).find(name=>wards[name].code===wardCode);
    if(!ward)continue;
    const location=canonicalLocation({lga,ward,polling_unit:`${wardCode}/${record.unit_code}`});
    places.set(JSON.stringify([lga,ward,location.polling_unit]),`${wardCode}/${record.unit_code}`);
    break;
  }
}
export function apiLocation(raw){
  const location=canonicalLocation(raw);
  const ward_code=WARD_CONSTITUENCY[location.lga]?.[location.ward]?.code||null;
  const polling_unit_code=places.get(JSON.stringify([location.lga,location.ward,location.polling_unit]))||null;
  return {...location,ward_code,polling_unit_code,location_resolved:Boolean(polling_unit_code)};
}
export function projectStage(status){
  const value=norm(status).replaceAll(' ','_');
  if(['completed','delivered','done','commissioned'].includes(value))return 'completed';
  if(['ongoing','in_progress','started'].includes(value))return 'ongoing';
  if(['not_started','approved','planned','pending'].includes(value))return 'not_started';
  if(['promised','promise','request','requested','submitted','proposed','draft'].includes(value))return 'submitted';
  return 'other';
}
const statuses=['verified','pending','flagged','rejected'];
const roleStatusFields=['promoters','volunteers'].flatMap(role=>statuses.map(status=>`${role}_${status}`));
const roleStatusSql=['promoters','volunteers'].flatMap(role=>statuses.map(status=>
  `SUM(CASE WHEN m.level IN (${role==='promoters'?"'mobiliser','unit_promoter'":"'grassroot','grassroots'"}) AND m.status='${status}' THEN 1 ELSE 0 END) ${role}_${status}`)).join(',');
const countFields=['members','verified','pending','flagged','rejected','unit_promoters','grassroots',...roleStatusFields];
const areaKey=(place,level)=>JSON.stringify(level==='lga'?[place.lga]:level==='ward'?[place.lga,place.ward]:[place.lga,place.ward,place.polling_unit]);
const areaBucket=(place,level)=>({lga:place.lga,...(level!=='lga'?{ward:place.ward,ward_code:place.ward_code}:{}),
  ...(level==='polling_unit'?{polling_unit:place.polling_unit,polling_unit_code:place.polling_unit_code,code:place.polling_unit_code}:{}),
  name:level==='lga'?place.lga:level==='ward'?place.ward:place.polling_unit,
  ...Object.fromEntries(countFields.map(field=>[field,0])),projects:0,estimated_cost:0,projects_without_cost:0});

export function fieldWorkSummary(rows){
  const questions=new Map(),locations=new Map(),days=new Map(),tasks=new Set();
  const sentiment={positive:0,negative:0,neutral:0,other:0};
  const topics=new Map();let responses=0,invalid=0,first=null,last=null;
  const keywords={Water:/\bwater|borehole|well\b/i,Roads:/\broad|bridge|grading|pothole\b/i,
    Electricity:/\belectric|power|transformer|street.?light\b/i,Healthcare:/\bhealth|clinic|hospital\b/i,
    Education:/\bschool|education|classroom\b/i,Security:/\bsecurity|crime|police\b/i,
    Jobs:/\bjob|employment|empowerment\b/i,Sanitation:/\bsanitation|waste|drainage|refuse\b/i};
  for(const row of rows){
    const count=number(row.responses)||1;responses+=count;tasks.add(row.task_id);
    const at=row.collected_at;
    if(at&&(!first||Date.parse(at)<Date.parse(first)))first=at;
    if(at&&(!last||Date.parse(at)>Date.parse(last)))last=at;
    const date=Number.isFinite(Date.parse(at))?new Date(Date.parse(at)+3600000).toISOString().slice(0,10):null;
    if(date)days.set(date,(days.get(date)||0)+count);
    const place=apiLocation(row),locationKey=areaKey(place,'polling_unit');
    if(!locations.has(locationKey))locations.set(locationKey,{...place,responses:0,questions:new Map(),issues_and_needs:new Map(),
      sentiment:{positive:0,negative:0,neutral:0,other:0},first_collected_at:null,last_collected_at:null});
    const location=locations.get(locationKey);location.responses+=count;
    if(at&&(!location.first_collected_at||Date.parse(at)<Date.parse(location.first_collected_at)))location.first_collected_at=at;
    if(at&&(!location.last_collected_at||Date.parse(at)>Date.parse(location.last_collected_at)))location.last_collected_at=at;
    const answers=json(row.answers_json,null),definition=json(row.questions_json,[]);
    if(!answers||typeof answers!=='object'||Array.isArray(answers)){invalid+=count;continue;}
    const responseTopics=new Set();
    for(const question of Array.isArray(definition)?definition:[]){
      const value=answers[question.id];if(value==null||value==='')continue;
      const qkey=JSON.stringify([row.task_id,question.id]);
      const make=()=>({task_id:row.task_id,task_title:row.task_title,question_id:question.id,question:question.label,type:question.type,
        responses:0,answers:new Map(),free_text_responses:0,unclassified_responses:0});
      if(!questions.has(qkey))questions.set(qkey,make());
      if(!location.questions.has(qkey))location.questions.set(qkey,make());
      const buckets=[questions.get(qkey),location.questions.get(qkey)];
      for(const bucket of buckets)bucket.responses+=count;
      const options=Array.isArray(question.options)?question.options:[];
      const selected=[...new Set((Array.isArray(value)?value:[value]).map(v=>String(v)))];
      let known=false;
      for(const answer of selected){
        const option=options.find(option=>norm(option)===norm(answer));
        if(option==null)continue;known=true;
        for(const bucket of buckets)bucket.answers.set(option,(bucket.answers.get(option)||0)+count);
        if(/sentiment|feeling|satisfaction|satisfied|opinion/i.test(question.label||'')){
          const category=/^negative$|dissatisfied|unhappy|unfavourable/i.test(option)?'negative'
            :/^positive$|^satisfied$|happy|favourable/i.test(option)?'positive':/^neutral$|neither/i.test(option)?'neutral':'other';
          sentiment[category]+=count;
          location.sentiment[category]+=count;
        }
        if(/need|priority|problem|issue/i.test(question.label||''))responseTopics.add(option);
      }
      if(!known){
        for(const bucket of buckets){if(question.type==='text'||question.type==='textarea')bucket.free_text_responses+=count;bucket.unclassified_responses+=count;}
        // Only category counts leave the server; original free text may contain personal details.
        for(const [topic,pattern] of Object.entries(keywords))if(selected.some(value=>pattern.test(value)))responseTopics.add(topic);
      }
    }
    for(const topic of responseTopics){
      topics.set(topic,(topics.get(topic)||0)+count);
      location.issues_and_needs.set(topic,(location.issues_and_needs.get(topic)||0)+count);
    }
  }
  const shape=question=>({...question,answers:[...question.answers].map(([value,responses])=>({value,responses}))});
  return {surveys:tasks.size,responses,first_collected_at:first,last_collected_at:last,
    reporting_timezone:'Africa/Lagos',responses_by_date:[...days].sort().map(([date,responses])=>({date,responses})),
    questions:[...questions.values()].map(shape),by_location:[...locations.values()].map(location=>({...location,
      questions:[...location.questions.values()].map(shape),issues_and_needs:[...location.issues_and_needs].map(([topic,responses])=>({topic,responses}))})),
    issues_and_needs:[...topics].map(([topic,responses])=>({topic,responses})),sentiment,
    sentiment_available:Object.values(sentiment).some(Boolean),invalid_answer_payload_responses:invalid,
    methods:{answers:'Counts of recognised questionnaire options; multiple choices may exceed response totals.',
      sentiment:'Only explicit sentiment/satisfaction question options; no sentiment inferred from registrations or project counts.',
      issues_and_needs:'Community-issue question choices plus rule-based topic matches in free text; multiple topics may count one response.',
      free_text:'Original free-text responses are withheld; counts and topic categories only.'}};
}

export function buildDashboardPayload(memberGroups,projectRows,surveyRows,lastUpdated,generatedAt=new Date().toISOString()){
  const maps={lga:new Map(),ward:new Map(),polling_unit:new Map()};
  const totals=Object.fromEntries(countFields.map(field=>[field,0]));
  const ensure=(place,level)=>{
    const key=areaKey(place,level);if(!maps[level].has(key))maps[level].set(key,areaBucket(place,level));return maps[level].get(key);
  };
  for(const group of memberGroups){
    const place=apiLocation(group);
    for(const field of countFields)totals[field]+=number(group[field]);
    for(const level of Object.keys(maps)){const bucket=ensure(place,level);for(const field of countFields)bucket[field]+=number(group[field]);}
  }
  const stages={submitted:0,not_started:0,ongoing:0,completed:0,other:0};
  const projects=projectRows.map(project=>{
    const place=apiLocation(project),stage=projectStage(project.status),cost=estimatedProjectCost(project);
    stages[stage]++;
    for(const level of Object.keys(maps)){
      const bucket=ensure(place,level);bucket.projects++;bucket.estimated_cost+=cost??0;if(cost==null)bucket.projects_without_cost++;
    }
    return {id:project.id,project_id:project.id,title:project.title,type:project.project_name||project.title,item_id:project.item_id,
      ...place,status:stage,source_status:project.status,estimated_cost:cost,estimated_cost_ngn:cost,
      quantity:number(project.quantity)||1,created_at:project.created_at,updated_at:project.updated_at||project.created_at};
  });
  const areas=Object.fromEntries(Object.entries(maps).map(([level,map])=>[level,[...map.values()].sort((a,b)=>areaKey(a,level).localeCompare(areaKey(b,level)))]));
  const coverage={lgas:areas.lga.filter(row=>row.members>0).length,wards:areas.ward.filter(row=>row.members>0&&row.ward_code).length,
    polling_units:areas.polling_unit.filter(row=>row.members>0&&row.polling_unit_code).length};
  const districts=Object.entries(SENATORIAL).map(([name,lgas])=>{
    const selected=areas.lga.filter(row=>lgas.includes(row.lga));return {name,...Object.fromEntries(countFields.map(field=>[field,selected.reduce((sum,row)=>sum+row[field],0)]))};
  });
  const fieldWork=fieldWorkSummary(surveyRows);
  const summary={generated_at:generatedAt,last_updated_at:lastUpdated,totals:{...totals,registered:totals.members,volunteers:totals.grassroots},coverage,
    promoters_by_status:Object.fromEntries(statuses.map(status=>[status,totals[`promoters_${status}`]])),
    volunteers_by_status:Object.fromEntries(statuses.map(status=>[status,totals[`volunteers_${status}`]])),
    surveys:{count:fieldWork.surveys,responses:fieldWork.responses},projects:{total:projects.length,stages,estimated_cost:projects.reduce((sum,p)=>sum+(p.estimated_cost??0),0)}};
  return {schema_version:'2.0',generated_at:generatedAt,last_updated_at:lastUpdated,aggregates_only:true,test_records_excluded:true,
    summary,totals:summary.totals,coverage:{...coverage,by_lga:areas.lga,by_ward:areas.ward,by_polling_unit:areas.polling_unit,by_senatorial_district:districts},
    by_lga:{complete:true,areas:areas.lga},by_ward:{complete:true,areas:areas.ward},by_polling_unit:{complete:true,areas:areas.polling_unit},
    by_senatorial_district:{complete:true,areas:districts},projects:{total:projects.length,count:projects.length,complete:true,truncated:false,next_offset:null,rows:projects,projects,stages},
    field_work:fieldWork,surveys:summary.surveys,
    notes:{member_status:'verified/pending/flagged/rejected are recorded member statuses, independent of contact-centre and VIN checks.',
      coverage:'Canonical locations with at least one member; this is not the 10-promoter saturation measure.',
      unknown_locations:'Unresolved locations remain in aggregate rows with null official codes; they do not inflate official coverage.',
      project_status:'promised/request/submitted => submitted; approved/planned/pending => not_started; ongoing => ongoing; delivered/completed => completed.',
      test_records:'Explicit is_test flags, test-prefixed names/titles, and (delete me) markers, including test owners, are excluded.'}};
}

const real=(alias,name)=>`COALESCE(${alias}.is_test,0)=0 AND COALESCE(${name},'') !~* '(^[[:space:]]*test([[:space:]]|$)|\\(delete me\\))'`;
const cache=aggregateCache({ttl:30000});
export function clearExternalDashboardCache(){cache.clear();}
export async function dashboardPayload(database){
  return cache.get(async()=>{
    const memberFilter=real('m',"m.first_name||' '||m.last_name")+' AND '+real('u','u.full_name');
    const [members,projects,surveys,updated,stakeholders,registrations,transitions,pdpOverlap]=await Promise.all([
      database.prepare(`SELECT m.lga,m.ward,m.polling_unit,MAX(GREATEST(m.created_at,COALESCE(m.contact_verification_uploaded_at,m.created_at))) last_registration,COUNT(*) members,
        SUM(CASE WHEN m.status='verified' THEN 1 ELSE 0 END) verified,SUM(CASE WHEN m.status='pending' THEN 1 ELSE 0 END) pending,
        SUM(CASE WHEN m.status='flagged' THEN 1 ELSE 0 END) flagged,SUM(CASE WHEN m.status='rejected' THEN 1 ELSE 0 END) rejected,
        SUM(CASE WHEN m.level IN ('mobiliser','unit_promoter') THEN 1 ELSE 0 END) unit_promoters,
        SUM(CASE WHEN m.level IN ('grassroot','grassroots') THEN 1 ELSE 0 END) grassroots,${roleStatusSql}
        FROM members m LEFT JOIN users u ON u.id=m.upline_user_id WHERE ${memberFilter} GROUP BY m.lga,m.ward,m.polling_unit`).all(),
      database.prepare(`SELECT p.id,p.title,p.project_name,p.item_id,p.quantity,p.budget,p.status,p.lga,p.ward,p.polling_unit,p.created_at,p.updated_at
        FROM projects p LEFT JOIN users u ON u.id=p.candidate_id WHERE ${real('p','p.title')} AND ${real('u','u.full_name')}
        AND COALESCE(p.former_candidate_name,'') !~* '(^[[:space:]]*test([[:space:]]|$)|\\(delete me\\))' ORDER BY p.id`).all(),
      database.prepare(`SELECT s.task_id,t.title task_title,t.questions_json,s.answers_json,m.lga,m.ward,m.polling_unit,s.created_at collected_at,COUNT(*) responses
        FROM submissions s JOIN tasks t ON t.id=s.task_id LEFT JOIN members m ON m.id=s.member_id
        LEFT JOIN users u ON u.id=COALESCE(m.upline_user_id,s.user_id) LEFT JOIN users collector ON collector.id=s.user_id
        WHERE s.answers_json IS NOT NULL AND ${real('s',"''")} AND ${real('t','t.title')} AND ${memberFilter} AND ${real('collector','collector.full_name')}
        GROUP BY s.task_id,t.title,t.questions_json,s.answers_json,m.lga,m.ward,m.polling_unit,s.created_at`).all(),
      database.prepare('SELECT MAX(created_at) last_updated_at FROM audit_log').get(),
      database.prepare(`SELECT
        (SELECT COUNT(*) FROM users u WHERE u.role='candidate' AND ${real('u','u.full_name')}) candidate_total,
        (SELECT COUNT(*) FROM users u WHERE u.role='candidate' AND u.status='active' AND ${real('u','u.full_name')}) candidate_active,
        COUNT(*) nominee_total,SUM(CASE WHEN m.status='verified' THEN 1 ELSE 0 END) nominee_verified,
        SUM(CASE WHEN m.status='pending' THEN 1 ELSE 0 END) nominee_pending,
        SUM(CASE WHEN m.status='flagged' THEN 1 ELSE 0 END) nominee_flagged,
        COUNT(DISTINCT m.upline_user_id) candidates_nominating
        FROM members m LEFT JOIN users u ON u.id=m.upline_user_id
        WHERE ${memberFilter} AND m.level IN ('mobiliser','unit_promoter') AND m.status<>'rejected'`).get(),
      database.prepare(`SELECT SUBSTRING(m.created_at,1,10) day,COUNT(*) registered,
        SUM(CASE WHEN m.level IN ('mobiliser','unit_promoter') THEN 1 ELSE 0 END) unit_promoters,
        SUM(CASE WHEN m.level IN ('grassroot','grassroots') THEN 1 ELSE 0 END) grassroots
        FROM members m LEFT JOIN users u ON u.id=m.upline_user_id WHERE ${memberFilter}
        GROUP BY SUBSTRING(m.created_at,1,10) ORDER BY day`).all(),
      database.prepare(`SELECT SUBSTRING(e.changed_at,1,10) day,e.to_status status,COUNT(*) count
        FROM project_status_events e JOIN projects p ON p.id=e.project_id LEFT JOIN users u ON u.id=p.candidate_id
        WHERE ${real('p','p.title')} AND ${real('u','u.full_name')}
        GROUP BY SUBSTRING(e.changed_at,1,10),e.to_status ORDER BY day`).all(),
      pdpPromoterOverlap(database,{role:'admin'},{excludeTest:true}),
    ]);
    const latest=[updated?.last_updated_at,...members.map(m=>m.last_registration),...projects.map(p=>p.updated_at||p.created_at),...surveys.map(s=>s.collected_at)].filter(Boolean).sort((a,b)=>Date.parse(b)-Date.parse(a))[0]||null;
    const payload=buildDashboardPayload(members,projects,surveys,latest);
    payload.pdp_promoter_overlap=pdpOverlap;
    payload.summary.totals.pdp_10x_promoters=pdpOverlap.matched_promoters;
    payload.stakeholders={generated_at:payload.generated_at,
      candidates:{total:number(stakeholders?.candidate_total),active:number(stakeholders?.candidate_active)},
      nominees:{total:number(stakeholders?.nominee_total),verified:number(stakeholders?.nominee_verified),
        pending:number(stakeholders?.nominee_pending),flagged:number(stakeholders?.nominee_flagged),candidates_nominating:number(stakeholders?.candidates_nominating)},
      projects:{total:projects.length}};
    const projectDays=new Map();
    for(const project of projects){const day=project.created_at?.slice(0,10);if(day)projectDays.set(day,(projectDays.get(day)||0)+1);}
    payload.activity={generated_at:payload.generated_at,
      registrations_per_day:registrations.map(row=>({day:row.day,registered:number(row.registered),unit_promoters:number(row.unit_promoters),grassroots:number(row.grassroots)})),
      projects_submitted_per_day:[...projectDays].sort().map(([day,submitted])=>({day,submitted})),
      project_status_changes_per_day:transitions.map(row=>({day:row.day,to_status:projectStage(row.status),count:number(row.count)}))};
    payload.registrations_report={registrations_per_day:payload.activity.registrations_per_day.map(row=>({date:row.day,count:row.registered}))};
    return payload;
  });
}
