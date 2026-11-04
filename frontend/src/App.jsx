import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { AlertTriangle, BellRing, Shield } from 'lucide-react';
import Header from './components/Header.jsx';
import Sidebar from './components/Sidebar.jsx';
import Hero from './components/Hero.jsx';
import AlertPanel from './components/AlertPanel.jsx';
import NetworkPulse from './components/NetworkPulse.jsx';
import MapCard from './components/MapCard.jsx';
import { SosButton, CancelToast } from './components/SosButton.jsx';
import { CategoryChips, LiveStreamsSection, TopGuardiansSection } from './components/CommunitySections.jsx';
import DemoTriggers from './components/DemoTriggers.jsx';
import useDemoFeed from './hooks/useDemoFeed.js';
import useLoudAlarm from './hooks/useLoudAlarm.js';
import { DEMO_NETWORK, DEMO_STREAMS } from './demo/seedData.js';
import { API_URL } from './config.js';
import { submitSos } from './sosFlow.js';
import { selectFeaturedStream } from './streamAccess.js';
import './App.css';

const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

export default function App() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('Women’s Safety');
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
  const demoAlerts = useDemoFeed(DEMO_MODE);
  const active = activeIncident && ['PENDING_DISPATCH', 'DISPATCHING', 'ESCALATED'].includes(activeIncident.status);

  useEffect(() => {
    let live = true;
    fetch(`${API_URL}/api/twitch/session`, { credentials: 'include' }).then(async (response) => {
      if (!response.ok) throw new Error('Could not load Twitch session.');
      return response.json();
    }).then((data) => { if (live) setTwitchUser(data.user || null); }).catch((fetchError) => { if (live && !DEMO_MODE) setError(fetchError.message); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (activeIncident?.status !== 'PENDING_DISPATCH') { setRemaining(0); return undefined; }
    const update = () => setRemaining(Math.max(0, Math.ceil((Date.parse(activeIncident.created_at) + 10_000 - Date.now()) / 1000)));
    update(); const timer = window.setInterval(update, 250); return () => window.clearInterval(timer);
  }, [activeIncident]);

  const startAlarm = useLoudAlarm(Boolean(active), alarmEnabled);

  const triggerSos = useCallback(async (source = 'button', transcript = '') => {
    if (sending || active) return;
    setError(''); setSending(true);
    startAlarm();
    try {
      const result = await submitSos({ demoMode: DEMO_MODE, user: twitchUser, apiUrl: API_URL, source, transcript });
      const socket = io(API_URL, { transports: ['websocket', 'polling'] }); streamerSocketRef.current?.disconnect(); streamerSocketRef.current = socket;
      socket.on('connect', () => socket.emit('register_streamer', { incident_id: result.incident.incident_id, streamer_id: result.streamer.id, cancel_token: result.streamer_cancel_token }));
      socket.on('streamer_action_confirmed', ({ status }) => setActiveIncident((current) => current ? { ...current, status } : current));
      socket.on('streamer_action_rejected', ({ reason }) => setError(reason || 'The cancel window has ended.'));
      socket.on('incident_dispatch_ready', setActiveIncident); socket.on('incident_acknowledged', setActiveIncident); socket.on('incident_escalated', setActiveIncident); socket.on('incident_updated', setActiveIncident);
      setActiveIncident(result.incident);
    } catch (requestError) { setError(requestError.message || 'SOS could not be sent.'); }
    finally { setSending(false); }
  }, [sending, active, twitchUser, startAlarm]);

  const cancelSos = () => activeIncident && streamerSocketRef.current?.emit('cancel_sos', { incident_id: activeIncident.incident_id });
  const filteredIncidents = useMemo(() => {
    const query = search.trim().toLowerCase(); if (!query) return incidents;
    return incidents.filter((item) => [item.summary, item.location?.address, item.status, item.threat_level].some((value) => String(value || '').toLowerCase().includes(query)));
  }, [incidents, search]);
  const activeCount = [...incidents, ...demoAlerts].filter((item) => ['PENDING_DISPATCH', 'DISPATCHING', 'ESCALATED'].includes(item.status)).length;
  const featuredStream = selectFeaturedStream({ demoMode: DEMO_MODE, role, incidents, demoStream: DEMO_STREAMS[0] });
  const networkStats = DEMO_MODE ? DEMO_NETWORK : null;

  function joinAsGuardian() {
    document.getElementById('alerts')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => {
      const invite = document.getElementById('guardian-invite');
      if (invite) invite.focus();
      else document.querySelector('.guardian-auth-button')?.click();
      window.setTimeout(() => document.getElementById('guardian-invite')?.focus(), 80);
    }, 350);
  }

  return <div className="fule-shell" id="home">
    <Header search={search} onSearch={setSearch} onTrigger={triggerSos} sending={sending} active={Boolean(active)} user={twitchUser} unreadCount={activeCount} demoMode={DEMO_MODE}/>
    <Sidebar connection={socketStatus} role={role} demoMode={DEMO_MODE}/>
    <main className="dashboard-content">
      <div className="connection-strip"><span className="connection-state"><i className={DEMO_MODE || socketStatus === 'online' ? 'on' : ''}/>{DEMO_MODE ? 'DEMO COMMUNITY LIVE' : socketStatus === 'online' ? 'SAFETY NETWORK LIVE' : socketStatus === 'offline' ? 'RECONNECTING TO NETWORK' : 'CONNECTING TO NETWORK'}</span><span className="privacy-note"><Shield size={13}/>Precise location is shared only with verified guardians</span></div>
      {error && <div className="global-error" role="alert"><AlertTriangle size={16}/><span>{error}</span>{error.includes('Connect your Twitch account') && <a href={`${API_URL}/auth/twitch`}>Connect Twitch</a>}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
      <div className="main-dashboard-grid">
        <div className="feed-column">
          <Hero onTrigger={triggerSos} sending={sending} active={Boolean(active)} featuredStream={featuredStream} demoMode={DEMO_MODE} onJoinGuardian={joinAsGuardian}/>
          {DEMO_MODE && <DemoTriggers onTrigger={triggerSos} disabled={Boolean(active)} sending={sending}/>}
          <CategoryChips selected={category} onSelect={setCategory}/>
          <LiveStreamsSection demoMode={DEMO_MODE} incidents={filteredIncidents} search={search} category={category}/>
          <TopGuardiansSection demoMode={DEMO_MODE} search={search}/>
          <MapCard incidents={incidents} demoMode={DEMO_MODE}/>
          <section className="alarm-option-card" id="settings"><span className="alarm-option-icon"><BellRing size={17}/></span><span><strong>Loud emergency alarm</strong><small>Play an audible signal during your active SOS.</small></span><input type="checkbox" checked={alarmEnabled} onChange={(event) => setAlarmEnabled(event.target.checked)} aria-label="Toggle loud emergency alarm"/></section>
        </div>
        <aside className="right-column"><AlertPanel search={search} onIncidentsChange={setIncidents} onRoleChange={setRole} onStatus={setSocketStatus} demoMode={DEMO_MODE} demoAlerts={demoAlerts}/><NetworkPulse stats={networkStats} demoMode={DEMO_MODE}/></aside>
      </div>
      <footer className="page-footer"><span>FULE · FUTURISTIC USE OF LIVE ENTERTAINMENT</span><span>COMMUNITY SAFETY, WITH CONSENT AND PRIVACY</span></footer>
    </main>
    <SosButton onClick={triggerSos} sending={sending} active={Boolean(active)}/>
    <CancelToast incident={activeIncident} seconds={remaining} onCancel={cancelSos}/>
  </div>;
}
