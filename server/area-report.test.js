import test from 'node:test';
import assert from 'node:assert/strict';
import { areaReport } from './area-report.js';

const units = [
  { lga: 'Akinyele', ward: 'IKEREKU', polling_unit: 'School' },
  { lga: 'Akinyele', ward: 'IKEREKU', polling_unit: 'Market' },
  { lga: 'Akinyele', ward: 'OJO-EMO/MONIYA', polling_unit: 'School' },
];

test('PDP totals count supplied nominee and grassroots aggregates at each geography', () => {
  const r = areaReport({ units, registrations: [
    { ...units[0], people: 7, pdp: 5 },
    { ...units[0], polling_unit: 'Unknown', people: 3, pdp: 2 },
    { ...units[2], people: 4, pdp: 4 },
  ] });
  assert.equal(r.units[0].pdp, 5);
  assert.equal(r.wards[0].pdp, 7);
  assert.equal(r.lgas[0].pdp, 11);
  assert.equal(r.summary.pdp, 11);
  assert.equal(r.summary.people, 14);
  const filtered = areaReport({ units, filters: units[0], registrations: [{ ...units[0], people: 7, pdp: 5 }, { ...units[2], people: 4, pdp: 4 }] });
  assert.equal(filtered.summary.pdp, 5);
});

test('statewide target is 6,390 without inventing units or inflating reached counts', () => {
  const r = areaReport({ units, expectedPollingUnits: 6390, registrations: [{ ...units[0], people: 10, promoters: 10 }] });
  assert.equal(r.summary.polling_units, 6390);
  assert.equal(r.summary.units_reached, 1);
  assert.equal(r.summary.units_remaining, 6389);
  assert.equal(r.units.length, 3);
  const filtered = areaReport({ units, expectedPollingUnits: 6390, filters: units[0] });
  assert.equal(filtered.summary.polling_units, 1);
  assert.equal(filtered.summary.units_remaining, 1);
});

test('zero submissions means no coverage, while every real unit remains visible', () => {
  const r = areaReport({ units });
  assert.equal(r.summary.units_reached, 0);
  assert.equal(r.summary.units_remaining, 3);
  assert.equal(r.summary.wards_reached, 0);
  assert.equal(r.summary.wards_remaining, 2);
  assert.equal(r.summary.voters, null);
  assert.equal(r.units.length, 3);
});

test('ten promoters reach exactly their ward and unit; fake units do not reach any unit', () => {
  const r = areaReport({ units, registrations: [
    { ...units[0], people: 10, promoters: 10 }, { ...units[0], polling_unit: 'Dummy', people: 2 },
    { lga: 'Outside', ward: 'IKEREKU', polling_unit: 'School', people: 10 },
  ] });
  assert.equal(r.summary.units_reached, 1);
  assert.equal(r.summary.units_remaining, 2);
  assert.equal(r.summary.wards_reached, 1);
  assert.equal(r.summary.people, 12);
  assert.equal(r.summary.unallocated_people, 2);
  assert.equal(r.units.some((u) => u.polling_unit === 'Dummy'), false);
});

test('ward-only submissions stay registered but do not count as ward or polling-unit coverage', () => {
  const r = areaReport({ units, registrations: [{ ...units[0], polling_unit: 'Not specified', people: 2 }] });
  assert.equal(r.summary.wards_reached, 0);
  assert.equal(r.summary.units_reached, 0);
});

test('voter totals use full location keys and count unmatched units only at ward/LGA level', () => {
  const r = areaReport({ units, voterRollLoaded: true, voters: [
    { lga: 'AKINYELE', ward: 'ikereku', polling_unit: 'school', voters: '40' },
    { ...units[1], voters: 20 }, { ...units[2], voters: 70 },
    { ...units[0], polling_unit: 'Unknown', voters: 5 },
    { lga: 'Outside', ward: 'IKEREKU', polling_unit: 'School', voters: 900 },
  ] });
  assert.equal(r.units[0].voters, 40);
  assert.equal(r.units[2].voters, 70);
  assert.equal(r.wards[0].voters, 65);
  assert.equal(r.lgas[0].voters, 135);
  assert.equal(r.summary.voters, 135);
  assert.equal(r.summary.unmapped_voters, 5);
  assert.ok(!JSON.stringify(r).includes('vin'));
});

test('filters recalculate denominators and voter counts for just the selected unit', () => {
  const r = areaReport({ units, filters: units[0], voterRollLoaded: true,
    registrations: [{ ...units[0], people: 2 }, { ...units[2], people: 7 }],
    voters: [{ ...units[0], voters: 10 }, { ...units[2], voters: 90 }],
  });
  assert.equal(r.units.length, 1);
  assert.equal(r.summary.people, 2);
  assert.equal(r.summary.voters, 10);
  assert.equal(r.summary.units_remaining, 0);
});

test('projects appear at their location without creating registration coverage', () => {
  const r = areaReport({ units, projects: [
    { ...units[0], id: 1, title: 'Water', status: 'promised' },
    { ...units[0], id: 2, title: 'Road', polling_unit: null },
    { ...units[0], id: 3, title: 'Outside constituency', ward: 'Other' },
  ] });
  assert.equal(r.units[0].projects.length, 1);
  assert.equal(r.ward_projects.length, 1);
  assert.equal(r.summary.projects, 2);
  assert.equal(r.wards[0].projects, 2);
  assert.equal(r.summary.units_reached, 0);
});

test('promoter totals exclude other registrations and retain ward-only promoters',()=>{
  const result=areaReport({units,registrations:[
    {...units[0],people:10,promoters:3},
    {...units[0],polling_unit:'Unknown',people:5,promoters:2},
  ]});
  assert.equal(result.units[0].promoters,3);
  assert.equal(result.wards[0].promoters,5);
  assert.equal(result.wards[0].promoters_allocated,3);
  assert.equal(result.wards[0].promoters_unallocated,2);
  assert.equal(result.lgas[0].promoters,5);
  assert.equal(result.wards[0].people,15);
});

 test('registration coverage remains independent of the saturation target',()=>{
  const below=areaReport({units,registrations:[{...units[0],people:100,promoters:9},{...units[1],people:100,promoters:0}]});
  assert.equal(below.summary.units_reached,2); assert.equal(below.summary.wards_reached,1);
  const reached=areaReport({units,registrations:[{...units[0],people:5,promoters:5},{...units[0],people:5,promoters:5}]});
  assert.equal(reached.summary.units_reached,1); assert.equal(reached.summary.wards_reached,1);
 });
