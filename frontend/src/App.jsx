import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { AlertTriangle, ArrowRight, BellRing, Shield, ShieldCheck, UsersRound, X } from 'lucide-react';
import Header from './components/Header.jsx';
import Sidebar from './components/Sidebar.jsx';
import Hero from './components/Hero.jsx';
import AlertPanel from './components/AlertPanel.jsx';
import NetworkPulse from './components/NetworkPulse.jsx';
import MapCard from './components/MapCard.jsx';
import { SosButton, CancelToast } from './components/SosButton.jsx';
import { LiveStreamsSection, TopGuardiansSection } from './components/CommunitySections.jsx';
import { CategoryChips } from './components/CommunitySections.jsx';
import { DispatchTimeline, OperatorBrief } from './components/DispatchTimeline.jsx';
import TrustedContacts from './components/TrustedContacts.jsx';
import DemoTriggers from './components/DemoTriggers.jsx';
import SafeWalkPanel from './components/SafeWalkPanel.jsx';
import EvidenceRecorder from './components/EvidenceRecorder.jsx';
import IncidentLiveStream from './components/IncidentLiveStream.jsx';
import StandaloneAccount from './components/StandaloneAccount.jsx';
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
  const [twitchEnabled, setTwitchEnabled] = useState(false);
  const [fuleAccount, setFuleAccount] = useState(() => {
    try { const saved = JSON.parse(sessionStorage.getItem('fuleAccount') || 'null'); const accessToken = sessionStorage.getItem('fuleAccessToken'); return saved && accessToken ? { ...saved, access_token: accessToken } : null; }
    catch { return null; }
  });
  const streamUser = twitchUser || fuleAccount;
  const [activeIncident, setActiveIncident] = useState(null);
  const [socketStatus, setSocketStatus] = useState('connecting');
  const [role, setRole] = useState('public');
  const [incidents, setIncidents] = useState([]);
  const [remaining, setRemaining] = useState(0);
  const [alarmEnabled, setAlarmEnabled] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [nearbyAccepted, setNearbyAccepted] = useState(0);
  const [evidenceToken, setEvidenceToken] = useState('');
  const [trustedStreamAccess, setTrustedStreamAccess] = useState(null);
  const [streamRequested, setStreamRequested] = useState(false);
  const [motionReady, setMotionReady] = useState(false);
  const streamerSocketRef = useRef(null);
  const liveStreamRef = useRef(null);
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
    }).then((data) => { if (live) { setTwitchUser(data.user || null); setTwitchEnabled(Boolean(data.integration_enabled)); } }).catch((fetchError) => { if (live && !DEMO_MODE) setError(fetchError.message); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const incidentId = params.get('fuleIncident'); const token = fragment.get('fuleStream');
    if (!incidentId || !token) return;
    setTrustedStreamAccess({ incidentId, token });
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  useEffect(() => {
    if (!activeIncident || !['PENDING_DISPATCH', 'DISPATCHING', 'ACKNOWLEDGED'].includes(activeIncident.status) || ['SENT', 'ACKNOWLEDGED'].includes(activeIncident.dispatch_record?.status)) { setRemaining(0); return undefined; }
    const update = () => setRemaining(Math.max(0, Math.ceil((Date.parse(activeIncident.created_at) + 60_000 - Date.now()) / 1000)));
    update(); const timer = window.setInterval(update, 250); return () => window.clearInterval(timer);
  }, [activeIncident]);

  const startAlarm = useLoudAlarm(Boolean(active), alarmEnabled);

  const registerStreamerIncident = useCallback((result) => {
    const socket = io(API_URL, { transports: ['websocket', 'polling'] }); streamerSocketRef.current?.disconnect(); streamerSocketRef.current = socket;
    socket.on('connect', () => socket.emit('register_streamer', { incident_id: result.incident.incident_id, streamer_id: result.streamer?.id || streamUser?.id || 'demo-streamer', cancel_token: result.streamer_cancel_token }));
    socket.on('streamer_action_confirmed', ({ status }) => setActiveIncident((current) => current ? { ...current, status } : current));
    socket.on('streamer_action_rejected', ({ reason }) => setError(reason || 'The cancel window has ended.'));
    const updateStreamIncident = (incident) => {
      setActiveIncident(incident);
      if (['CANCELLED', 'FALSE_ALARM', 'RESOLVED'].includes(incident?.status) || incident?.dispatch_stage === 'STAND_DOWN') setStreamRequested(false);
    };
    for (const event of ['incident_dispatch_ready', 'incident_acknowledged', 'incident_escalated', 'incident_updated', 'sos_cancelled', 'dispatch_queued', 'dispatch_sent', 'dispatch_acknowledged', 'dispatch_status_updated']) socket.on(event, updateStreamIncident);
    socket.on('trusted_contacts_notified', () => setActiveIncident((current) => current ? { ...current, contacts_notified_at: new Date().toISOString(), dispatch_stage: 'CONTACTS' } : current));
    socket.on('nearby_guardians_update', (update) => setNearbyAccepted(update.accepted_count || 0));
    setNearbyAccepted(result.nearby_accepted_count || 0);
    setEvidenceToken(result.streamer_cancel_token || '');
    setActiveIncident(result.incident);
    setStreamRequested(true);
    setAlertsOpen(true);
  }, [streamUser]);

  const handleSafeWalkEmergency = useCallback((incident, cancelToken) => {
    registerStreamerIncident({ incident, streamer: streamUser || { id: 'demo-streamer' }, streamer_cancel_token: cancelToken });
  }, [registerStreamerIncident, streamUser]);

  const triggerSos = useCallback(async (source = 'button', transcript = '') => {
    if (sending || active) return;
    void liveStreamRef.current?.startCapture?.();
    setStreamRequested(true);
    setError(''); setSending(true);
    startAlarm();
    try {
      const pipelineSource = ['shake', 'shortcut'].includes(source) ? 'button' : source;
      const result = await submitSos({ demoMode: DEMO_MODE, user: streamUser, accessToken: fuleAccount?.access_token || '', apiUrl: API_URL, source: pipelineSource, transcript });
      registerStreamerIncident(result);
    } catch (requestError) { setError(requestError.message || 'SOS could not be sent.'); }
    finally { setSending(false); }
  }, [sending, active, streamUser, fuleAccount, startAlarm, registerStreamerIncident]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('fuleAction') === 'sos') {
      window.history.replaceState({}, '', window.location.pathname + window.location.hash);
      void triggerSos('shortcut', 'Home-screen emergency shortcut activated.');
    }
  }, [triggerSos]);

  useEffect(() => {
    if (!motionReady) return undefined;
    let lastShakeAt = 0;
    const handleMotion = (event) => {
      const acceleration = event.accelerationIncludingGravity;
      if (!acceleration) return;
      const magnitude = Math.hypot(acceleration.x || 0, acceleration.y || 0, acceleration.z || 0);
      const now = Date.now();
      if (magnitude > 24 && now - lastShakeAt > 5000 && !active && !sending) {
        lastShakeAt = now;
        void triggerSos('shake', 'Device shake gesture activated emergency SOS.');
      }
    };
    window.addEventListener('devicemotion', handleMotion, { passive: true });
    return () => window.removeEventListener('devicemotion', handleMotion);
  }, [triggerSos, active, sending, motionReady]);

  async function enableShakeSOS() {
    try {
      const motionEvent = window.DeviceMotionEvent;
      if (typeof motionEvent?.requestPermission === 'function') {
        const permission = await motionEvent.requestPermission();
        if (permission !== 'granted') throw new Error('Motion access was not granted.');
      }
      setMotionReady(true); setError('');
    } catch (motionError) { setError(motionError.message || 'Shake SOS is unavailable in this browser.'); }
  }

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

  function setUpSafeCircle() {
    if (!streamUser && !DEMO_MODE) {
      document.querySelector('.standalone-account-button')?.click();
      return;
    }
    const trustedCircle = document.getElementById('trusted-circle');
    if (trustedCircle) {
      trustedCircle.open = true;
      trustedCircle.scrollIntoView({ behavior: 'smooth', block: 'center' });
      (trustedCircle.querySelector('input, button') || trustedCircle.querySelector('summary'))?.focus({ preventScroll: true });
      return;
    }
    document.querySelector('.standalone-account-button')?.click();
  }

  const carouselStreams = DEMO_MODE ? DEMO_STREAMS : featuredStream ? [featuredStream] : [];
  return <div className="fule-shell gamey-shell" id="home" data-theme={active ? 'alert' : 'calm'}>
    <Header search={search} onSearch={setSearch} onTrigger={triggerSos} onOpenAlerts={() => setAlertsOpen(true)} alertsOpen={alertsOpen} sending={sending} active={Boolean(active)} user={twitchUser} account={fuleAccount} twitchEnabled={twitchEnabled} unreadCount={activeCount} demoMode={DEMO_MODE} category={category} onCategorySelect={setCategory}/>
    <Sidebar connection={socketStatus} role={role} demoMode={DEMO_MODE} unreadCount={activeCount} incidents={[...incidents, ...demoAlerts, ...(activeIncident ? [activeIncident] : [])]} onTrigger={triggerSos} sending={sending} active={Boolean(active)} onOpenAlerts={() => setAlertsOpen(true)} onOpenInsights={() => { const drawer = document.querySelector('.insights-drawer'); if (drawer) { drawer.open = true; drawer.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }}/>
    <main className="dashboard-content">
      <div className="connection-strip">{!DEMO_MODE && <span className="connection-state"><i className={socketStatus === 'online' ? 'on' : ''}/>{socketStatus === 'online' ? 'Safety network is connected' : socketStatus === 'offline' ? 'Reconnecting to the safety network' : 'Connecting to the safety network'}</span>}<span className="privacy-note"><Shield size={13}/>Precise location is shared only with verified guardians</span>{!DEMO_MODE && !twitchUser && <StandaloneAccount account={fuleAccount} onAccount={setFuleAccount}/>}</div>
      {trustedStreamAccess && <section className="active-response-card trusted-stream-entry"><h2>Private stream shared with you</h2><p>This incident stream link is limited to the invited trusted contact and expires shortly.</p><IncidentLiveStream incident={{ incident_id: trustedStreamAccess.incidentId, status: 'PENDING_DISPATCH' }} streamerId="" streamerToken="" role="trusted_contact" guardianToken={trustedStreamAccess.token} compact/></section>}
      {error && <div className="global-error" role="alert"><AlertTriangle size={16}/><span>{error}</span>{error.includes('connect Twitch') && twitchEnabled && <a href={`${API_URL}/auth/twitch`}>Connect Twitch</a>}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
      <div className="main-dashboard-grid gamey-grid"><div className="feed-column gamey-feed">
        <Hero active={Boolean(active)} featuredStream={featuredStream} carouselStreams={carouselStreams} demoMode={DEMO_MODE} onOpenAlerts={() => setAlertsOpen(true)} onSetUpCircle={setUpSafeCircle}/>
        <section className="active-response-card" hidden={!activeIncident}><div className="active-response-heading"><span>Live response</span><strong>{activeIncident?.dispatch_record?.status || 'Guardians alerted'}</strong></div><p className="nearby-response-count" aria-live="polite">{nearbyAccepted} nearby {nearbyAccepted === 1 ? 'guardian is' : 'guardians are'} coming</p><IncidentLiveStream ref={liveStreamRef} incident={activeIncident} streamerId={activeIncident?.streamer_id || streamUser?.id || 'demo-streamer'} streamerToken={evidenceToken} accountAccessToken={fuleAccount?.access_token || ''} role="streamer" autoStart={streamRequested}/>{activeIncident && <><DispatchTimeline incident={activeIncident}/><OperatorBrief incident={activeIncident} privateLocation/>{activeIncident.repeat_offender && <p className="repeat-offender-flag">This account has a repeated false-alarm pattern and needs review.</p>}</>}</section>
        <section className="safety-category-filter" id="communities" aria-label="Filter safety communities"><span>Find your people</span><CategoryChips selected={category} onSelect={setCategory}/></section>
        <section className="safety-bento" aria-label="Your safety tools">
          <div className="bento-card safe-walk-bento" id="safe-walk"><SafeWalkPanel demoMode={DEMO_MODE} streamer={streamUser} activeIncident={activeIncident} onEmergency={handleSafeWalkEmergency}/></div>
          <div className="bento-card trusted-bento"><div className="bento-card-heading"><span className="bento-illustration trusted-illustration"><UsersRound size={21}/></span><div><h2>Your trusted circle</h2><p>People FULE can reach if you need backup.</p></div></div><TrustedContacts streamerId={streamUser?.id || 'demo-streamer'} connected={Boolean(streamUser)} accessToken={fuleAccount?.access_token || ''} demoMode={DEMO_MODE} compact/></div>
          <div className="bento-card evidence-bento"><div className="bento-card-heading"><span className="bento-illustration evidence-illustration"><ShieldCheck size={21}/></span><div><h2>Evidence vault</h2><p>Private recordings and incident case files.</p></div></div><p className="bento-detail">When an incident is active, choose encrypted audio or video capture. Verified guardians can review the tamper-evident case file.</p>{activeIncident ? <EvidenceRecorder incident={activeIncident} streamerToken={evidenceToken}/> : <button className="bento-text-link" type="button" onClick={() => setAlertsOpen(true)}>View incident records <ArrowRight size={14}/></button>}</div>
          <div className="bento-card guardian-bento" id="guardians"><TopGuardiansSection demoMode={DEMO_MODE} search={search} title="Guardians nearby"/></div>
        </section>
        <LiveStreamsSection demoMode={DEMO_MODE} incidents={filteredIncidents} search={search} category={category}/>
        {DEMO_MODE && <details className="demo-drawer"><summary>Demo controls <span>Simulated triggers · no real contacts</span></summary><DemoTriggers onTrigger={triggerSos} disabled={Boolean(active)} sending={sending}/></details>}
        <details className="insights-drawer"><summary>Demo &amp; Insights <span>Network pulse and anonymized map</span></summary><div className="insights-content"><NetworkPulse stats={networkStats} demoMode={DEMO_MODE}/><MapCard incidents={incidents} demoMode={DEMO_MODE}/></div></details>
        <section className="alarm-option-card" id="settings"><span className="alarm-option-icon"><BellRing size={17}/></span><span><strong>Loud emergency alarm</strong><small>Play an audible signal during your active SOS.</small></span><input type="checkbox" checked={alarmEnabled} onChange={(event) => setAlarmEnabled(event.target.checked)} aria-label="Toggle loud emergency alarm"/><button type="button" className="shake-sos-enable" onClick={enableShakeSOS} disabled={motionReady} aria-label="Enable shake gesture for emergency SOS">{motionReady ? 'Shake SOS enabled' : 'Enable shake SOS'}</button></section>
      </div></div>
      <footer className="page-footer"><span>FULE · Futuristic Use of Live Entertainment</span><span>Community safety, with consent and privacy</span></footer>
    </main>
    {alertsOpen && <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setAlertsOpen(false); }}><section className="alert-drawer" role="dialog" aria-modal="true" aria-label="Emergency alerts"><button className="drawer-close" onClick={() => setAlertsOpen(false)} aria-label="Close alerts"><X size={18}/></button><AlertPanel search={search} onIncidentsChange={setIncidents} onRoleChange={setRole} onStatus={setSocketStatus} demoMode={DEMO_MODE} demoAlerts={demoAlerts}/></section></div>}
    <SosButton onClick={triggerSos} sending={sending} active={Boolean(active)}/>
    <CancelToast incident={activeIncident} seconds={remaining} onCancel={cancelSos} onStandDown={standDownSos}/>
  </div>;
}
