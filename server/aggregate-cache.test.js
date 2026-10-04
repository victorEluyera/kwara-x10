import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregateCache} from './aggregate-cache.js';
test('parallel report requests share an aggregate query and expiry reloads it',async()=>{
  let time=0,calls=0;const cache=aggregateCache({ttl:10,now:()=>time}),load=async()=>++calls;
  assert.deepEqual(await Promise.all([cache.get(load),cache.get(load)]),[1,1]);
  assert.equal(await cache.get(load),1);time=11;assert.equal(await cache.get(load),2);
});
test('invalidating during an import prevents an older aggregate from replacing newer counts',async()=>{
  const cache=aggregateCache();let resolveOld;const old=cache.get(()=>new Promise(resolve=>{resolveOld=resolve;}));
  await Promise.resolve();cache.clear();assert.equal(await cache.get(async()=>20),20);
  resolveOld(10);await old;assert.equal(await cache.get(async()=>30),20);
});
