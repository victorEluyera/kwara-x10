import {memberScope} from './scope.js';
export function memberDateFilters(query = {}) {
  const where = [], params = [];
  for (const [key, operator] of [['registered_from', '>='], ['registered_before', '<']]) {
    if (!query[key]) continue;
    const date = new Date(query[key]);
    if (!Number.isFinite(date.getTime())) throw new Error('Enter a valid registration date and time.');
    where.push(`m.created_at::timestamptz ${operator} ?::timestamptz`);
    params.push(date.toISOString());
  }
  return {where, params};
}
export function memberDataFilters(query = {}) {
  const phone = "REGEXP_REPLACE(COALESCE(m.phone, ''), '[^0-9]', '', 'g')";
  const missing = "NULLIF(TRIM(m.phone), '') IS NULL";
  const complete = `(${phone} ~ '^0[0-9]{10}$' OR ${phone} ~ '^234[0-9]{10}$')`;
  const where = [];
  if (query.phone_quality === 'missing') where.push(missing);
  if (query.phone_quality === 'incomplete') where.push(`NOT (${missing}) AND NOT ${complete}`);
  if (query.phone_quality === 'complete') where.push(complete);
  if (query.account_presence === 'missing') where.push("NULLIF(TRIM(m.account_number), '') IS NULL");
  if (query.vin_presence === 'missing') where.push("m.level IN ('mobiliser', 'unit_promoter', 'grassroot') AND NULLIF(TRIM(m.pvc_no), '') IS NULL");
  return where;
}
export function memberListOrder(query = {}) {
  const text = field => `NULLIF(TRIM(${field}), '')`;
  const voterRequired = "m.level IN ('mobiliser', 'unit_promoter', 'grassroot')";
  const issues = `(CASE WHEN ${text('m.phone')} IS NULL THEN 1 ELSE 0 END
    + CASE WHEN ${voterRequired} AND (${text('m.pvc_no')} IS NULL OR COALESCE(m.vin_verification_status, 'not_checked') <> 'verified') THEN 1 ELSE 0 END
    + CASE WHEN ${voterRequired} AND COALESCE(m.polling_unit_resolved, 0) = 0 THEN 1 ELSE 0 END
    + CASE WHEN ${text('m.bank_name')} IS NULL OR ${text('m.account_name')} IS NULL OR ${text('m.account_number')} IS NULL THEN 1 ELSE 0 END)`;
  const fields = {name: text('m.first_name') + " || ' ' || COALESCE(m.last_name, '')",
    phone: text('m.phone'), account: text('m.account_number'), account_name: text('m.account_name'),
    bank: text('m.bank_name'), vin: text('m.pvc_no'), lga: text('m.lga'), ward: text('m.ward'),
    polling_unit: text('m.polling_unit'), registered_by: text('u.full_name'), issues, created_at: 'm.created_at'};
  const key = Object.hasOwn(fields, query.sort) ? query.sort : 'created_at';
  const direction = query.direction === 'asc' ? 'ASC' : query.direction === 'desc' ? 'DESC' : key === 'created_at' || key === 'issues' ? 'DESC' : 'ASC';
  return fields[key] + ' ' + direction + ' NULLS LAST, m.id ' + direction;
}
/** Build filters against the member alias without rewriting nested SQL. */
export function memberListFilters(user,query={}) {
  const scope=memberScope(user,{alias:'m'}),where=[scope.sql],params=[...scope.params];
  where.push(...memberDataFilters(query));
  const dates = memberDateFilters(query);
  where.push(...dates.where); params.push(...dates.params);
  for(const field of ['status','lga','ward','level','upline_user_id','vin_verification_status','contact_verification_status']) {
    if(query[field]){where.push('m.'+field+' = ?');params.push(query[field]);}
  }
  if(query.polling_unit_presence==='with')where.push('m.polling_unit_resolved = 1');
  if(query.polling_unit_presence==='without')where.push('m.polling_unit_resolved = 0');
  if(query.mine==='1'){where.push('m.upline_user_id = ?');params.push(user.id);}
  if(query.q){where.push('(m.first_name ILIKE ? OR m.last_name ILIKE ? OR m.phone ILIKE ? OR m.code ILIKE ? OR m.polling_unit ILIKE ?)');params.push(...Array(5).fill('%'+query.q+'%'));}
  return {clause:where.map(condition=>'('+condition+')').join(' AND '),params};
}
