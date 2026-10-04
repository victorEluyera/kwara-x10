import test from 'node:test';
import assert from 'node:assert/strict';
import {lgaCoverageRows} from './lga-coverage.js';
import {POLLING_UNITS} from './data/geo.js';
import {scopeTargets} from './scope.js';
const user={id:1,role:'admin',scope_type:'state'};
const lga='Ibarapa Central',ward=Object.keys(POLLING_UNITS[lga])[0];
test('32 promoters without a valid PU do not imply ward or PU coverage',()=>{
  const [row]=lgaCoverageRows([{lga,promoters:32,total:32}],[{lga,ward,polling_unit:'Not specified',promoters:32}],user,scopeTargets(user));
  assert.equal(row.promoters,32);assert.equal(row.promoters_allocated,0);assert.equal(row.promoters_unallocated,32);
  assert.equal(row.wards,0);assert.equal(row.units,0);
  assert.equal(row.wards_expected,10);assert.equal(row.units_expected,140);assert.equal(row.promoters_expected,1400);assert.equal(row.promoters_per_pu,10);
});
test('real unit aliases allocate promoters and recognised LGA variants are combined',()=>{
  const polling_unit=POLLING_UNITS[lga][ward][0];
  const [row]=lgaCoverageRows([{lga,promoters:5,total:5},{lga:lga.toUpperCase(),promoters:2,total:2}],[{lga,ward,polling_unit,promoters:5},{lga,ward,polling_unit:'Not specified',promoters:2}],user,scopeTargets(user));
  assert.equal(row.promoters,7);assert.equal(row.promoters_allocated,5);assert.equal(row.promoters_unallocated,2);
  assert.equal(row.wards,1);assert.equal(row.units,1);
});
