import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Activity, AlertTriangle, ArrowRight, BellRing, Check, HeartHandshake, MapPin, Shield, ShieldCheck, UsersRound, X } from 'lucide-react';
import Header from './components/Header.jsx';
import Sidebar from './components/Sidebar.jsx';
import Hero from './components/Hero.jsx';
import AlertPanel from './components/AlertPanel.jsx';
import GuardianDashboard from './components/GuardianDashboard.jsx';
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
const ROUTES = ['home', 'walk', 'circle', 'community', 'privacy', 'evidence', 'activity'];
const ROUTE_TITLES = { home: 'Right now', walk: 'Safe Walk', circle: 'My Circle', community: 'Community', privacy: 'Privacy', evidence: 'Evidence', activity: 'Activity' };
function readRoute() { const route = window.location.hash.replace(/^#\/?/, '').split('?')[0]; return ROUTES.includes(route) ? route : 'home'; }

function SetupRing({ value, total = 3 }) {
  const degrees = Math.round(value / total * 360);
  return <div className="setup-ring" style={{ '--setup-degrees': `${degrees}deg` }} role="img" aria-label={`Safe circle setup: ${value} of ${total} complete`}><span><strong>{value}<small>/{total}</small></strong></span></div>;
}

function NextSteps() {
  return <section className="next-steps-card" aria-labelledby="next-steps-title"><div className="route-section-heading"><div><span className="route-kicker">If you need support</span><h2 id="next-steps-title">What happens next</h2></div><span className="reassurance-copy">You stay in control.</span></div><ol className="next-steps-list"><li><span>1</span><div><strong>You choose to check in or send an SOS</strong><small>Your action starts the response flow.</small></div></li><li><span>2</span><div><strong>Your circle and eligible guardians are notified</strong><small>Public updates use an approximate area.</small></div></li><li><span>3</span><div><strong>Call 112 whenever you need immediate help</strong><small>FULE does not replace emergency services.</small></div></li></ol></section>;
}

const COMMUNITY_GROUPS = [
  { name: 'Women’s Safety', description: 'Consent-led local check-ins and guardian support.' },
  { name: 'Night Commute', description: 'Approximate-area check-ins for the trip home.' },
  { name: 'Campus Watch', description: 'Campus routes, arrival check-ins and support.' },
  { name: 'Civic Alerts', description: 'Updates from nearby public services and streets.' },
  { name: 'Community Help', description: 'Practical neighbor support and shared resources.' },
];

function CommunityDirectory({ selected, onSelect }) {
  return <section className="community-directory" aria-labelledby="community-directory-title"><div className="route-section-heading"><div><span className="route-kicker">Choose what matters to you</span><h2 id="community-directory-title">Safety communities</h2></div></div><div className="community-directory-grid">{COMMUNITY_GROUPS.map(({ name, description }) => <button type="button" key={name} aria-pressed={selected === name} className={`community-directory-card ${selected === name ? 'is-selected' : ''}`} onClick={() => onSelect(name)}><span className="community-mark"><UsersRound size={17}/></span><strong>{name}</strong><small>{description}</small></button>)}</div></section>;
}

export default function App() {
  const reduceMotion = useReducedMotion();
  const [route, setRoute] = useState(readRoute);
  const [now, setNow] = useState(() => new Date());
  const routePositions = useRef({});
  const mainViewRef = useRef(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('Women’s Safety');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [fuleAccount, setFuleAccount] = useState(() => {
    try { const saved = JSON.parse(sessionStorage.getItem('fuleAccount') || 'null'); const accessToken = sessionStorage.getItem('fuleAccessToken'); return saved && accessToken ? { ...saved, access_token: accessToken } : null; }
    catch { return null; }
  });
  const streamUser = fuleAccount ? { ...fuleAccount, id: fuleAccount.account_id, display_name: fuleAccount.email } : null;
  const [activeIncident, setActiveIncident] = useState(null);
  const [socketStatus, setSocketStatus] = useState('connecting');
  const [role, setRole] = useState('public');
  const [incidents, setIncidents] = useState([]);
  const [remaining, setRemaining] = useState(0);
  const [riskLevel, setRiskLevel] = useState('standard');
  const [alarmEnabled, setAlarmEnabled] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [nearbyAccepted, setNearbyAccepted] = useState(0);
  const [evidenceToken, setEvidenceToken] = useState('');
  const [trustedStreamAccess, setTrustedStreamAccess] = useState(null);
  const [streamRequested, setStreamRequested] = useState(false);
  const [motionReady, setMotionReady] = useState(false);
  const [circlePreferences, setCirclePreferences] = useState(() => {
    try { return JSON.parse(localStorage.getItem('fuleCirclePreferences') || 'null') || { name: '', phrase: '', sharing: '' }; }
    catch { return { name: '', phrase: '', sharing: '' }; }
  });
  const streamerSocketRef = useRef(null);
  const liveStreamRef = useRef(null);
  const demoAlerts = useDemoFeed(DEMO_MODE);
  const active = Boolean(
    (activeIncident && ['PENDING_DISPATCH', 'DISPATCHING', 'ACKNOWLEDGED', 'ESCALATED'].includes(activeIncident.status))
    || incidents.some((item) => ['PENDING_DISPATCH', 'DISPATCHING', 'ACKNOWLEDGED', 'ESCALATED'].includes(item.status))
  );

  useEffect(() => {
    if (!fuleAccount) return undefined;
    let live = true;
    const refresh = async () => {
      const refreshToken = sessionStorage.getItem('fuleRefreshToken');
      if (!refreshToken) return;
      try {
        const response = await fetch(`${API_URL}/api/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: refreshToken }) });
        if (!response.ok) throw new Error('Session expired. Sign in again.');
        const result = await response.json();
        if (!live) return;
        sessionStorage.setItem('fuleAccessToken', result.access_token);
        sessionStorage.setItem('fuleRefreshToken', result.refresh_token);
        setFuleAccount({ ...result.account, access_token: result.access_token });
      } catch (refreshError) {
        if (!live) return;
        sessionStorage.removeItem('fuleAccessToken'); sessionStorage.removeItem('fuleRefreshToken'); sessionStorage.removeItem('fuleAccount');
        setFuleAccount(null); setError(refreshError.message);
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 8 * 60_000);
    return () => { live = false; window.clearInterval(timer); };
  }, [Boolean(fuleAccount?.account_id)]);

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
    const socket = io(API_URL, { transports: ['websocket', 'polling'], auth: { accessToken: fuleAccount?.access_token || '' } }); streamerSocketRef.current?.disconnect(); streamerSocketRef.current = socket;
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
  }, [streamUser, fuleAccount?.access_token]);

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
      const pipelineSource = source === 'shortcut' ? 'keyboard' : source;
      const result = await submitSos({ demoMode: DEMO_MODE, user: streamUser, accessToken: fuleAccount?.access_token || '', apiUrl: API_URL, source: pipelineSource, transcript, riskLevel });
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

  const navigateTo = useCallback((nextRoute) => {
    if (!ROUTES.includes(nextRoute)) return;
    routePositions.current[route] = window.scrollY;
    const nextHash = `#/${nextRoute}`;
    if (window.location.hash !== nextHash) window.history.pushState({}, '', nextHash);
    setRoute(nextRoute);
  }, [route]);

  useEffect(() => {
    if (!window.location.hash) window.history.replaceState({}, '', `${window.location.pathname}${window.location.search}#/home`);
    const onLocation = () => setRoute(readRoute());
    window.addEventListener('hashchange', onLocation);
    window.addEventListener('popstate', onLocation);
    return () => { window.removeEventListener('hashchange', onLocation); window.removeEventListener('popstate', onLocation); };
  }, []);

  useEffect(() => {
    document.title = `${ROUTE_TITLES[route]} · FULE`;
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: routePositions.current[route] || 0, behavior: reduceMotion ? 'auto' : 'instant' });
    });
    const focusTimer = window.setTimeout(() => {
      if (alertsOpen) return;
      const heading = mainViewRef.current?.querySelector('.route-view [data-route-heading]');
      heading?.focus({ preventScroll: true });
    }, reduceMotion ? 0 : 280);
    return () => { window.cancelAnimationFrame(frame); window.clearTimeout(focusTimer); };
  }, [route, reduceMotion, alertsOpen]);

  useEffect(() => {
    const rememberScroll = () => { routePositions.current[route] = window.scrollY; };
    window.addEventListener('scroll', rememberScroll, { passive: true });
    return () => window.removeEventListener('scroll', rememberScroll);
  }, [route]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  function saveCirclePreferences(next) {
    setCirclePreferences(next);
    localStorage.setItem('fuleCirclePreferences', JSON.stringify(next));
  }

  function joinAsGuardian() {
    setAlertsOpen(true);
    window.setTimeout(() => {
      document.querySelector('.alert-drawer .guardian-auth-button')?.focus();
    }, 350);
  }

  function setUpSafeCircle() {
    navigateTo('circle');
    if (!streamUser && !DEMO_MODE) {
      window.setTimeout(() => document.querySelector('.standalone-account-button')?.click(), 250);
      return;
    }
    window.setTimeout(() => {
      const trustedCircle = document.getElementById('trusted-circle');
      trustedCircle?.querySelector('input, button, summary')?.focus({ preventScroll: true });
    }, 250);
  }

  const carouselStreams = DEMO_MODE ? DEMO_STREAMS : featuredStream ? [featuredStream] : [];
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : hour < 22 ? 'Good evening' : 'Good night';
  const setupCount = [circlePreferences.name.trim(), circlePreferences.phrase.trim(), circlePreferences.sharing].filter(Boolean).length;
  const terminalIncident = activeIncident && ['CANCELLED', 'FALSE_ALARM', 'RESOLVED'].includes(activeIncident.status) ? activeIncident : null;
  const prototypeNote = 'Prototype only. Some community activity and responses are simulated. FULE does not replace emergency services; call 112 yourself when you need immediate help.';
  const routeContent = route === 'home' ? <>
    <div className="home-view-grid">
      <div className="home-main-column">
        <div className="greeting-line"><span>{greeting}</span><span className="greeting-date">{now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span></div>
        <Hero active={Boolean(active)} featuredStream={featuredStream} carouselStreams={carouselStreams} demoMode={DEMO_MODE} onOpenAlerts={() => setAlertsOpen(true)} onSetUpCircle={setUpSafeCircle}/>
        {activeIncident && <section className="active-response-card home-active-response"><div className="active-response-heading"><span>Live response</span><strong>{activeIncident?.dispatch_record?.status || 'Guardians alerted'}</strong></div><p className="nearby-response-count" aria-live="polite">{nearbyAccepted} nearby {nearbyAccepted === 1 ? 'guardian is' : 'guardians are'} coming</p><IncidentLiveStream ref={liveStreamRef} incident={activeIncident} streamerId={activeIncident?.streamer_id || streamUser?.id || 'demo-streamer'} streamerToken={evidenceToken} accountAccessToken={fuleAccount?.access_token || ''} role="streamer" autoStart={streamRequested}/><DispatchTimeline incident={activeIncident}/><OperatorBrief incident={activeIncident} privateLocation/>{activeIncident.repeat_offender && <p className="repeat-offender-flag">This account has repeated false alarms and needs review.</p>}</section>}
        {terminalIncident && <section className="safe-completion-card" role="status"><span className="completion-check"><Check size={22}/></span><div><h2>You’re safe</h2><p>Your check-in is complete. {terminalIncident.acknowledged_by ? 'A guardian responded.' : 'You can take a moment before continuing.'}</p></div></section>}
      </div>
      <aside className="home-side-column"><section className="circle-progress-card"><SetupRing value={setupCount}/><div><span className="route-kicker">A little peace of mind</span><h2>Safe circle setup</h2><p>{setupCount} of 3 personal choices saved</p><button type="button" className="quiet-action" onClick={() => navigateTo('circle')}>Review my circle <ArrowRight size={15}/></button></div></section><NextSteps/><section className="reassurance-card"><ShieldCheck size={17}/><p>Location stays approximate in the public view. You decide when to check in or ask for help.</p></section></aside>
    </div>
    {DEMO_MODE && <details className="demo-drawer home-disclosure"><summary>Demo controls <span>Open only when you want to explore the simulated flow</span></summary><DemoTriggers onTrigger={triggerSos} disabled={Boolean(active)} sending={sending}/></details>}
    <details className="insights-drawer home-disclosure"><summary>Network and area insights <span>{DEMO_MODE ? 'Illustrative community view' : 'Available when connected'}</span></summary><div className="insights-content"><NetworkPulse stats={networkStats} demoMode={DEMO_MODE}/><MapCard incidents={incidents} demoMode={DEMO_MODE}/></div></details>
  </> : route === 'walk' ? <section className="route-intro-card walk-route-intro"><span className="route-kicker">A quiet check-in</span><h2 data-route-heading tabIndex={-1}>Take your time getting there.</h2><p>Choose a destination and check-in pace. Your safe-walk timer stays here, easy to find.</p><div className="reassurance-row"><ShieldCheck size={17}/>Your location is private to your safe-walk session and eligible responders.</div>{activeIncident && <div className="route-inline-status"><strong>There is an active incident</strong><button type="button" onClick={() => setAlertsOpen(true)}>Open response details</button></div>}</section> : route === 'circle' ? <div className="route-two-column circle-route"><div className="circle-main-column"><section className="route-content-card personalization-card"><div className="route-section-heading"><div><span className="route-kicker">Personalize your support</span><h2 data-route-heading tabIndex={-1}>Make this circle yours.</h2></div><SetupRing value={setupCount}/></div><p>Name your circle, choose a check-in phrase, and decide what location detail is appropriate for your setup.</p><div className="personalization-fields"><label>Circle name<input value={circlePreferences.name} onChange={(event) => saveCirclePreferences({ ...circlePreferences, name: event.target.value })} maxLength={48} placeholder="e.g. My people"/></label><label>Check-in phrase<input value={circlePreferences.phrase} onChange={(event) => saveCirclePreferences({ ...circlePreferences, phrase: event.target.value })} maxLength={80} placeholder="e.g. I’m on my way"/></label><label>Location sharing preference<select value={circlePreferences.sharing} onChange={(event) => saveCirclePreferences({ ...circlePreferences, sharing: event.target.value })}><option value="">Choose a preference</option><option value="approximate">Approximate area in public updates</option><option value="circle">Share exact location with my circle</option></select></label></div><small className="reassurance-copy">Your preferences are saved on this device. Incident access still follows account and guardian permissions.</small></section><section className="route-content-card"><h2>Your trusted contacts</h2><p>Up to three people you choose. They may be notified if guardians have not acknowledged.</p><TrustedContacts streamerId={streamUser?.id || 'demo-streamer'} connected={Boolean(streamUser)} accessToken={fuleAccount?.access_token || ''} demoMode={DEMO_MODE} compact/></section><section className="route-content-card circle-controls-card"><h2>Your response preferences</h2><label className="triage-risk-control" htmlFor="triage-risk">Incident triage sensitivity<select id="triage-risk" value={riskLevel} onChange={(event) => setRiskLevel(event.target.value)}><option value="standard">Standard</option><option value="elevated">Elevated</option><option value="high">High</option></select></label><label className="alarm-toggle-row"><span><strong>Loud emergency alarm</strong><small>Play an audible signal during your active SOS.</small></span><input type="checkbox" checked={alarmEnabled} onChange={(event) => setAlarmEnabled(event.target.checked)} aria-label="Toggle loud emergency alarm"/></label><button type="button" className="secondary-action" onClick={enableShakeSOS} disabled={motionReady}>{motionReady ? 'Shake SOS enabled' : 'Enable shake SOS'}</button>{!DEMO_MODE && <StandaloneAccount account={fuleAccount} onAccount={setFuleAccount}/>}</section></div><aside className="circle-side-column"><section className="route-content-card guardian-preview-card"><div className="route-section-heading"><div><span className="route-kicker">People nearby</span><h2>Guardian response</h2></div><HeartHandshake size={22}/></div><TopGuardiansSection demoMode={DEMO_MODE} search={search} title="Guardians nearby"/><button className="secondary-action" type="button" onClick={joinAsGuardian}>Explore guardian access</button><p className="reassurance-copy">Responders are encouraged to observe, call for help, and assist when safe. Never confront.</p></section><details className="route-content-card guardian-demo-disclosure"><summary>Open guardian demo and live alerts</summary><GuardianDashboard search={search} demoMode={DEMO_MODE} demoAlerts={demoAlerts} account={fuleAccount}/></details></aside></div> : route === 'community' ? <div className="community-route"><section className="route-section-heading community-heading"><div><span className="route-kicker">Find your people</span><h2 data-route-heading tabIndex={-1}>A little support, close by.</h2><p>Browse community spaces and preview shared safety streams.</p></div><span className="community-privacy-note"><ShieldCheck size={16}/>No exact locations shown</span></section><section className="safety-category-filter" aria-label="Filter safety communities"><CategoryChips selected={category} onSelect={setCategory}/></section><CommunityDirectory selected={category} onSelect={setCategory}/><LiveStreamsSection demoMode={DEMO_MODE} incidents={filteredIncidents} search={search} category={category}/><section className="community-guardians-row"><TopGuardiansSection demoMode={DEMO_MODE} search={search} title="Guardians in the community"/></section></div> : route === 'privacy' ? <div className="route-two-column privacy-route"><section className="route-intro-card"><span className="route-kicker">Who can see what</span><h2 data-route-heading tabIndex={-1}>Your location has boundaries.</h2><p>Exact incident details are restricted to verified, eligible responders. Public updates are approximate.</p><div className="privacy-audience-list"><article><span>Public view</span><strong>Approximate area only</strong><small>No exact coordinates or private contact details.</small></article><article><span>Your trusted circle</span><strong>Consent-based access</strong><small>Details depend on your setup and active response.</small></article><article><span>Verified guardians</span><strong>Incident-specific access</strong><small>Exact details are available only when authorized.</small></article></div></section><section className="route-content-card privacy-map-card"><MapCard incidents={incidents} demoMode={DEMO_MODE}/><p className="reassurance-row"><MapPin size={16}/>Illustrative neighborhood map. It does not show a public person-level pin.</p></section></div> : route === 'evidence' ? <div className="route-two-column evidence-route"><section className="route-intro-card"><span className="route-kicker">Private by design</span><h2 data-route-heading tabIndex={-1}>Evidence, when an incident needs it.</h2><p>Recording and case-file access depend on an active incident and authorized account permissions.</p><div className="evidence-state-card">{activeIncident ? <><strong>Active incident evidence</strong><EvidenceRecorder incident={activeIncident} streamerToken={evidenceToken}/></> : <><ShieldCheck size={22}/><strong>No active incident evidence</strong><span>Nothing new is being recorded right now.</span></>}</div><p className="reassurance-copy">Access depends on incident status and your account permissions.</p></section><section className="route-content-card evidence-history-card"><GuardianDashboard search={search} demoMode={DEMO_MODE} demoAlerts={demoAlerts} account={fuleAccount}/></section></div> : <div className="activity-route"><section className="route-section-heading"><div><span className="route-kicker">Your incident history</span><h2 data-route-heading tabIndex={-1}>Updates, in one place.</h2><p>History is shown according to your account’s access.</p></div><button type="button" className="secondary-action" onClick={() => setAlertsOpen(true)}><Activity size={16}/>Open live alerts</button></section><GuardianDashboard search={search} demoMode={DEMO_MODE} demoAlerts={demoAlerts} account={fuleAccount}/></div>;

  return <div className="fule-shell app-shell" data-theme={active ? 'alert' : 'calm'} data-time-tone={hour >= 20 || hour < 6 ? 'night' : 'day'}>
    <Header search={search} onSearch={setSearch} onTrigger={triggerSos} onOpenAlerts={() => setAlertsOpen(true)} alertsOpen={alertsOpen} sending={sending} active={Boolean(active)} account={fuleAccount} unreadCount={activeCount} demoMode={DEMO_MODE} route={route}/>
    <Sidebar connection={socketStatus} role={role} demoMode={DEMO_MODE} unreadCount={activeCount} incidents={[...incidents, ...demoAlerts, ...(activeIncident ? [activeIncident] : [])]} route={route} onTrigger={triggerSos} sending={sending} active={Boolean(active)} onOpenAlerts={() => setAlertsOpen(true)}/>
    <main className={`dashboard-content app-main ${route === 'walk' ? 'is-walk-view' : ''}`} ref={mainViewRef} id="main-content">
      <div className="prototype-banner" role="note"><strong>Prototype only</strong><span>Demo activity may be simulated. FULE does not replace emergency services.</span></div>
      {trustedStreamAccess && <section className="route-content-card trusted-stream-entry"><h2>Private stream shared with you</h2><p>This incident stream link is limited to the invited trusted contact and expires shortly.</p><IncidentLiveStream incident={{ incident_id: trustedStreamAccess.incidentId, status: 'PENDING_DISPATCH' }} streamerId="" streamerToken="" role="trusted_contact" guardianToken={trustedStreamAccess.token} compact/></section>}
      {error && <div className="global-error" role="alert"><AlertTriangle size={16}/><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
      <AnimatePresence mode="wait" initial={false}><motion.section className="route-view" key={route} aria-label={`${ROUTE_TITLES[route]} view`} initial={reduceMotion ? false : { opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={reduceMotion ? undefined : { opacity: 0, x: -6 }} transition={{ duration: reduceMotion ? 0 : .25 }} onAnimationComplete={() => { const heading = mainViewRef.current?.querySelector('[data-route-heading]'); if (heading) heading.focus({ preventScroll: true }); }}>{routeContent}</motion.section></AnimatePresence>
      <div className="persistent-walk-panel" hidden={route !== 'walk'}><section className="route-content-card"><SafeWalkPanel demoMode={DEMO_MODE} streamer={streamUser} accessToken={fuleAccount?.access_token || ''} activeIncident={activeIncident} onEmergency={handleSafeWalkEmergency}/></section></div>
      <footer className="page-footer"><span>FULE · Futuristic Use of Live Entertainment</span><span>Safety support with consent, privacy, and choice</span></footer>
    </main>
    {alertsOpen && <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setAlertsOpen(false); }}><section className="alert-drawer" role="dialog" aria-modal="true" aria-label="Emergency alerts"><button className="drawer-close" onClick={() => setAlertsOpen(false)} aria-label="Close alerts"><X size={18}/></button><AlertPanel search={search} onIncidentsChange={setIncidents} onRoleChange={setRole} onStatus={setSocketStatus} demoMode={DEMO_MODE} demoAlerts={demoAlerts} account={fuleAccount}/></section></div>}
    <SosButton onClick={triggerSos} sending={sending} active={Boolean(active)}/>
    <CancelToast incident={activeIncident} seconds={remaining} onCancel={cancelSos} onStandDown={standDownSos}/>
  </div>;
}
