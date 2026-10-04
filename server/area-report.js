import { canonicalLocation } from './data/geo.js';

const normal = (v) => String(v || '').trim().replace(/\s+/g, ' ').toUpperCase();
const location = canonicalLocation;
const wardKey = (r) => JSON.stringify([normal(r.lga), normal(r.ward)]);
const unitKey = (r) => JSON.stringify([normal(r.lga), normal(r.ward), normal(r.polling_unit)]);

// Inputs contain location aggregates and public project titles only. No voter identity is returned.
export function areaReport({ units, registrations = [], projects = [], voters = [], filters = {}, voterRollLoaded = false, expectedPollingUnits = null }) {
  const allWards = new Set(units.map(wardKey));
  const matches = (r) => ['lga', 'ward', 'polling_unit'].every((key) => !filters[key] || normal(r[key]) === normal(filters[key]));
  const rows = units.filter(matches).map((u) => ({ ...u, people: 0, promoters: 0, pdp: 0, voters: voterRollLoaded ? 0 : null, projects: [] }));
  const byUnit = new Map(rows.map((r) => [unitKey(r), r]));
  const wards = new Map();
  const lgas = new Map();
  for (const r of rows) {
    if (!wards.has(wardKey(r))) wards.set(wardKey(r), { lga: r.lga, ward: r.ward, polling_units: 0, units_reached: 0, people: 0, promoters: 0, pdp: 0, projects: 0, voters: voterRollLoaded ? 0 : null });
    if (!lgas.has(r.lga)) lgas.set(r.lga, { lga: r.lga, wards: 0, wards_reached: 0, polling_units: 0, units_reached: 0, people: 0, promoters: 0, pdp: 0, projects: 0, voters: voterRollLoaded ? 0 : null });
  }
  let unallocatedPeople = 0;
  for (const raw of registrations) {
    const r = location(raw);
    if (!matches(r) || !wards.has(wardKey(r))) continue;
    const unit = byUnit.get(unitKey(r));
    if (unit) { unit.people += Number(raw.people || 0); unit.promoters += Number(raw.promoters || 0); unit.pdp += Number(raw.pdp || 0); }
    else {
      const count = Number(raw.people || 0);
      unallocatedPeople += count;
      const ward = wards.get(wardKey(r));
      if (ward) { ward.people += count; lgas.get(ward.lga).people += count; ward.promoters += Number(raw.promoters || 0); lgas.get(ward.lga).promoters += Number(raw.promoters || 0); ward.pdp += Number(raw.pdp || 0); lgas.get(ward.lga).pdp += Number(raw.pdp || 0); }
    }
  }
  const wardProjects = [];
  for (const raw of projects) {
    const r = location(raw);
    if (!allWards.has(wardKey(r)) || !matches(r)) continue;
    const project = { id: raw.id, title: raw.title, status: raw.status, lga: r.lga, ward: r.ward, polling_unit: r.polling_unit || null };
    const unit = byUnit.get(unitKey(r));
    if (unit) unit.projects.push(project);
    else if (wards.has(wardKey(r))) wardProjects.push(project);
  }
  let unmappedVoters = 0;
  for (const raw of voters) {
    const r = location(raw);
    if (!matches(r)) continue;
    const ward = wards.get(wardKey(r));
    if (!ward) continue;
    const count = Number(raw.voters || 0);
    ward.voters += count;
    lgas.get(ward.lga).voters += count;
    const unit = byUnit.get(unitKey(r));
    if (unit) unit.voters += count;
    else unmappedVoters += count;
  }
  for (const r of rows) {
    const ward = wards.get(wardKey(r));
    const lga = lgas.get(r.lga);
    r.reached = r.people > 0;
    ward.polling_units++; lga.polling_units++;
    ward.units_reached += Number(r.reached); lga.units_reached += Number(r.reached);
    ward.people += r.people; lga.people += r.people; ward.promoters += r.promoters; lga.promoters += r.promoters; ward.pdp += r.pdp; lga.pdp += r.pdp;
    ward.promoters_allocated = (ward.promoters_allocated || 0) + r.promoters;
    ward.projects += r.projects.length; lga.projects += r.projects.length;
  }
  for (const r of wardProjects) { wards.get(wardKey(r)).projects++; lgas.get(r.lga).projects++; }
  for (const w of wards.values()) {
    w.promoters_allocated = w.promoters_allocated || 0;
    w.promoters_unallocated = Math.max(0,w.promoters - w.promoters_allocated);
    w.reached = w.units_reached > 0;
    w.units_remaining = w.polling_units - w.units_reached;
    lgas.get(w.lga).wards++;
    lgas.get(w.lga).wards_reached += Number(w.reached);
  }
  for (const l of lgas.values()) { l.wards_remaining = l.wards - l.wards_reached; l.units_remaining = l.polling_units - l.units_reached; }
  const reached = rows.filter((r) => r.reached).length;
  const expected = Object.values(filters).some(Boolean) ? rows.length : (expectedPollingUnits ?? rows.length);
  return {
    summary: { wards: wards.size, wards_reached: [...wards.values()].filter((w) => w.reached).length,
      wards_remaining: [...wards.values()].filter((w) => !w.reached).length,
      polling_units: expected, units_reached: reached, units_remaining: Math.max(0, expected - reached),
      unlisted_polling_units: Math.max(0, expected - rows.length),
      pdp: [...wards.values()].reduce((s, r) => s + r.pdp, 0),
      people: [...wards.values()].reduce((s, r) => s + r.people, 0), unallocated_people: unallocatedPeople,
      projects: rows.reduce((s, r) => s + r.projects.length, wardProjects.length),
      voters: voterRollLoaded ? [...wards.values()].reduce((s, w) => s + w.voters, 0) : null,
      unmapped_voters: unmappedVoters },
    lgas: [...lgas.values()], wards: [...wards.values()], units: rows, ward_projects: wardProjects,
    voter_roll_loaded: voterRollLoaded,
  };
}
