// The login limiter is a security control: usernames follow a published
// pattern and accounts ship with a shared starting password, so this is what
// stands between the app and scripted guessing. Worth testing directly.

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeLimiter } from './rate-limit.js';

test('allows attempts up to the limit, then blocks', () => {
  const limited = makeLimiter(1000, 3);
  assert.equal(limited('user-a'), false, 'attempt 1');
  assert.equal(limited('user-a'), false, 'attempt 2');
  assert.equal(limited('user-a'), false, 'attempt 3');
  assert.equal(limited('user-a'), true, 'attempt 4 is over the limit');
  assert.equal(limited('user-a'), true, 'and stays blocked');
});

test('keys are counted independently', () => {
  const limited = makeLimiter(1000, 2);
  limited('candidate-1');
  limited('candidate-1');
  assert.equal(limited('candidate-1'), true, 'first key is blocked');
  assert.equal(limited('candidate-2'), false, 'a different account is unaffected');
});

test('the window resets after it lapses', () => {
  let clock = 1_000_000;
  const limited = makeLimiter(1000, 2, () => clock);
  limited('user-a');
  limited('user-a');
  assert.equal(limited('user-a'), true, 'blocked inside the window');
  clock += 1001;
  assert.equal(limited('user-a'), false, 'allowed again once the window passes');
});

test('a blocked key does not block forever', () => {
  let clock = 0;
  const limited = makeLimiter(900_000, 10, () => clock);
  for (let i = 0; i < 20; i++) limited('SEN-YUNUS-01');
  assert.equal(limited('SEN-YUNUS-01'), true, 'still blocked');
  clock += 900_001;
  assert.equal(limited('SEN-YUNUS-01'), false, 'released after the window');
});

test('the real login limits: 10 per account, 200 per IP', () => {
  const account = makeLimiter(15 * 60 * 1000, 10);
  const key = 'sh-abiola-01';
  for (let i = 0; i < 10; i++) {
    assert.equal(account(key), false, 'attempt ' + (i + 1) + ' allowed');
  }
  assert.equal(account(key), true, 'the 11th guess is refused');

  // The per-IP limit is deliberately loose: Nigerian mobile networks put many
  // real users behind one address, so a tight limit would lock out a ward.
  const perIp = makeLimiter(15 * 60 * 1000, 200);
  for (let i = 0; i < 200; i++) perIp('105.112.0.1');
  assert.equal(perIp('105.112.0.1'), true, 'refused only after 200');
});
