import { writeFileSync } from 'node:fs';

const base = 'https://cvr.inecnigeria.org/PublicApi/';
async function options(kind, field, value) {
  const query = new URLSearchParams({ [`data[Search][${field}]`]: String(value) });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`${base}${kind}/1/Search?${query}`, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw Error(`INEC HTTP ${response.status}`);
      const data = await response.json();
      return (Array.isArray(data) ? data : [data]).flatMap(obj => Object.entries(obj))
        .filter(([key]) => !['0', '', 'selected'].includes(key));
    } catch (error) { if (attempt === 2) throw error; }
  }
}
const split = label => { const at = label.indexOf(' - '); if (at < 0) throw Error('Unexpected INEC label: ' + label); return [label.slice(0, at).trim(), label.slice(at + 3).trim()]; };
async function parallel(items, fn) {
  const result = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < items.length) { const index = next++; result[index] = await fn(items[index]); }
  }));
  return result.flat();
}
const lgas = await options('lgas', 'state_id', 24);
const wards = await parallel(lgas, async ([id, label]) => {
  const [lga_code, lga] = split(label);
  return (await options('wards', 'local_government_id', id)).map(([id, label]) => {
    const [ward_code, ward] = split(label); return { id, lga_code, lga, ward_code, ward };
  });
});
console.log(JSON.stringify({ lgas: lgas.length, wards: wards.length }));
const records = await parallel(wards, async ({ id, ...ward }) =>
  (await options('pus', 'registration_area_id', id)).map(([id, label]) => {
    const [unit_code, name] = split(label); return { ...ward, unit_code, name, id };
  }));
if (lgas.length !== 16 || wards.length !== 193 || records.length < 2887) throw Error('Incomplete Kwara directory; nothing saved');
const output = { source: 'https://cvr.inecnigeria.org/pu', retrieved_at: new Date().toISOString(), state: 'Kwara', state_code: '23', lgas: lgas.length, wards: wards.length, units: records.length, records };
writeFileSync(new URL('./data/inec-kwara-polling-units.json', import.meta.url), JSON.stringify(output, null, 2));
console.log(JSON.stringify({ saved: true, units: records.length }));
