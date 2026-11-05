import test from 'node:test';
import assert from 'node:assert/strict';
import { createTieredRateLimiter } from '../services/tieredRateLimiter.js';

test('tiered limiter applies IP, user and route limits with Retry-After metadata', async () => {
  let now = 100; const limiter = createTieredRateLimiter({ now: () => now });
  const config = { perIp: 2, perUser: 1, perRoute: 4, windowMs: 1000 };
  assert.equal((await limiter.consume({ ip: 'a', user: 'u1', route: '/sos' }, config)).allowed, true);
  const userLimited = await limiter.consume({ ip: 'a', user: 'u1', route: '/sos' }, config);
  assert.equal(userLimited.allowed, false); assert.equal(userLimited.scope, 'user'); assert.ok(userLimited.retry_after_ms > 0);
  assert.equal((await limiter.consume({ ip: 'b', user: 'u2', route: '/sos' }, config)).allowed, true);
  const ipOnly = createTieredRateLimiter({ now: () => now });
  const ipConfig = { perIp: 1, perRoute: 10, windowMs: 1000 };
  await ipOnly.consume({ ip: 'c', route: '/other' }, ipConfig);
  const ipLimited = await ipOnly.consume({ ip: 'c', route: '/other' }, ipConfig);
  assert.equal(ipLimited.scope, 'ip');
  now += 1001;
  assert.equal((await limiter.consume({ ip: 'b', user: 'u3', route: '/sos' }, config)).allowed, true);
});

test('shared Redis limiter uses atomic INCR and TTL semantics', async () => {
  const values = new Map();
  const redis = { async eval(_script, _keys, key, ttl) { const count = (values.get(key)?.count || 0) + 1; values.set(key, { count, ttl }); return [count, ttl]; } };
  const limiter = createTieredRateLimiter({ redis });
  assert.equal((await limiter.consume({ ip: 'ip', user: 'user', route: 'route' }, { perIp: 5, perUser: 1, perRoute: 5, windowMs: 3000 })).allowed, true);
  const result = await limiter.consume({ ip: 'ip', user: 'user', route: 'route' }, { perIp: 5, perUser: 1, perRoute: 5, windowMs: 3000 });
  assert.equal(result.scope, 'user'); assert.equal(values.size, 3);
});
