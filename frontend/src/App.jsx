import { useState } from 'react';
import {
  Activity, BadgeCheck, BookOpenCheck, ChevronDown, ClipboardList, Crosshair,
  HeartPulse, House, MapPinned, Radio, Search, Shield, ShieldAlert, Siren
} from 'lucide-react';
import GuardianDashboard from './components/GuardianDashboard.jsx';
import './App.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const TWITCH_CHANNEL = import.meta.env.VITE_TWITCH_CHANNEL || 'twitch';
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

  async function triggerSos() {
    if (sending) return;
    setSending(true);
    setStatus('Sending emergency alert…');
    const location = gpsEnabled
      ? { latitude: 12.9716, longitude: 77.5946 }
      : { latitude: 37.7694, longitude: -122.4862 };
    try {
      const response = await fetch(`${API_URL}/api/sos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...location,
          victimStatus: 'SOS triggered by streamer; requesting immediate guardian response.',
          liveStreamUrl: `https://www.twitch.tv/${TWITCH_CHANNEL}`,
          audioTranscript: transcript,
          chatLog
        })
      });
      if (!response.ok) throw new Error('Alert could not be sent');
      setSosActive(true);
      setStatus('Alert sent · guardians notified');
    } catch (error) {
      setStatus(`${error.message}. Is the backend running?`);
    } finally {
      setSending(false);
    }
  }

  const playerUrl = `https://player.twitch.tv/?channel=${encodeURIComponent(TWITCH_CHANNEL)}&parent=localhost&muted=true`;

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
          <button className="start-live-button" onClick={triggerSos} disabled={sending}>
            <span className="start-live-dot" />
            {sending ? 'SENDING ALERT…' : 'START LIVE SOS STREAM'}
          </button>
          <button className="profile-chip" aria-label="Streamer profile menu">
            <span className="avatar">A</span><span className="profile-name">Ari Morgan</span><ChevronDown size={14} />
          </button>
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
                  <div className="stage-title"><span className={`stage-live-dot ${sosActive ? 'pulsing' : ''}`} /><div><strong>{sosActive ? 'LIVE EMERGENCY BROADCAST' : 'FEATURED COMMUNITY STREAM'}</strong><span>FULE Protect <span className="stage-separator">/</span> @{TWITCH_CHANNEL}</span></div></div>
                  <div className="stage-badges"><span className="secure-badge"><Shield size={13} /> {sosActive ? 'SOS ACTIVE' : 'GUARDIAN MONITORED'}</span><span className="viewer-badge"><span /> 1.2K</span></div>
                </div>
                <div className="player-stage">
                  <iframe src={playerUrl} title={`${TWITCH_CHANNEL} Twitch live stream`} allowFullScreen allow="autoplay; fullscreen" />
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

      <div className="panic-banner" role="region" aria-label="Emergency SOS action">
        <div className="panic-copy"><span className="panic-shield"><ShieldAlert size={19} /></span><span><strong>Need help right now?</strong><small>{status} · sends simulated coordinates to connected guardians</small></span></div>
        <button className="panic-button" onClick={triggerSos} disabled={sending}><Siren size={18} />{sending ? 'SENDING SOS…' : 'TRIGGER SOS NOW'}</button>
      </div>
    </div>
  );
}
