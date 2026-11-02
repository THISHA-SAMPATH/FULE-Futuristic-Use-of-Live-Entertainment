import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import {
  Activity, BadgeCheck, BookOpenCheck, ChevronDown, ClipboardList, Crosshair,
  HeartPulse, House, MapPinned, Radio, Search, Shield, ShieldAlert, Siren
} from 'lucide-react';
import GuardianDashboard from './components/GuardianDashboard.jsx';
import './App.css';
import './panic.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const TWITCH_CHANNEL = (import.meta.env.VITE_TWITCH_CHANNEL || '').trim();
const FRONTEND_DEMO_MODE = import.meta.env.VITE_DEMO_MODE !== 'false';
const CATEGORIES = [
  'FULE Protect: Women Safety',
  'FULE Account: Officer Decorum',
  'FULE Respond: Hospital Emergency',
  'Verified Responders',
  'Civic Logs'
];
const NAVIGATION = [
  { label: 'Home', icon: House },
  { label: 'Active Guardians', icon: Shield },
  { label: 'SOS Feeds', icon: Radio },
  { label: 'Emergency Logs', icon: ClipboardList },
  { label: 'Community Dispatch', icon: Siren }
];
const CHANNELS = [
  "Women's Safety Network",
  'Civic Decorum Desk',
  'Emergency Medical Response'
];

