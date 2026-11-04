import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { API_URL } from '../config.js';

const DEMO_LOCATION = { lat: 0.001, lng: 0.001 };

function vapidKeyBytes(value) {
  const padded = `${value.replace(/-/g, '+').replace(/_/g, '/')}${'='.repeat((4 - value.length % 4) % 4)}`;
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

export default function SafeWalkPanel({ demoMode, streamer, activeIncident, onEmergency }) {
  const [destination, setDestination] = useState('');
  const [eta, setEta] = useState(30);
  const [interval, setInterval] = useState(5);
  const [safePin, setSafePin] = useState('');
  const [duressPin, setDuressPin] = useState('');
  const [walk, setWalk] = useState(() => { try { return JSON.parse(sessionStorage.getItem('fuleSafeWalk') || 'null')?.walk || null; } catch { return null; } });
  const [sessionToken, setSessionToken] = useState(() => { try { return JSON.parse(sessionStorage.getItem('fuleSafeWalk') || 'null')?.session_token || ''; } catch { return ''; } });
  const [pin, setPin] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pushReady, setPushReady] = useState(false);
  const socketRef = useRef(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    void navigator.serviceWorker.getRegistration('/sw.js').then((registration) => registration?.pushManager.getSubscription()).then((subscription) => setPushReady(Boolean(subscription))).catch(() => {});
  }, []);

  useEffect(() => {
    if (!walk || !sessionToken) return undefined;
    void fetch(`${API_URL}/api/safe-walks/${walk.walk_id}`, { headers: { 'X-Safe-Walk-Token': sessionToken } }).then(async (response) => {
      if (!response.ok) throw new Error('Safe-walk session expired.');
      const data = await response.json(); setWalk(data.walk); sessionStorage.setItem('fuleSafeWalk', JSON.stringify({ walk: data.walk, session_token: sessionToken }));
      if (data.walk.status === 'AWAITING_CHECKIN') setSeconds(Math.max(0, Math.ceil((Date.parse(data.walk.checkin_due_at) + 60_000 - Date.now()) / 1000)));
    }).catch(() => { setWalk(null); setSessionToken(''); sessionStorage.removeItem('fuleSafeWalk'); });
    const socket = io(API_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;
    socket.on('connect', () => socket.emit('register_safe_walk', { walk_id: walk.walk_id, session_token: sessionToken }));
    socket.on('safe_walk_checkin_due', (event) => {
      setSeconds(event.countdown_seconds || 60); setWalk((current) => {
        if (!current) return current;
        const next = { ...current, status: 'AWAITING_CHECKIN', checkin_due_at: new Date().toISOString() };
        sessionStorage.setItem('fuleSafeWalk', JSON.stringify({ walk: next, session_token: sessionToken }));
        return next;
      });
      if (!pushReady && 'Notification' in window && Notification.permission === 'granted') new Notification('FULE safe-walk check-in', { body: 'Are you OK? Check in within 60 seconds.' });
    });
    socket.on('safe_walk_checkin_completed', () => {
      setSeconds(0);
      setWalk((current) => {
        if (!current) return current;
        const next = { ...current, status: 'CANCELLED' };
        sessionStorage.removeItem('fuleSafeWalk');
        return next;
      });
    });
    socket.on('safe_walk_sos_triggered', (event) => {
      if (event.incident) onEmergency?.(event.incident, event.streamer_cancel_token);
      setWalk((current) => current ? { ...current, status: 'SOS_TRIGGERED', incident_id: event.incident_id || event.incident?.incident_id } : current);
    });
    return () => socket.disconnect();
  }, [walk?.walk_id, sessionToken]);

  useEffect(() => {
    if (walk?.status !== 'AWAITING_CHECKIN') return undefined;
    const timer = window.setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [walk?.status]);

  useEffect(() => {
    if (!walk || walk.status !== 'ACTIVE' || demoMode || !navigator.geolocation) return undefined;
    const watcher = navigator.geolocation.watchPosition((position) => {
      void fetch(`${API_URL}/api/safe-walks/${walk.walk_id}/location`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Safe-Walk-Token': sessionToken },
        body: JSON.stringify({ location: { lat: position.coords.latitude, lng: position.coords.longitude } })
      });
    }, () => {}, { enableHighAccuracy: true, maximumAge: 10_000 });
    return () => navigator.geolocation.clearWatch(watcher);
  }, [walk?.walk_id, walk?.status, sessionToken, demoMode]);

  async function startWalk(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
      if ('Notification' in window && Notification.permission === 'granted' && 'serviceWorker' in navigator && 'PushManager' in window) {
        try {
          const keyResponse = await fetch(`${API_URL}/api/safe-walks/push-key`);
          const { public_key: publicKey } = await keyResponse.json();
          if (publicKey) {
            const registration = await navigator.serviceWorker.register('/sw.js');
            const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes(publicKey) });
            const saved = await fetch(`${API_URL}/api/safe-walks/push-subscription`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ streamer_id: streamer?.id || (demoMode ? 'demo-streamer' : undefined), subscription: subscription.toJSON() }) });
            if (saved.ok) setPushReady(true);
          }
        } catch { setPushReady(false); }
      }
      let location = demoMode ? DEMO_LOCATION : null;
      if (!demoMode) location = await new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error('Location access is unavailable in this browser.'));
        navigator.geolocation.getCurrentPosition((position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }), () => reject(new Error('Location permission is required to start a safe walk.')), { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 });
      });
      const response = await fetch(`${API_URL}/api/safe-walks`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ streamer_id: streamer?.id || (demoMode ? 'demo-streamer' : undefined), destination, eta_minutes: Number(eta), check_in_interval_minutes: Number(interval), safe_pin: safePin, duress_pin: duressPin, location }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not start a safe walk.');
      setWalk(data.walk); setSessionToken(data.session_token); sessionStorage.setItem('fuleSafeWalk', JSON.stringify({ walk: data.walk, session_token: data.session_token })); setSafePin(''); setDuressPin('');
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  }

  async function checkIn(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch(`${API_URL}/api/safe-walks/${walk.walk_id}/check-in`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Safe-Walk-Token': sessionToken }, body: JSON.stringify({ pin }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not check in.');
      const updatedWalk = data.walk || { ...walk, status: 'ACTIVE' }; setWalk(updatedWalk);
      if (updatedWalk.status === 'ACTIVE') sessionStorage.setItem('fuleSafeWalk', JSON.stringify({ walk: updatedWalk, session_token: sessionToken }));
      else sessionStorage.removeItem('fuleSafeWalk');
      setSeconds(0); setPin('');
      if (data.incident) onEmergency?.(data.incident);
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  }

  async function endWalk() {
    setBusy(true); setError('');
    try {
      const response = await fetch(`${API_URL}/api/safe-walks/${walk.walk_id}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Safe-Walk-Token': sessionToken }, body: '{}' });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not end safe walk.');
      setWalk({ ...walk, status: 'CANCELLED' }); sessionStorage.removeItem('fuleSafeWalk');
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  }

  return <section className="safe-walk-panel" aria-labelledby="safe-walk-heading">
    <div className="safe-walk-heading"><span className="safe-walk-icon" aria-hidden="true">↗</span><div><h2 id="safe-walk-heading">Safe Walk Check-in</h2><p>Share your route with your trusted guardian network.</p></div></div>
    {!walk || ['CANCELLED', 'SOS_TRIGGERED', 'DURESS_ESCALATED'].includes(walk.status) ? <form className="safe-walk-form" onSubmit={startWalk}>
      <label>Destination<input required minLength="2" maxLength="160" value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="Home, campus or transit stop"/></label>
      <div className="safe-walk-fields"><label>ETA (minutes)<input type="number" min="1" max="720" value={eta} onChange={(event) => setEta(event.target.value)}/></label><label>Check-in every (minutes)<input type="number" min="1" max="60" value={interval} onChange={(event) => setInterval(event.target.value)}/></label></div>
      <div className="safe-walk-fields"><label>Safe PIN<input required inputMode="numeric" minLength="4" maxLength="8" type="password" value={safePin} onChange={(event) => setSafePin(event.target.value)} autoComplete="new-password"/></label><label>Duress PIN<input required inputMode="numeric" minLength="4" maxLength="8" type="password" value={duressPin} onChange={(event) => setDuressPin(event.target.value)} autoComplete="new-password"/></label></div>
      <button type="submit" disabled={busy || Boolean(activeIncident)}>{busy ? 'Starting…' : 'Start Safe Walk'}</button>
      <small>Entering the duress PIN records a normal check-in while silently requesting help. Do not use matching PINs.</small>
    </form> : <div className="safe-walk-active">
      <div><span>DESTINATION</span><strong>{walk.destination}</strong></div><div><span>STATUS</span><strong>{walk.status === 'AWAITING_CHECKIN' ? `Are you OK? · 00:${String(seconds).padStart(2, '0')}` : walk.status.replaceAll('_', ' ')}</strong></div>
      {walk.status === 'AWAITING_CHECKIN' && <form onSubmit={checkIn}><label className="visually-hidden" htmlFor="safe-walk-pin">Check-in PIN</label><input id="safe-walk-pin" inputMode="numeric" type="password" value={pin} onChange={(event) => setPin(event.target.value)} placeholder="Enter your PIN" required/><button disabled={busy}>I’m OK</button></form>}
      {walk.status === 'ACTIVE' && <button className="safe-walk-end" onClick={endWalk} disabled={busy}>End Safe Walk</button>}
      {walk.status === 'SOS_TRIGGERED' && <strong role="status">Guardians have been alerted.</strong>}
    </div>}
    {error && <p className="safe-walk-error" role="alert">{error}</p>}
    <p className="safe-walk-guidance">Guardians: observe, call for help, assist when safe. Never confront.</p>
  </section>;
}
