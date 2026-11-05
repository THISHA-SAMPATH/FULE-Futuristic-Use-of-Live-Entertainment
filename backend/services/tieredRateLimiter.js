export function createTieredRateLimiter({ redis = null, now = () => Date.now() } = {}) {
  const buckets = new Map();
  async function consumeOne(scope, key, { limit, windowMs }) {
    const bucketKey = `fule:ratelimit:${scope}:${key}`;
    if (redis) {
      const [count, ttl] = await redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]); end; return {n,redis.call('PTTL',KEYS[1])}", 1, bucketKey, windowMs);
      return { allowed: count <= limit, remaining: Math.max(0, limit - count), retry_after_ms: Math.max(1, ttl) };
    }
    const current = now(); const bucket = buckets.get(bucketKey) || { startedAt: current, count: 0 };
    if (current - bucket.startedAt >= windowMs) { bucket.startedAt = current; bucket.count = 0; }
    bucket.count += 1; buckets.set(bucketKey, bucket);
    if (buckets.size > 20_000) for (const [storedKey, value] of buckets) if (current - value.startedAt >= windowMs) buckets.delete(storedKey);
    return { allowed: bucket.count <= limit, remaining: Math.max(0, limit - bucket.count), retry_after_ms: Math.max(1, bucket.startedAt + windowMs - current) };
  }
  return {
    async consume({ ip = 'unknown', user = null, route = 'unknown' }, { perIp, perUser, perRoute, windowMs }) {
      for (const [scope, key, limit] of [['ip', ip, perIp], ['user', user, perUser], ['route', route, perRoute]]) {
        if (key == null || !limit) continue;
        const scopedKey = scope === 'user' ? `${key}:${route}` : key;
        const result = await consumeOne(scope, String(scopedKey), { limit, windowMs });
        if (!result.allowed) return { ...result, scope };
      }
      return { allowed: true };
    }
  };
}
