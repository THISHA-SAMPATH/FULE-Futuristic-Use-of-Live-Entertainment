import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { AlertTriangle, BellRing, Shield, X } from 'lucide-react';
import Header from './components/Header.jsx';
import Sidebar from './components/Sidebar.jsx';
import Hero from './components/Hero.jsx';
import AlertPanel from './components/AlertPanel.jsx';
import NetworkPulse from './components/NetworkPulse.jsx';
import MapCard from './components/MapCard.jsx';
import { SosButton, CancelToast } from './components/SosButton.jsx';
import { LiveStreamsSection, TopGuardiansSection } from './components/CommunitySections.jsx';
import { SafetyCategories, FeatureBanners } from './components/HomeSections.jsx';
import { DispatchTimeline, OperatorBrief } from './components/DispatchTimeline.jsx';
import TrustedContacts from './components/TrustedContacts.jsx';
import DemoTriggers from './components/DemoTriggers.jsx';
import SafeWalkPanel from './components/SafeWalkPanel.jsx';
import EvidenceRecorder from './components/EvidenceRecorder.jsx';
import useDemoFeed from './hooks/useDemoFeed.js';
import useLoudAlarm from './hooks/useLoudAlarm.js';
import { DEMO_NETWORK, DEMO_STREAMS } from './demo/seedData.js';
import { API_URL } from './config.js';
import { submitSos } from './sosFlow.js';
import { selectFeaturedStream } from './streamAccess.js';
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
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [nearbyAccepted, setNearbyAccepted] = useState(0);
  const [evidenceToken, setEvidenceToken] = useState('');
  const streamerSocketRef = useRef(null);
  const demoAlerts = useDemoFeed(DEMO_MODE);
  const active = Boolean(
    (activeIncident && ['PENDING_DISPATCH', 'DISPATCHING', 'ACKNOWLEDGED', 'ESCALATED'].includes(activeIncident.status))
    || incidents.some((item) => ['PENDING_DISPATCH', 'DISPATCHING', 'ACKNOWLEDGED', 'ESCALATED'].includes(item.status))
  );

  useEffect(() => {
    let live = true;
    fetch(`${API_URL}/api/twitch/session`, { credentials: 'include' }).then(async (response) => {
      if (!response.ok) throw new Error('Could not load Twitch session.');
      return response.json();
    }).then((data) => { if (live) setTwitchUser(data.user || null); }).catch((fetchError) => { if (live && !DEMO_MODE) setError(fetchError.message); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!activeIncident || !['PENDING_DISPATCH', 'DISPATCHING', 'ACKNOWLEDGED'].includes(activeIncident.status) || ['SENT', 'ACKNOWLEDGED'].includes(activeIncident.dispatch_record?.status)) { setRemaining(0); return undefined; }
    const update = () => setRemaining(Math.max(0, Math.ceil((Date.parse(activeIncident.created_at) + 60_000 - Date.now()) / 1000)));
    update(); const timer = window.setInterval(update, 250); return () => window.clearInterval(timer);
  }, [activeIncident]);

  const startAlarm = useLoudAlarm(Boolean(active), alarmEnabled);

  const registerStreamerIncident = useCallback((result) => {
    const socket = io(API_URL, { transports: ['websocket', 'polling'] }); streamerSocketRef.current?.disconnect(); streamerSocketRef.current = socket;
    socket.on('connect', () => socket.emit('register_streamer', { incident_id: result.incident.incident_id, streamer_id: result.streamer?.id || twitchUser?.id || 'demo-streamer', cancel_token: result.streamer_cancel_token }));
    socket.on('streamer_action_confirmed', ({ status }) => setActiveIncident((current) => current ? { ...current, status } : current));
    socket.on('streamer_action_rejected', ({ reason }) => setError(reason || 'The cancel window has ended.'));
    for (const event of ['incident_dispatch_ready', 'incident_acknowledged', 'incident_escalated', 'incident_updated', 'dispatch_queued', 'dispatch_sent', 'dispatch_acknowledged', 'dispatch_status_updated']) socket.on(event, setActiveIncident);
    socket.on('trusted_contacts_notified', () => setActiveIncident((current) => current ? { ...current, contacts_notified_at: new Date().toISOString(), dispatch_stage: 'CONTACTS' } : current));
    socket.on('nearby_guardians_update', (update) => setNearbyAccepted(update.accepted_count || 0));
    setNearbyAccepted(result.nearby_accepted_count || 0);
    setEvidenceToken(result.streamer_cancel_token || '');
    setActiveIncident(result.incident);
    setAlertsOpen(true);
  }, [twitchUser]);

  const handleSafeWalkEmergency = useCallback((incident, cancelToken) => {
    registerStreamerIncident({ incident, streamer: twitchUser || { id: 'demo-streamer' }, streamer_cancel_token: cancelToken });
  }, [registerStreamerIncident, twitchUser]);

  const triggerSos = useCallback(async (source = 'button', transcript = '') => {
    if (sending || active) return;
    setError(''); setSending(true);
    startAlarm();
    try {
      const result = await submitSos({ demoMode: DEMO_MODE, user: twitchUser, apiUrl: API_URL, source, transcript });
      registerStreamerIncident(result);
    } catch (requestError) { setError(requestError.message || 'SOS could not be sent.'); }
    finally { setSending(false); }
  }, [sending, active, twitchUser, startAlarm, registerStreamerIncident]);

  useEffect(() => {
    if (!alertsOpen) return undefined;
    document.querySelector('.alert-drawer .drawer-close')?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') { setAlertsOpen(false); return; }
      if (event.key !== 'Tab') return;
      const dialog = document.querySelector('.alert-drawer');
      const focusable = [...(dialog?.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])') || [])];
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); document.querySelector('.notification-button')?.focus(); };
  }, [alertsOpen]);

  const cancelSos = () => activeIncident && streamerSocketRef.current?.emit('cancel_sos', { incident_id: activeIncident.incident_id });
  const standDownSos = () => activeIncident && streamerSocketRef.current?.emit('stand_down', { incident_id: activeIncident.incident_id, reason: 'Streamer requested an explicit stand-down.' });
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

  const carouselStreams = DEMO_MODE ? DEMO_STREAMS : featuredStream ? [featuredStream] : [];
  return <div className="fule-shell gamey-shell" id="home" data-theme={active ? 'alert' : 'calm'}>
    <Header search={search} onSearch={setSearch} onTrigger={triggerSos} onOpenAlerts={() => setAlertsOpen(true)} alertsOpen={alertsOpen} sending={sending} active={Boolean(active)} user={twitchUser} unreadCount={activeCount} demoMode={DEMO_MODE} category={category} onCategorySelect={setCategory}/>
    <Sidebar connection={socketStatus} role={role} demoMode={DEMO_MODE} unreadCount={activeCount} incidents={[...incidents, ...demoAlerts, ...(activeIncident ? [activeIncident] : [])]} onTrigger={triggerSos} sending={sending} active={Boolean(active)} onOpenAlerts={() => setAlertsOpen(true)} onOpenInsights={() => { const drawer = document.querySelector('.insights-drawer'); if (drawer) { drawer.open = true; drawer.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }}/>
    <main className="dashboard-content">
      <div className="connection-strip"><span className="connection-state"><i className={DEMO_MODE || socketStatus === 'online' ? 'on' : ''}/>{DEMO_MODE ? 'Demo community live' : socketStatus === 'online' ? 'Safety network live' : socketStatus === 'offline' ? 'Reconnecting to network' : 'Connecting to network'}</span><span className="privacy-note"><Shield size={13}/>Precise location is shared only with verified guardians</span></div>
      {error && <div className="global-error" role="alert"><AlertTriangle size={16}/><span>{error}</span>{error.includes('Connect your Twitch account') && <a href={`${API_URL}/auth/twitch`}>Connect Twitch</a>}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
      <div className="main-dashboard-grid gamey-grid"><div className="feed-column gamey-feed">
        <Hero active={Boolean(active)} featuredStream={featuredStream} carouselStreams={carouselStreams} demoMode={DEMO_MODE} onOpenAlerts={() => setAlertsOpen(true)} onTrigger={triggerSos} sending={sending}/>
        <SafeWalkPanel demoMode={DEMO_MODE} streamer={twitchUser} activeIncident={activeIncident} onEmergency={handleSafeWalkEmergency}/>
        {activeIncident && <section className="active-response-card"><div className="active-response-heading"><span>LIVE RESPONSE STATUS</span><strong>{activeIncident.dispatch_record?.status || 'GUARDIANS ALERTED'}</strong></div><p className="nearby-response-count" aria-live="polite">{nearbyAccepted} nearby {nearbyAccepted === 1 ? 'guardian is' : 'guardians are'} coming</p><DispatchTimeline incident={activeIncident}/><OperatorBrief incident={activeIncident} privateLocation/><EvidenceRecorder incident={activeIncident} streamerToken={evidenceToken}/>{activeIncident.repeat_offender && <p className="repeat-offender-flag">Repeat false-alarm pattern flagged for review.</p>}</section>}
        <SafetyCategories selected={category} onSelect={setCategory}/>
        <FeatureBanners/>
        <LiveStreamsSection demoMode={DEMO_MODE} incidents={filteredIncidents} search={search} category={category}/>
        <TopGuardiansSection demoMode={DEMO_MODE} search={search}/>
        {DEMO_MODE && <details className="demo-drawer"><summary>Demo controls <span>Simulated triggers · no real contacts</span></summary><DemoTriggers onTrigger={triggerSos} disabled={Boolean(active)} sending={sending}/></details>}
        <TrustedContacts streamerId={twitchUser?.id || 'demo-streamer'} connected={Boolean(twitchUser)} demoMode={DEMO_MODE}/>
        <details className="insights-drawer"><summary>Demo &amp; Insights <span>Network pulse and anonymized map</span></summary><div className="insights-content"><NetworkPulse stats={networkStats} demoMode={DEMO_MODE}/><MapCard incidents={incidents} demoMode={DEMO_MODE}/></div></details>
        <section className="alarm-option-card" id="settings"><span className="alarm-option-icon"><BellRing size={17}/></span><span><strong>Loud emergency alarm</strong><small>Play an audible signal during your active SOS.</small></span><input type="checkbox" checked={alarmEnabled} onChange={(event) => setAlarmEnabled(event.target.checked)} aria-label="Toggle loud emergency alarm"/></section>
      </div></div>
      <footer className="page-footer"><span>FULE · Futuristic Use of Live Entertainment</span><span>Community safety, with consent and privacy</span></footer>
    </main>
    {alertsOpen && <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setAlertsOpen(false); }}><section className="alert-drawer" role="dialog" aria-modal="true" aria-label="Emergency alerts"><button className="drawer-close" onClick={() => setAlertsOpen(false)} aria-label="Close alerts"><X size={18}/></button><AlertPanel search={search} onIncidentsChange={setIncidents} onRoleChange={setRole} onStatus={setSocketStatus} demoMode={DEMO_MODE} demoAlerts={demoAlerts}/></section></div>}
    <SosButton onClick={triggerSos} sending={sending} active={Boolean(active)}/>
    <CancelToast incident={activeIncident} seconds={remaining} onCancel={cancelSos} onStandDown={standDownSos}/>
  </div>;
}
