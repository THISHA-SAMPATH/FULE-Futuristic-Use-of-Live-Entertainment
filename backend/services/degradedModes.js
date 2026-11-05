export function buildDegradedSnapshot({ database = 'unknown', redis = 'unknown', ai = 'unknown', twitch = 'unknown', dispatch = 'unknown' } = {}) {
  const statuses = { database, redis, ai, twitch, dispatch };
  const degraded_modes = [];
  if (database === 'demo_file') degraded_modes.push('database_demo_file_storage');
  if (database === 'degraded') degraded_modes.push('database_unavailable');
  if (redis === 'disabled') degraded_modes.push('redis_disabled_single_instance_only');
  if (redis === 'degraded') degraded_modes.push('redis_unavailable');
  if (ai === 'demo_fallback' || ai === 'unconfigured' || ai === 'circuit_open') degraded_modes.push('ai_deterministic_fallback');
  if (twitch === 'unconfigured' || twitch === 'circuit_open') degraded_modes.push('twitch_unavailable');
  if (dispatch === 'simulated') degraded_modes.push('dispatch_simulated');
  if (dispatch === 'unconfigured') degraded_modes.push('dispatch_unconfigured');
  return { status: 'ok', mode: degraded_modes.length ? 'degraded' : 'normal', dependencies: statuses, degraded_modes, alerts_available: true };
}
