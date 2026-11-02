import { useState } from 'react';
import { Activity, ArrowUpRight, Crosshair, HeartHandshake, Shield, Siren } from 'lucide-react';
import GuardianDashboard from './components/GuardianDashboard.jsx';

const DEMO_STREAM = 'https://player.twitch.tv/?channel=twitch&parent=localhost&muted=true';

export default function App() {
  const [gpsEnabled, setGpsEnabled] = useState(true);
  const [status, setStatus] = useState('Ready to protect');
  const [sending, setSending] = useState(false);

  async function triggerSos() {
    setSending(true);
    setStatus('Sending emergency alert…');
    const location = gpsEnabled
      ? { latitude: 37.7694, longitude: -122.4862 }
      : { latitude: 40.7128, longitude: -74.006 };
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:4000'}/api/sos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...location,
          victimStatus: 'SOS triggered by streamer; requesting immediate guardian response.',
          liveStreamUrl: 'https://www.twitch.tv/twitch',
          transcript: 'I do not feel safe. Please help and contact a moderator now.'
        })
      });
      if (!response.ok) throw new Error('Alert could not be sent');
      setStatus('Alert sent • guardians notified');
    } catch (error) {
      setStatus(`${error.message}. Is the backend running?`);
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="FULE home"><span className="brand-mark">F</span><span>FULE<span className="brand-sub">PROTECT</span></span></a>
        <div className="top-status"><span className="pulse-dot" /> COMMUNITY SAFETY NETWORK <span className="divider">/</span> <span className="muted">LIVE</span></div>
        <button className="profile-chip"><span className="avatar">A</span><span>Streamer</span></button>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <div className="eyebrow"><Shield size={14} /> YOUR SAFETY, BACKED BY COMMUNITY</div>
          <h1>Go live.<br /><span>Stay protected.</span></h1>
          <p>One tap brings your trusted community into action. Your guardians are standing by.</p>
          <div className="sos-area">
            <button className="sos-button" onClick={triggerSos} disabled={sending}>
              <Siren size={22} strokeWidth={2.3} />
              <span>{sending ? 'SENDING ALERT…' : 'TRIGGER SOS EMERGENCY'}</span>
              <span className="sos-arrow"><ArrowUpRight size={19} /></span>
            </button>
            <div className="sos-caption"><span className="key-hint">SOS</span> Sends your location to active guardians <span className="caption-sep">•</span> {status}</div>
          </div>
          <div className="gps-card">
            <div className="gps-icon"><Crosshair size={18} /></div>
            <div className="gps-copy"><strong>GPS simulator</strong><span>{gpsEnabled ? 'San Francisco, CA · 37.7694, −122.4862' : 'Fallback demo location · New York, NY'}</span></div>
            <button className={`toggle ${gpsEnabled ? 'on' : ''}`} role="switch" aria-checked={gpsEnabled} aria-label="Toggle GPS simulator" onClick={() => setGpsEnabled((value) => !value)}><span /></button>
          </div>
        </div>
        <div className="stream-card">
          <div className="stream-heading"><div><span className="live-tag"><i /> LIVE PREVIEW</span><h2>Your stream</h2></div><span className="stream-lock"><Shield size={14} /> Protected</span></div>
          <div className="player-wrap"><iframe src={DEMO_STREAM} title="Twitch live stream preview" allowFullScreen allow="autoplay; fullscreen" /><div className="player-overlay"><span className="play-ring">▶</span><span>Demo stream preview</span></div></div>
          <div className="stream-foot"><span><span className="viewers-dot" /> Guardians can respond</span><span>TWITCH <ArrowUpRight size={13} /></span></div>
        </div>
      </section>

      <section className="trust-row"><div className="trust-icon"><HeartHandshake size={19} /></div><div><strong>You are not alone out there.</strong><span>Your chosen guardians can see an alert and coordinate a response in real time.</span></div><div className="trust-stat"><b>24/7</b><span>community care</span></div><div className="trust-stat"><b><Activity size={17} /> LIVE</b><span>response network</span></div></section>

      <GuardianDashboard />
      <footer>FULE <span>·</span> FUTURISTIC USE OF LIVE ENTERTAINMENT <span className="footer-right">DEMO EXPERIENCE <span className="footer-dot" /></span></footer>
    </main>
  );
}
