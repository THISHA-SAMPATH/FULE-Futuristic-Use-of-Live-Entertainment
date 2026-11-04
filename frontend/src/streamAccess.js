const ACTIVE_STATUSES = new Set(['PENDING_DISPATCH', 'DISPATCHING', 'ESCALATED']);

export function selectFeaturedStream({ demoMode, role, incidents = [], demoStream = null }) {
  if (demoMode) return demoStream;
  if (role !== 'guardian') return null;
  const incident = incidents.find((item) => item.stream_url && ACTIVE_STATUSES.has(item.status));
  if (!incident) return null;
  return {
    id: incident.incident_id,
    title: 'Live emergency broadcast',
    streamer: 'Verified Twitch channel',
    initials: 'VT',
    region: incident.location?.address || 'Guardian-only location',
    stream_url: incident.stream_url,
    activeIncident: true
  };
}

export function twitchPlayerUrl(streamUrl, hostname = globalThis.location?.hostname) {
  if (!streamUrl || !hostname) return null;
  try {
    const url = new URL(streamUrl);
    if (!['twitch.tv', 'www.twitch.tv'].includes(url.hostname.toLowerCase())) return null;
    const channel = url.pathname.split('/').filter(Boolean)[0];
    if (!channel) return null;
    return `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=${encodeURIComponent(hostname)}&muted=true`;
  } catch { return null; }
}
