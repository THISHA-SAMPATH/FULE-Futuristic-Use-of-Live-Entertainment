export function selectFeaturedStream({ demoMode, incidents = [], demoStream = null }) {
  if (demoMode) return demoStream;
  const active = incidents.find((incident) => ['PENDING_DISPATCH', 'DISPATCHING', 'ACKNOWLEDGED', 'ESCALATED'].includes(incident.status));
  return active ? { id: active.incident_id, title: 'Private incident stream', streamer: 'FULE member', region: active.location?.address, stream_url: null } : null;
}
