import test from 'node:test';
import assert from 'node:assert/strict';
import { INEC_DIRECTORY, canonicalLocation, hasPollingUnit, TOTAL_POLLING_UNITS, POLLING_UNITS } from './data/geo.js';
test('official locator covers every Kwara LGA, ward and all 6390 unit codes',()=>{
  assert.equal(INEC_DIRECTORY.lgas,33);assert.equal(INEC_DIRECTORY.wards,351);assert.equal(INEC_DIRECTORY.units,6390);
  assert.equal(TOTAL_POLLING_UNITS,6390);
  for(const r of INEC_DIRECTORY.records) {
    const p=canonicalLocation({lga:r.lga,ward:'Ward '+r.ward_code,polling_unit:`30/${r.lga_code}/${r.ward_code}/${r.unit_code}`});
    assert.ok(hasPollingUnit(p));
  }
});
test('numbers, Unit 001, PU001 and full codes identify the same scoped unit',()=>{
  const forms=['1','001','Unit 001','PU001','Polling unit 001','30/02/01/001'];
  const places=forms.map(polling_unit=>canonicalLocation({lga:'Akinyele',ward:'Ward 01',polling_unit}));
  for(const p of places)assert.deepEqual(p,places[0]);
  assert.equal(places[0].polling_unit,'FALEYE VILLAGE');
});
test('full codes cannot silently cross LGA or ward; unsupported numbers remain unresolved',()=>{
  assert.equal(hasPollingUnit({lga:'Akinyele',ward:'Ward 01',polling_unit:'30/01/01/001'}),false);
  assert.equal(hasPollingUnit({lga:'Akinyele',ward:'Ward 01',polling_unit:'7388'}),false);
});
test('punctuation-equivalent addresses resolve; generic locations are never guessed',()=>{
  const p=canonicalLocation({lga:'Afijio',ward:'Ward 01',polling_unit:'a u d pry school'});
  assert.equal(p.polling_unit,'A.U.D PRY. SCHOOL');
  assert.equal(hasPollingUnit({lga:'Afijio',ward:'Ward 01',polling_unit:'school'}),false);
});
test('same-name units remain distinct when their official codes differ',()=>{
  assert.equal(new Set(Object.entries(POLLING_UNITS).flatMap(([lga,wards])=>Object.entries(wards).flatMap(([ward,units])=>units.map(unit=>lga+'|'+ward+'|'+unit)))).size,6390);
});
