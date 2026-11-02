import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { AlertTriangle, BellRing, Shield } from 'lucide-react';
import GuardianDashboard from './components/GuardianDashboard.jsx';
import TopHeader from './components/TopHeader.jsx';
import LeftSidebar from './components/LeftSidebar.jsx';
import StreamStage from './components/StreamStage.jsx';
import { CancelToast, MobileSOSButton } from './components/EmergencyAction.jsx';
import useLoudAlarm from './hooks/useLoudAlarm.js';
import { API_URL } from './config.js';
import './App.css';

export default function App() {
  const [search, setSearch] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [twitchUser, setTwitchUser] = useState(null);
  const [activeIncident, setActiveIncident] = useState(null);
  const [socketStatus, setSocketStatus] = useState('connecting');
  const [role, setRole] = useState('public');
  const [incidents, setIncidents] = useState([]);
  const [remaining, setRemaining] = useState(0);
  const [alarmEnabled, setAlarmEnabled] = useState(false);
  const streamerSocketRef = useRef(null);
  const active = activeIncident && ['PENDING_DISPATCH', 'DISPATCHING', 'ESCALATED'].includes(activeIncident.status);

  useEffect(() => {
    let live = true;
    fetch(`${API_URL}/api/twitch/session`, { credentials: 'include' }).then(async (response) => {
      if (!response.ok) throw new Error('Could not load Twitch session.');
      return response.json();
    }).then((data) => { if (live) setTwitchUser(data.user || null); }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (activeIncident?.status !== 'PENDING_DISPATCH') { setRemaining(0); return undefined; }
    const update = () => setRemaining(Math.max(0, Math.ceil((Date.parse(activeIncident.created_at) + 10_000 - Date.now()) / 1000)));
    update(); const timer = window.setInterval(update, 250); return () => window.clearInterval(timer);
  }, [activeIncident]);

  const triggerSos = useCallback(async () => {
    if (sending || active) return;
    if (!twitchUser) { setError('Connect your Twitch account before starting SOS.'); return; }
    if (!navigator.geolocation) { setError('Location access is unavailable in this browser.'); return; }
    setError(''); setSending(true);
    try {
      const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }));
      const response = await fetch(`${API_URL}/api/sos`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ streamer_id: twitchUser.id, location: { lat: position.coords.latitude, lng: position.coords.longitude }, module_type: 'FULE_PROTECT', source: 'button' }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'SOS could not be sent.');
      const socket = io(API_URL, { transports: ['websocket', 'polling'] }); streamerSocketRef.current?.disconnect(); streamerSocketRef.current = socket;
      socket.on('connect', () => socket.emit('register_streamer', { incident_id: result.incident.incident_id, streamer_id: twitchUser.id, cancel_token: result.streamer_cancel_token }));
      socket.on('streamer_action_confirmed', ({ status }) => { setActiveIncident((current) => current ? { ...current, status } : current); });
      socket.on('streamer_action_rejected', ({ reason }) => setError(reason || 'The cancel window has ended.'));
      socket.on('incident_dispatch_ready', setActiveIncident); socket.on('incident_acknowledged', setActiveIncident); socket.on('incident_escalated', setActiveIncident);
      setActiveIncident(result.incident);
    } catch (e) { setError(e.code === 1 ? 'Location permission is required to send an SOS.' : e.message || 'SOS could not be sent.'); }
    finally { setSending(false); }
  }, [sending, active, twitchUser]);

  const cancelSos = () => activeIncident && streamerSocketRef.current?.emit('cancel_sos', { incident_id: activeIncident.incident_id });
  const filteredIncidents = useMemo(() => {
    const query = search.trim().toLowerCase(); if (!query) return incidents;
    return incidents.filter((item) => [item.summary, item.location?.address, item.status, item.threat_level].some((value) => String(value || '').toLowerCase().includes(query)));
  }, [incidents, search]);
  const latestFeed = filteredIncidents.find((item) => item.stream_url) || (role === 'guardian' ? incidents.find((item) => item.stream_url) : null);
  useLoudAlarm(Boolean(active), alarmEnabled);

  return <div className="fule-shell" id="home">
    <TopHeader search={search} onSearch={setSearch} onTrigger={triggerSos} sending={sending} active={Boolean(active)} user={twitchUser}/>
    <div className="app-frame"><LeftSidebar connection={socketStatus} role={role}/><main className="dashboard-content">
      <div className="page-heading"><div><p className="eyebrow">FUTURISTIC USE OF LIVE ENTERTAINMENT</p><h2>Safety dashboard</h2></div><div className={`socket-status ${socketStatus}`}><i/>{socketStatus === 'online' ? 'LIVE CONNECTION' : socketStatus === 'offline' ? 'RECONNECTING' : 'CONNECTING'}</div></div>
      {error && <div className="global-error" role="alert"><AlertTriangle size={16}/><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
      <div className="dashboard-grid"><div className="center-column"><StreamStage streamUrl={latestFeed?.stream_url || (role === 'guardian' ? activeIncident?.stream_url : twitchUser ? `https://www.twitch.tv/${twitchUser.login}` : null)} active={Boolean(active)}/>
        <section className="connection-card"><div className="connection-card-icon"><Shield size={18}/></div><div><strong>{twitchUser ? `Connected as ${twitchUser.login}` : 'Connect your Twitch channel'}</strong><span>{twitchUser ? 'Your streamer session is ready for an authenticated SOS.' : 'Twitch sign-in is needed to start a verified live SOS.'}</span></div>{!twitchUser && <a href={`${API_URL}/auth/twitch`}>CONNECT</a>}</section>
        <label className="alarm-toggle"><span className="alarm-toggle-icon"><BellRing size={16}/></span><span><strong>Loud alarm</strong><small>Play an audible alert while an SOS is active</small></span><input type="checkbox" checked={alarmEnabled} onChange={(e) => setAlarmEnabled(e.target.checked)} aria-label="Toggle loud alarm"/></label>
      </div><GuardianDashboard search={search} onIncidentsChange={setIncidents} onRoleChange={setRole} onStatus={setSocketStatus}/></div>
    </main></div>
    <MobileSOSButton onTrigger={triggerSos} sending={sending} active={Boolean(active)}/>
    <CancelToast incident={activeIncident} seconds={remaining} onCancel={cancelSos} error={error}/>
  </div>;
}
