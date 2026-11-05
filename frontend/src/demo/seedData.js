export const DEMO_STREAMS = Object.freeze([
  { id: 'stream-commute', streamer: 'Mira Santos', initials: 'MS', title: 'Last train through North Loop', viewers: 842, guardians: 24, region: 'North Loop · Midtown', scene: 'violet' },
  { id: 'stream-campus', streamer: 'Nia Brooks', initials: 'NB', title: 'Walking the South Campus path', viewers: 516, guardians: 18, region: 'South Campus · College Hill', scene: 'rose' },
  { id: 'stream-nightline', streamer: 'Daniel Kim', initials: 'DK', title: 'Evening check-in by the river', viewers: 1204, guardians: 32, region: 'Riverside East · Old Town', scene: 'blue' },
  { id: 'stream-civic', streamer: 'Leila Rahman', initials: 'LR', title: 'Market Street community desk', viewers: 309, guardians: 12, region: 'Market Street · Central Ward', scene: 'amber' },
  { id: 'stream-walk', streamer: 'Jordan Ellis', initials: 'JE', title: 'A walk home through Garden East', viewers: 677, guardians: 21, region: 'Garden East · Lakeside', scene: 'mint' },
]);

export const DEMO_GUARDIANS = Object.freeze([
  { id: 'guardian-1', name: 'Asha Verma', initials: 'AV', response: '00:08', assisted: 42, color: 'lilac' },
  { id: 'guardian-2', name: 'Nora Kim', initials: 'NK', response: '00:11', assisted: 31, color: 'pink' },
  { id: 'guardian-3', name: 'Jamie Cole', initials: 'JC', response: '00:14', assisted: 27, color: 'blue' },
  { id: 'guardian-4', name: 'Imani Reed', initials: 'IR', response: '00:17', assisted: 19, color: 'gold' },
]);

export const DEMO_NETWORK = Object.freeze({ activeGuardians: 128, responseSeconds: 8, resolvedToday: 36 });

const DEMO_AREAS = ['North Loop · approximate area', 'South Campus · approximate area', 'Riverside East · approximate area'];
const DEMO_SUMMARIES = [
  'A safe-walk check-in is overdue near the North Loop station entrance.',
  'A student requested a guardian check-in along the South Campus footpath.',
  'A late commute check-in needs a follow-up near Riverside East tram stop.',
];

export function createDemoIncident(index = 0, now = Date.now()) {
  const seed = index % DEMO_AREAS.length;
  return {
    incident_id: `simulated-${now}-${seed}`,
    threat_level: seed === 1 ? 'ELEVATED' : 'CRITICAL',
    module: 'FULE_PROTECT',
    location: { lat: null, lng: null, address: DEMO_AREAS[seed] },
    summary: DEMO_SUMMARIES[seed],
    recommended_action: 'VERIFY_WITH_STREAMER',
    status: 'DISPATCHING',
    created_at: new Date(now).toISOString(),
    acknowledged_by: null,
    clip_url: null,
    stream_url: null,
    source: seed === 2 ? 'redeem' : 'chat',
    escalated: false,
    escalation_flag: null,
    demo: true,
  };
}
