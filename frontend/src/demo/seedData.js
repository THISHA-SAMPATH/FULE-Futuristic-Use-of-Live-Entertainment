export const DEMO_STREAMS = Object.freeze([
  { id: 'stream-commute', streamer: 'miraafterdark', initials: 'MA', title: 'Last train, safer together', viewers: 842, guardians: 24, region: 'North Loop', scene: 'violet' },
  { id: 'stream-campus', streamer: 'campuscompass', initials: 'CC', title: 'Campus walk-home check-in', viewers: 516, guardians: 18, region: 'University District', scene: 'rose' },
  { id: 'stream-nightline', streamer: 'nightlinecrew', initials: 'NC', title: 'Nightline neighborhood watch', viewers: 1204, guardians: 32, region: 'River Quarter', scene: 'blue' },
  { id: 'stream-civic', streamer: 'civicafterhours', initials: 'CA', title: 'Community desk · open channel', viewers: 309, guardians: 12, region: 'Market Ward', scene: 'amber' },
  { id: 'stream-walk', streamer: 'walkwithlee', initials: 'WL', title: 'Walk-along until you’re home', viewers: 677, guardians: 21, region: 'Garden East', scene: 'mint' },
]);

export const DEMO_GUARDIANS = Object.freeze([
  { id: 'guardian-1', name: 'Asha Verma', initials: 'AV', response: '00:08', assisted: 42, color: 'lilac' },
  { id: 'guardian-2', name: 'Nora Kim', initials: 'NK', response: '00:11', assisted: 31, color: 'pink' },
  { id: 'guardian-3', name: 'Jamie Cole', initials: 'JC', response: '00:14', assisted: 27, color: 'blue' },
  { id: 'guardian-4', name: 'Imani Reed', initials: 'IR', response: '00:17', assisted: 19, color: 'gold' },
]);

export const DEMO_NETWORK = Object.freeze({ activeGuardians: 128, responseSeconds: 8, resolvedToday: 36 });

const DEMO_AREAS = ['West End · approximate area', 'University District · approximate area', 'River Quarter · approximate area'];
const DEMO_SUMMARIES = [
  'A scheduled community check-in missed its window. Nearby guardians are reviewing the stream.',
  'A streamer requested a private safety check during a late commute.',
  'Community moderators flagged a request for a trusted contact to follow up.',
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
