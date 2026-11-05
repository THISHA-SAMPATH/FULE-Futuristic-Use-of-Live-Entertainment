export function buildDegradedSnapshot({ database = 'unknown', redis = 'unknown', triage = 'unknown', dispatch = 'unknown' } = {}) {
  const statuses = { database, redis, triage, dispatch };
  const degraded_modes = [];
  if (database === 'demo_file') degraded_modes.push('database_demo_file_storage');
  if (database === 'degraded') degraded_modes.push('database_unavailable');
  if (redis === 'disabled') degraded_modes.push('redis_disabled_single_instance_only');
  if (redis === 'degraded') degraded_modes.push('redis_unavailable');
  if (triage.startsWith('available:')) degraded_modes.push('transparent_local_triage');
  if (dispatch === 'simulated') degraded_modes.push('dispatch_simulated');
  if (dispatch === 'unconfigured') degraded_modes.push('dispatch_unconfigured');
  return { status: 'ok', mode: degraded_modes.length ? 'degraded' : 'normal', dependencies: statuses, degraded_modes, alerts_available: true };
}
