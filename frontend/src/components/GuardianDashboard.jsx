import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { Activity, ArrowUpRight, Check, Clock3, LoaderCircle, MapPin, Radio, ShieldCheck, TriangleAlert } from 'lucide-react';
import { isIncident } from '../../../shared/incident.mjs';
import { API_URL } from '../config.js';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import './GuardianDashboard.css';
import { DispatchTimeline, OperatorBrief } from './DispatchTimeline.jsx';

function elapsedTime(date, now) {
  const seconds = Math.max(0, Math.floor((now - Date.parse(date)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`;
}

function escalationSeconds(date, now) {
  return Math.max(0, Math.ceil((Date.parse(date) + 30_000 - now) / 1000));
}

export default function GuardianDashboard({ search = '', onIncidentsChange, onRoleChange, onStatus, demoMode = false, demoAlerts = [] }) {
  const reduceMotion = useReducedMotion();
  const [alerts, setAlerts] = useState([]);
  const [connection, setConnection] = useState('connecting');
  const [role, setRole] = useState('public');
  const [guardianToken, setGuardianToken] = useState(() => sessionStorage.getItem('fuleGuardianToken') || '');
  const [tokenDraft, setTokenDraft] = useState('');
  const [showTokenForm, setShowTokenForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [ackPending, setAckPending] = useState({});
  const [demoStatuses, setDemoStatuses] = useState({});
  const [now, setNow] = useState(Date.now());
  const socketRef = useRef(null);
  const roleRef = useRef('public');
  const publishAlerts = (next) => { setAlerts(next); onIncidentsChange?.(next); };
  const connectionState = (next) => { setConnection(next); onStatus?.(next); };
  const accessRole = (next) => { roleRef.current = next; setRole(next); onRoleChange?.(next); };

  useEffect(() => {
    const socket = io(API_URL, { transports: ['websocket', 'polling'], auth: { guardianToken } }); socketRef.current = socket;
    socket.on('connect', () => { connectionState('online'); setLoadError(''); });
    socket.on('disconnect', () => connectionState('offline'));
    socket.on('connect_error', (error) => {
      connectionState('offline');
      if (demoMode) setLoading(false);
      if (guardianToken && error.message?.includes('Guardian session')) {
        sessionStorage.removeItem('fuleGuardianToken');
        accessRole('public');
        setGuardianToken('');
        setLoading(false);
        setLoadError('Guardian session expired. Verify your invite again.');
      } else setLoadError('Live alert connection failed. Reconnecting…');
    });
    socket.on('fule:access', ({ role: nextRole }) => {
      accessRole(nextRole);
      if (nextRole !== 'guardian' || !guardianToken) { setLoading(false); return; }
      fetch(`${API_URL}/api/incidents`, { headers: { Authorization: `Bearer ${guardianToken}` } })
        .then(async (response) => { if (!response.ok) throw new Error('Could not load incident history.'); return response.json(); })
        .then((data) => { publishAlerts(data.incidents || []); setLoadError(''); })
        .catch((error) => setLoadError(error.message))
        .finally(() => setLoading(false));
    });
    const upsert = (incident) => {
      if (!isIncident(incident)) return;
      publishAlerts((current) => [incident, ...current.filter((item) => item.incident_id !== incident.incident_id)].slice(0, 40));
      setAckPending((current) => ({ ...current, [incident.incident_id]: false }));
    };
    socket.on('sos_activated', upsert);
    socket.on('incident:public', (incident) => { if (roleRef.current !== 'guardian') upsert(incident); });
    for (const event of ['incident_acknowledged', 'incident_dispatch_ready', 'incident_escalated', 'incident_updated', 'sos_cancelled', 'incident_clip_ready', 'dispatch_queued', 'dispatch_sent', 'dispatch_acknowledged', 'dispatch_status_updated']) socket.on(event, upsert);
    socket.on('incident:public:update', (update) => publishAlerts((current) => current.map((item) => item.incident_id === update.incident_id ? { ...item, ...update } : item)));
    socket.on('trusted_contacts_notified', (update) => publishAlerts((current) => current.map((item) => item.incident_id === update.incident_id ? { ...item, contacts_notified_at: new Date().toISOString(), dispatch_stage: 'CONTACTS' } : item)));
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearInterval(tick); socket.disconnect(); };
  }, [guardianToken, demoMode]);

  const visibleAlerts = useMemo(() => {
    const allAlerts = [...demoAlerts.map((item) => ({ ...item, status: demoStatuses[item.incident_id] || item.status })), ...alerts];
    const query = search.trim().toLowerCase(); if (!query) return allAlerts;
    return allAlerts.filter((alert) => [alert.summary, alert.module, alert.location?.address, alert.status, alert.threat_level].some((value) => String(value || '').toLowerCase().includes(query)));
  }, [alerts, demoAlerts, demoStatuses, search]);

  async function connectGuardian(event) {
    event.preventDefault(); const invite = tokenDraft.trim(); if (!invite) return;
    setLoadError('');
    try {
      const response = await fetch(`${API_URL}/api/guardians/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invite_code: invite }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Guardian verification failed.');
      sessionStorage.setItem('fuleGuardianToken', result.access_token); setGuardianToken(result.access_token); setShowTokenForm(false); setTokenDraft(''); setLoading(true);
    } catch (error) { setLoadError(error.message); }
  }

  function acknowledge(alert) {
    if (alert.demo) {
      setDemoStatuses((current) => ({ ...current, [alert.incident_id]: 'ACKNOWLEDGED' }));
      return;
    }
    if (roleRef.current !== 'guardian' || ackPending[alert.incident_id] || alert.status === 'ACKNOWLEDGED') return;
    setAckPending((current) => ({ ...current, [alert.incident_id]: true }));
    socketRef.current?.emit('acknowledge_incident', alert.incident_id);
    window.setTimeout(() => setAckPending((current) => current[alert.incident_id] ? ({ ...current, [alert.incident_id]: false }) : current), 5000);
  }

  function disconnectGuardian() {
    sessionStorage.removeItem('fuleGuardianToken'); setGuardianToken(''); accessRole('public'); publishAlerts([]); setAckPending({}); setLoadError('');
  }

  async function standDown(alert) {
    if (roleRef.current !== 'guardian' || !['SENT', 'ACKNOWLEDGED'].includes(alert.dispatch_record?.status)) return;
    try {
      const response = await fetch(`${API_URL}/api/dispatch/${encodeURIComponent(alert.incident_id)}/action`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${guardianToken}` },
        body: JSON.stringify({ action: 'STAND_DOWN', reason: 'Verified guardian requested stand-down.' })
      });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Stand-down failed.');
      publishAlerts((current) => [result.incident, ...current.filter((item) => item.incident_id !== result.incident.incident_id)]);
    } catch (requestError) { setLoadError(requestError.message); }
  }

  const activeCount = visibleAlerts.filter((item) => ['PENDING_DISPATCH', 'DISPATCHING', 'ACKNOWLEDGED', 'ESCALATED'].includes(item.status)).length;
  return <aside className="guardian-panel" id="alerts" aria-label="Guardian alert panel">
    <div className="guardian-panel-header" id="logs"><div><p className="eyebrow"><Radio size={13}/> GUARDIAN NETWORK</p><h2>{role === 'guardian' ? 'Incident history' : 'Emergency alerts'}</h2></div><span className={`guardian-connection ${connection}`}><i/>{connection === 'online' ? 'LIVE' : connection === 'offline' ? 'OFFLINE' : 'CONNECTING'}</span></div>
    {role !== 'guardian' && <div className="guardian-access"><ShieldCheck size={15}/><span>Public feed · private details require verification</span></div>}
    {role !== 'guardian' && <div className="guardian-auth">{showTokenForm ? <form className="guardian-auth-form" onSubmit={connectGuardian}><label className="visually-hidden" htmlFor="guardian-invite">Guardian invite code</label><input id="guardian-invite" type="password" value={tokenDraft} onChange={(event) => setTokenDraft(event.target.value)} placeholder="Guardian invite code" autoComplete="current-password"/><button type="submit">VERIFY</button></form> : <button className="guardian-auth-button" onClick={() => setShowTokenForm(true)}>Verify as guardian</button>}</div>}
    {role === 'guardian' && <button className="guardian-logout" onClick={disconnectGuardian}>Disconnect guardian access</button>}
    <div className="alerts-overview"><span className="overview-mark"><Activity size={17}/></span><span><strong>{activeCount} active {activeCount === 1 ? 'alert' : 'alerts'}</strong><small>{role === 'guardian' ? 'Guardian only incident details' : 'Anonymized safety notices'}</small></span></div>
    {loadError && <div className="panel-error" role="alert"><TriangleAlert size={14}/>{loadError}</div>}
    <div className="alert-list" id="logs" aria-live="polite">
      {loading && !demoMode ? <div className="panel-state"><LoaderCircle className="spinner" size={22}/><strong>Loading alert feed</strong><span>Connecting to live safety updates…</span></div>
        : visibleAlerts.length === 0 ? <div className="panel-state"><span className="empty-shield"><ShieldCheck size={23}/></span><strong>{search && alerts.length ? 'No matching alerts' : 'No active alerts'}</strong><span>{search && alerts.length ? 'Try a different search.' : 'New alerts will appear here in real time.'}</span></div>
          : <AnimatePresence initial={false}>{visibleAlerts.map((alert) => {
            const threat = alert.threat_level;
            const address = alert.location?.address || 'Location unavailable';
            const hasPreciseLocation = role === 'guardian' && Number.isFinite(alert.location?.lat) && Number.isFinite(alert.location?.lng);
            const pin = hasPreciseLocation ? `geo:${alert.location.lat},${alert.location.lng}?q=${alert.location.lat},${alert.location.lng}` : null;
            const acknowledged = alert.status === 'ACKNOWLEDGED';
            const activeStatus = ['PENDING_DISPATCH', 'DISPATCHING', 'ESCALATED'].includes(alert.status);
            const countdown = escalationSeconds(alert.created_at, now);
            return <motion.article className="alert-card" key={alert.incident_id} layout initial={reduceMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? undefined : { opacity: 0, y: -8 }} transition={{ duration: reduceMotion ? 0 : .23 }}>
              <div className="alert-card-top"><span className={`threat-badge threat-${threat.toLowerCase()}`}><i/>THREAT · {threat}</span><time dateTime={alert.created_at} title={new Date(alert.created_at).toLocaleString()}><Clock3 size={12}/>{elapsedTime(alert.created_at, now)}</time></div>
              {alert.demo && <div className="simulated-ribbon">SIMULATED · NO REAL INCIDENT</div>}
              <div className="alert-category">{alert.module.replaceAll('_', ' ')}</div>
              <p className="alert-summary">{alert.summary}</p>
              <div className="alert-location"><MapPin size={14}/><span>{address}</span></div>
              {hasPreciseLocation && <div className="guardian-precise-location"><span>VERIFIED GUARDIAN · EXACT PIN</span><strong>{alert.location.lat}, {alert.location.lng}</strong><a href={pin} aria-label={`Open exact map pin for incident ${alert.incident_id}`}><MapPin size={13}/>Open map pin</a></div>}
              {activeStatus && <div className="escalation-countdown" role="timer" aria-label={countdown ? `Escalation in ${countdown} seconds` : 'Escalation is due'}><span><Clock3 size={13}/>ESCALATION</span><strong>{countdown ? `00:${String(countdown).padStart(2, '0')}` : 'DUE'}</strong></div>}
              <DispatchTimeline incident={alert}/>
              <OperatorBrief incident={alert} compact privateLocation={role === 'guardian'}/>
              <div className="alert-meta"><span>{alert.source.toUpperCase()} · {alert.status.replaceAll('_', ' ')}</span>{alert.clip_url && <a href={alert.clip_url} target="_blank" rel="noreferrer" aria-label="Open clip evidence">CLIP EVIDENCE <ArrowUpRight size={12}/></a>}</div>
              {alert.escalated && <p className="alert-escalation-note">{alert.escalation_flag}</p>}
              {role === 'guardian' && ['SENT', 'ACKNOWLEDGED'].includes(alert.dispatch_record?.status) && alert.dispatch_stage !== 'STAND_DOWN' && <button className="stand-down-button" onClick={() => standDown(alert)}>STAND DOWN DISPATCH</button>}
              <button className={`acknowledge-button ${acknowledged ? 'acknowledged' : ''}`} onClick={() => acknowledge(alert)} disabled={acknowledged || (!alert.demo && role !== 'guardian') || Boolean(ackPending[alert.incident_id])} aria-label={acknowledged ? 'Incident acknowledged' : `Acknowledge and dispatch incident ${alert.incident_id}`}>
                {acknowledged ? <><Check size={15}/>ACKNOWLEDGED</> : ackPending[alert.incident_id] ? <><LoaderCircle className="spinner" size={15}/>SENDING…</> : alert.demo ? <><ShieldCheck size={15}/>SIMULATE ACKNOWLEDGEMENT</> : role !== 'guardian' ? <><ShieldCheck size={15}/>GUARDIAN ACCESS REQUIRED</> : <><ShieldCheck size={15}/>ACKNOWLEDGE &amp; DISPATCH</>}
              </button>
            </motion.article>;
          })}</AnimatePresence>}
    </div>
    <footer className="guardian-panel-foot"><span><i className={connection === 'online' && role === 'guardian' ? 'online' : ''}/>{role === 'guardian' ? 'Verified secure channel' : 'Public read-only feed'}</span><span>{demoMode ? 'DEMO' : role === 'guardian' ? 'GUARDIAN' : 'PUBLIC'}</span></footer>
  </aside>;
}
