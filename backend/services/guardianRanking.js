export function rankGuardians(candidates, { radiusMeters = 400 } = {}) {
  const radius = Math.max(1, Number(radiusMeters) || 400);
  return [...candidates].map((guardian) => {
    const distance = Math.max(0, Number(guardian.distance_m) || 0);
    const response = Math.max(1, Number(guardian.response_time_seconds) || 60);
    const trust = Math.max(0, Math.min(5, Number(guardian.trust_rating) || 0));
    const score = 0.55 * Math.max(0, 1 - distance / radius)
      + 0.30 * Math.max(0, 1 - response / 600)
      + 0.15 * (trust / 5);
    return { ...guardian, ranking_score: Number(score.toFixed(6)) };
  }).sort((a, b) => b.ranking_score - a.ranking_score || a.distance_m - b.distance_m || String(a.guardian_id).localeCompare(String(b.guardian_id)));
}
