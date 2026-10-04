import test from 'node:test';
import assert from 'node:assert/strict';
import { reportResponseCache } from './report-response-cache.js';

test('report cache isolates users and scopes, expires and invalidates on writes', () => {
  let clock = 0, loads = 0;
  const cache = reportResponseCache({ttl:10,now:()=>clock});
  const user = {id:1,role:'candidate',scope_type:'lga',scope_value:'Akinyele'};
  const run = u => {
    let output;
    const res = {statusCode:200,json(body){output=body;}};
    cache.middleware({user:u,originalUrl:'/api/dashboard'},res,()=>res.json({load:++loads}));
    return output;
  };
  assert.equal(run(user).load,1); assert.equal(run(user).load,1);
  assert.equal(run({...user,id:2}).load,2);
  assert.equal(run({...user,scope_value:'Lagelu'}).load,3);
  clock=11; assert.equal(run(user).load,4);
  cache.clear(); assert.equal(run(user).load,5);
});
test('an invalidated in-flight response cannot refill the cache', () => {
  const cache = reportResponseCache(); let nextCalled = 0;
  const req = {user:{id:1,role:'admin'},originalUrl:'/api/users'};
  const res = {statusCode:200,json(){}};
  cache.middleware(req,res,()=>nextCalled++);
  cache.clear(); res.json({rows:['old']});
  cache.middleware(req,{statusCode:200,json(){}},()=>nextCalled++);
  assert.equal(nextCalled,2);
});
