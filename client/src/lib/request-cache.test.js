import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestCache } from './request-cache.js';

test('cached reads share in-flight work, expire and clear after changes', async () => {
  let time = 0, calls = 0;
  const cache = createRequestCache({ttl:10, now:()=>time});
  const load = async () => ++calls;
  assert.deepEqual(await Promise.all([cache.get('user-a:report',load),cache.get('user-a:report',load)]),[1,1]);
  assert.equal(await cache.get('user-a:report',load),1);
  assert.equal(await cache.get('user-b:report',load),2);
  time = 11;
  assert.equal(await cache.get('user-a:report',load),3);
  cache.clear(); assert.equal(await cache.get('user-a:report',load),4);
});
test('failed reads are retried and invalidated in-flight results cannot refill cache', async () => {
  const cache = createRequestCache();
  await assert.rejects(cache.get('x',()=>Promise.reject(Error('offline'))));
  let finish;
  const pending = cache.get('x',()=>new Promise(resolve=>{finish=resolve;}));
  await Promise.resolve(); cache.clear(); finish('old'); await pending;
  assert.equal(await cache.get('x',async()=>'new'),'new');
});