export default function App() {
  const [gpsEnabled, setGpsEnabled] = useState(true);
  const [sending, setSending] = useState(false);
  const [sosActive, setSosActive] = useState(false);
  const [status, setStatus] = useState('Ready to protect');
  const [transcript, setTranscript] = useState('I do not feel safe. Please help and contact a moderator now.');
  const [chatLog, setChatLog] = useState('');
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState(CATEGORIES[0]);
  const [activeNavigation, setActiveNavigation] = useState('Home');
  const [streamerId] = useState(() => {
    const existing = sessionStorage.getItem('fuleStreamerId');
    if (existing) return existing;
    const generated = `streamer-${crypto.randomUUID()}`;
    sessionStorage.setItem('fuleStreamerId', generated);
    return generated;
  });
  const [activeIncident, setActiveIncident] = useState(null);
  const [twitchUser, setTwitchUser] = useState(null);
  const streamerSocketRef = useRef(null);
  const incidentInProgress = activeIncident && ['PENDING_DISPATCH', 'DISPATCHING', 'ESCALATED'].includes(activeIncident.status);

  useEffect(() => { fetch(`${API_URL}/api/twitch/session`, { credentials: 'include' }).then((r) => r.json()).then((data) => setTwitchUser(data.user)).catch(() => {}); }, []);
  useEffect(() => {
    if (!twitchUser) return;
    const location = gpsEnabled ? { lat: 12.9716, lng: 77.5946 } : { lat: 37.7694, lng: -122.4862 };
    fetch(`${API_URL}/api/streamer/location`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location }) }).catch(() => {});
  }, [twitchUser, gpsEnabled]);

  async function triggerSos() {
    if (sending || incidentInProgress) return;
    setSending(true);
    setStatus('Sending emergency alert…');
    const location = gpsEnabled
      ? { lat: 12.9716, lng: 77.5946 }
      : { lat: 37.7694, lng: -122.4862 };
    try {
      const response = await fetch(`${API_URL}/api/sos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          streamer_id: twitchUser?.id || streamerId,
          location,
          module_type: 'FULE_PROTECT',
          audio_transcript_snippet: [transcript, chatLog && `Twitch chat: ${chatLog}`].filter(Boolean).join('\n'),
          source: 'button',
        }), credentials: 'include'
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Alert could not be sent');
      streamerSocketRef.current?.disconnect();
      const streamerSocket = io(API_URL, { transports: ['websocket', 'polling'] });
      streamerSocketRef.current = streamerSocket;
      streamerSocket.on('connect', () => streamerSocket.emit('register_streamer', {
        incident_id: result.incident.incident_id,
        streamer_id: streamerId,
        cancel_token: result.streamer_cancel_token
      }));
      streamerSocket.on('streamer_registration_failed', () => setStatus('SOS started; cancel controls could not connect.'));
      streamerSocket.on('streamer_action_confirmed', ({ status: nextStatus }) => {
        setActiveIncident((current) => current ? { ...current, status: nextStatus } : current);
        setSosActive(false);
        setStatus(nextStatus === 'FALSE_ALARM' ? 'Marked as a false alarm.' : 'SOS cancelled during the grace window.');
      });
      streamerSocket.on('streamer_action_rejected', ({ reason }) => {
        setActiveIncident((current) => current ? { ...current, status: 'DISPATCHING' } : current);
        setStatus(reason || 'Dispatch grace window ended.');
      });
      streamerSocket.on('incident_dispatch_ready', (incident) => {
        setActiveIncident(incident);
        setStatus('Dispatch grace window ended · guardians can acknowledge.');
      });
      streamerSocket.on('incident_acknowledged', (incident) => {
        setActiveIncident(incident);
        setSosActive(false);
        setStatus(`Guardian ${incident.acknowledged_by} acknowledged the incident.`);
      });
      streamerSocket.on('incident_escalated', (incident) => {
        setActiveIncident(incident);
        setStatus(incident.escalation_flag || 'Incident escalated for emergency follow-up.');
      });
      setActiveIncident(result.incident);
      setSosActive(true);
      setStatus('SOS sent · 10-second cancel window is open');
    } catch (error) {
      setStatus(`${error.message}. Is the backend running?`);
    } finally {
      setSending(false);
    }
  }

  function cancelSos(eventName) {
    if (!activeIncident || activeIncident.status !== 'PENDING_DISPATCH') return;
    streamerSocketRef.current?.emit(eventName, { incident_id: activeIncident.incident_id });
  }

  async function simulateTwitch(action) {
    setSending(true);
    try {
      const response = await fetch(`${API_URL}/api/demo/twitch-trigger`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, streamer_id: streamerId, location: gpsEnabled ? { lat: 12.9716, lng: 77.5946 } : { lat: 37.7694, lng: -122.4862 } }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (result.incident) { setActiveIncident(result.incident); setSosActive(true); setStatus(`Demo ${result.incident.source} SOS received`); }
      else setStatus(result.ok ? 'Demo !safe trigger cleared the active SOS.' : 'No active SOS to clear.');
    } catch (error) { setStatus(error.message || 'Demo trigger failed.'); }
    finally { setSending(false); }
  }

  const activeChannel = twitchUser?.login || TWITCH_CHANNEL;
  const playerUrl = activeChannel && !FRONTEND_DEMO_MODE
    ? `https://player.twitch.tv/?channel=${encodeURIComponent(activeChannel)}&parent=${encodeURIComponent(window.location.hostname)}&muted=true`
    : null;

  return (
    <div className="fule-app">
      <header className="topbar">
        <a className="brand" href="#home" aria-label="FULE home">
          <span className="brand-mark">F</span>
          <span className="brand-word">FULE<span>PROTECT</span></span>
        </a>
        <label className="global-search">
          <Search size={16} aria-hidden="true" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search streams, responders, logs" aria-label="Search FULE" />
          <kbd>/</kbd>
        </label>
        <div className="top-actions">
          <button className="start-live-button" onClick={triggerSos} disabled={sending || incidentInProgress}>
            <span className="start-live-dot" />
            {sending ? 'SENDING ALERT…' : 'START LIVE SOS STREAM'}
          </button>
          {twitchUser ? <button className="profile-chip" onClick={async () => { await fetch(`${API_URL}/auth/twitch/logout`, { method: 'POST', credentials: 'include' }); setTwitchUser(null); }}><span className="avatar">{twitchUser.login[0]?.toUpperCase()}</span><span className="profile-name">{twitchUser.login}</span><ChevronDown size={14} /></button> : <a className="profile-chip" href={`${API_URL}/auth/twitch`}><span className="avatar">T</span><span className="profile-name">Connect Twitch</span><ChevronDown size={14} /></a>}
        </div>
      </header>

      <div className="app-layout">
        <aside className="sidebar" aria-label="Main navigation">
          <div className="sidebar-top">
            <div className="sidebar-label">WORKSPACE</div>
            <nav className="primary-nav">
              {NAVIGATION.map(({ label, icon: Icon }) => (
                <button key={label} className={`nav-link ${activeNavigation === label ? 'selected' : ''}`} onClick={() => setActiveNavigation(label)}>
                  <Icon size={17} strokeWidth={1.8} /><span>{label}</span>
                  {label === 'SOS Feeds' && <span className="nav-count">3</span>}
                </button>
              ))}
            </nav>
            <div className="channel-heading"><span className="sidebar-label">COMMUNITY CHANNELS</span><button aria-label="Add community channel">+</button></div>
            <div className="channel-list">
              {CHANNELS.map((channel) => (
                <button className="channel-link" key={channel} onClick={() => setActiveNavigation(channel)}>
                  <span className="channel-avatar"><BadgeCheck size={13} /></span>
                  <span className="channel-name">{channel}</span><span className="online-dot" />
                </button>
              ))}
            </div>
          </div>
          <div className="sidebar-bottom">
            <div className="network-card"><span className="network-icon"><HeartPulse size={16} /></span><div><strong>Guardian network</strong><span><i /> 128 responders online</span></div></div>
            <div className="sidebar-version"><span>FULE COMMUNITY</span><span>v0.1 DEMO</span></div>
          </div>
        </aside>

        <main className="workspace" id="home">
          <div className="workspace-heading">
            <div><div className="workspace-kicker"><Activity size={14} /> LIVE SAFETY NETWORK</div><h1>Community dashboard</h1></div>
            <div className="network-live"><i /> NETWORK LIVE</div>
          </div>

          <section className="category-section" aria-label="FULE categories">
            <div className="section-overline">EXPLORE FULE NETWORK</div>
            <div className="category-row">
              {CATEGORIES.map((category) => (
                <button key={category} className={`category-chip ${activeCategory === category ? 'active' : ''}`} onClick={() => setActiveCategory(category)}>{category}</button>
              ))}
            </div>
          </section>

          <div className="content-grid">
            <div className="main-column">
              <section className={`stage-card ${sosActive ? 'is-live' : ''}`} aria-label="Featured Twitch stream">
                <div className="stage-toolbar">
                  <div className="stage-title"><span className={`stage-live-dot ${sosActive ? 'pulsing' : ''}`} /><div><strong>{sosActive ? 'LIVE EMERGENCY BROADCAST' : 'FEATURED COMMUNITY STREAM'}</strong><span>FULE Protect <span className="stage-separator">/</span> {TWITCH_CHANNEL ? `@${TWITCH_CHANNEL}` : 'offline demo preview'}</span></div></div>
                  <div className="stage-badges"><span className="secure-badge"><Shield size={13} /> {sosActive ? 'SOS ACTIVE' : 'GUARDIAN MONITORED'}</span><span className="viewer-badge"><span /> 1.2K</span></div>
                </div>
                <div className="player-stage">
                  {playerUrl ? <iframe src={playerUrl} title={`${TWITCH_CHANNEL} Twitch live stream`} allowFullScreen allow="autoplay; fullscreen" /> : <div className="offline-player"><div className="offline-player-mark"><Shield size={25} /></div><strong>FULE LIVE SAFETY PREVIEW</strong><span>Offline demo mode · no Twitch connection required</span><div className="offline-player-bars"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div></div>}
                  <div className="stage-vignette" />
                  {sosActive && <div className="broadcast-banner"><span className="banner-pulse" /> LIVE EMERGENCY BROADCAST <span>GUARDIANS ALERTED</span></div>}
                  <div className="gps-telemetry"><MapPinned size={15} /><span><strong>GPS TELEMETRY</strong><small>{gpsEnabled ? '12.9716, 77.5946 · Bengaluru' : '37.7694, −122.4862 · San Francisco'}</small></span><span className="telemetry-target"><Crosshair size={17} /></span></div>
                  <div className="stage-corner-status"><span className="online-dot" /> STREAM LINK ACTIVE</div>
                </div>
                <div className="stage-footer">
                  <div className="stream-identity"><span className="stream-avatar">F</span><span><strong>FULE Protect Community</strong><small>{sosActive ? 'Incident broadcast is active' : 'Community safety · Live preview'}</small></span></div>
                  <label className="gps-control"><Crosshair size={14} /><span>GPS simulator</span><button type="button" role="switch" aria-checked={gpsEnabled} aria-label="Toggle GPS simulator" className={`toggle ${gpsEnabled ? 'on' : ''}`} onClick={() => setGpsEnabled((value) => !value)}><i /></button></label>
                </div>
              </section>

              <section className="featured-row">
                <div><div className="section-overline">CURRENT VIEW</div><h2>{activeCategory}</h2><p>Live community tools for safer, more accountable streams.</p></div>
                <div className="featured-stats"><span><strong>03</strong><small>ACTIVE INCIDENTS</small></span><span><strong>128</strong><small>GUARDIANS ONLINE</small></span></div>
              </section>

              <details className="context-editor">
                <summary><BookOpenCheck size={15} /> EDIT SIMULATED INCIDENT CONTEXT</summary>
                <div className="context-fields">
                  <label>15-second audio transcript<textarea value={transcript} onChange={(event) => setTranscript(event.target.value)} maxLength={4000} /></label>
                  <label>Recent Twitch chat<textarea value={chatLog} onChange={(event) => setChatLog(event.target.value)} maxLength={4000} placeholder="Paste simulated chat messages here" /></label>
                </div>
              </details>
            </div>

            <GuardianDashboard search={search} />
          </div>

          <footer className="workspace-footer"><span>FULE <b>·</b> FUTURISTIC USE OF LIVE ENTERTAINMENT</span><span>COMMUNITY-POWERED SAFETY <i /></span></footer>
        </main>
      </div>

      {FRONTEND_DEMO_MODE && <div className="demo-trigger-toolbar" aria-label="Demo Twitch trigger simulator"><span>DEMO TRIGGERS</span><button onClick={() => simulateTwitch('chat_sos')}>Simulate !sos</button><button onClick={() => simulateTwitch('redeem_sos')}>Simulate Silent SOS redeem</button><button onClick={() => simulateTwitch('chat_safe')}>Simulate !safe</button></div>}

      <div className={`panic-banner ${activeIncident?.status === 'PENDING_DISPATCH' ? 'with-cancel' : ''}`} role="region" aria-label="Emergency SOS action">
        <div className="panic-copy"><span className="panic-shield"><ShieldAlert size={19} /></span><span><strong>Need help right now?</strong><small>{status} · 10-second grace before dispatch readiness</small></span></div>
        <div className="panic-actions">
          {activeIncident?.status === 'PENDING_DISPATCH' && <><button className="cancel-sos-button" onClick={() => cancelSos('false_alarm')}>FALSE ALARM</button><button className="cancel-sos-button" onClick={() => cancelSos('cancel_sos')}>CANCEL SOS</button></>}
          <button className="panic-button" onClick={triggerSos} disabled={sending || incidentInProgress}><Siren size={18} />{sending ? 'SENDING SOS…' : incidentInProgress ? 'SOS IN PROGRESS' : 'TRIGGER SOS NOW'}</button>
        </div>
      </div>
    </div>
  );
}
