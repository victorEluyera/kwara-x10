import test from 'node:test';
import assert from 'node:assert/strict';
import {loadWithTimeout} from './load-with-timeout.js';
test('successful and failed reads settle normally',async()=>{
  assert.deepEqual(await loadWithTimeout(async()=>({rows:[]}),100),{rows:[]});
  await assert.rejects(loadWithTimeout(async()=>{throw new Error('Permission denied');},100),/Permission denied/);
});
test('a stalled read stops loading and permits another attempt',async()=>{
  await assert.rejects(loadWithTimeout(()=>new Promise(()=>{}),10),/Loading took too long/);
  assert.equal(await loadWithTimeout(async()=>42,100),42);
});
