export const DEMO_STREAMER = Object.freeze({ id: 'demo-streamer', login: 'Demo Streamer' });
export const DEMO_LOCATION = Object.freeze({ lat: 0.001, lng: 0.001 });

// React supplies a click event to onClick callbacks. This adapter deliberately
// drops it so only serializable incident arguments can reach the SOS pipeline.
export function createSosClickHandler(onTrigger, source = 'button', transcript = '') {
  return () => onTrigger(source, transcript);
}

function readBrowserLocation(geolocation) {
  if (!geolocation?.getCurrentPosition) {
    return Promise.reject(new Error('Location access is unavailable in this browser.'));
  }
  return new Promise((resolve, reject) => geolocation.getCurrentPosition(
    (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
    (error) => reject(new Error(error.code === 1 ? 'Location permission is required to send an SOS.' : 'Could not read your current location.')),
    { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 }
  ));
}

export async function submitSos({
  demoMode,
  user,
  geolocation = globalThis.navigator?.geolocation,
  fetchImpl = fetch,
  apiUrl,
  accessToken = '',
  source = 'button',
  transcript = ''
}) {
  if (!demoMode && !user) {
    const error = new Error('Sign in with a FULE account or connect Twitch before starting SOS.');
    error.code = 'TWITCH_LOGIN_REQUIRED';
    throw error;
  }

  const streamer = demoMode ? DEMO_STREAMER : user;
  const location = demoMode ? DEMO_LOCATION : await readBrowserLocation(geolocation);

  if (!demoMode) {
    const locationResponse = await fetchImpl(`${apiUrl}/api/streamer/location`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      body: JSON.stringify({ location })
    });
    if (!locationResponse.ok) throw new Error('Secure location update failed.');
  }

  const response = await fetchImpl(`${apiUrl}/api/sos`, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': globalThis.crypto?.randomUUID?.() || `fule-${Date.now()}-${Math.random().toString(36).slice(2)}`, ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    body: JSON.stringify({
      streamer_id: streamer.id,
      location,
      module_type: 'FULE_PROTECT',
      audio_transcript_snippet: transcript,
      source
    })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'SOS could not be sent.');
  return { ...result, streamer };
}
