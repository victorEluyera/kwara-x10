import {pdpCount,candidatePdpCount} from './pdp-counts.js';
import { nominationSummary, nominationUnits } from './nominations.js';
import { areaReport } from './area-report.js';
import { scopeTargets } from './scope.js';

export function candidateFollowUp(candidate, members, projects = [], voters = [], generatedAt = new Date().toISOString(), summaryOnly = false) {
  const nominees = members.filter(m => m.level === 'mobiliser' && Number(m.upline_user_id) === Number(candidate.id));
  const nomination = nominationSummary(candidate, nominees);
  const report = areaReport({ units: nominationUnits(candidate),
    registrations: members.map(m => ({ ...m, people: 1, pdp: ['mobiliser', 'grassroot', 'grassroots'].includes(m.level) ? 1 : 0 })),
    projects, voters, voterRollLoaded: voters.length > 0, expectedPollingUnits: scopeTargets(candidate).polling_units });
  const s = report.summary;
  const info = {
    generated_at: generatedAt, candidate_id: candidate.id, candidate_name: candidate.full_name,
    username: candidate.username, phone: candidate.phone || '', office: candidate.office,
    email: candidate.email || '',
    people_per_polling_unit_target: nomination?.per_polling_unit ?? (nomination?.unlimited ? 'Unlimited' : 'Not set'),
    people_allocated_to_polling_units: nominees.length - (nomination?.unallocated || 0),
    constituency: candidate.scope_value || 'Kwara State',
    nominees_target: nomination?.unlimited ? 'Unlimited' : nomination?.quota ?? 'Not set',
    nominees_achieved: nominees.length,
    nominees_remaining: nomination?.remaining ?? '',
    nominees_without_allocation: nomination?.unallocated ?? '',
    total_polling_units: s.polling_units, polling_units_covered: s.units_reached,
    polling_units_remaining: s.units_remaining, total_wards: s.wards,
    wards_covered: s.wards_reached, wards_remaining: s.wards_remaining,
    registered_people: members.length, no_of_pdp: candidatePdpCount(candidate),
    pdp_people: candidatePdpCount(candidate),
    no_of_voters: s.voters ?? 'Not loaded', projects: projects.length,
  };
  const quotas = new Map((nomination?.units || []).map(u => [JSON.stringify([u.lga,u.ward,u.polling_unit]), u]));
  if (summaryOnly) return { summary: info };
  return { summary: info, units: report.units.map(u => {
    const quota = quotas.get(JSON.stringify([u.lga,u.ward,u.polling_unit]));
    return { ...info, lga: u.lga, ward: u.ward, polling_unit: u.polling_unit,
      coverage: u.reached ? 'Covered' : 'Remaining', unit_nominees_target: quota?.quota ?? '',
      unit_nominees_achieved: quota?.count ?? '', unit_nominees_remaining: quota?.remaining ?? '',
      unit_registered_people: u.people, unit_pdp_people:pdpCount(u), unit_no_of_pdp: pdpCount(u), unit_no_of_voters: u.voters ?? 'Not loaded',
      unit_projects: u.projects.map(p => p.title).join('; ') };
  }) };
}
