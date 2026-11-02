import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { Activity, ArrowUpRight, Check, Clock3, LoaderCircle, MapPin, Radio, ShieldCheck, TriangleAlert } from 'lucide-react';
import { isIncident } from '../../../shared/incident.mjs';
import { API_URL } from '../config.js';
import './GuardianDashboard.css';

function elapsedTime(date, now) {
  const seconds = Math.max(0, Math.floor((now - Date.parse(date)) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`;
}

function escalationSeconds(date, now) {
  return Math.max(0, Math.ceil((Date.parse(date) + 30_000 - now) / 1000));
}

export default function GuardianDashboard({ search = '', onIncidentsChange, onRoleChange, onStatus }) {
  const [alerts, setAlerts] = useState([]);
  const [connection, setConnection] = useState('connecting');
  const [role, setRole] = useState('public');
  const [guardianToken, setGuardianToken] = useState(() => sessionStorage.getItem('fuleGuardianToken') || '');
  const [tokenDraft, setTokenDraft] = useState('');
  const [showTokenForm, setShowTokenForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [ackPending, setAckPending] = useState({});
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
    for (const event of ['incident_acknowledged', 'incident_dispatch_ready', 'incident_escalated', 'sos_cancelled', 'incident_clip_ready']) socket.on(event, upsert);
    socket.on('incident:public:update', (update) => publishAlerts((current) => current.map((item) => item.incident_id === update.incident_id ? { ...item, ...update } : item)));
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearInterval(tick); socket.disconnect(); };
  }, [guardianToken]);

  const visibleAlerts = useMemo(() => {
    const query = search.trim().toLowerCase(); if (!query) return alerts;
    return alerts.filter((alert) => [alert.summary, alert.module, alert.location?.address, alert.status, alert.threat_level].some((value) => String(value || '').toLowerCase().includes(query)));
  }, [alerts, search]);

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
    if (roleRef.current !== 'guardian' || ackPending[alert.incident_id] || alert.status === 'ACKNOWLEDGED') return;
    setAckPending((current) => ({ ...current, [alert.incident_id]: true }));
    socketRef.current?.emit('acknowledge_incident', alert.incident_id);
    window.setTimeout(() => setAckPending((current) => current[alert.incident_id] ? ({ ...current, [alert.incident_id]: false }) : current), 5000);
  }

  function disconnectGuardian() {
    sessionStorage.removeItem('fuleGuardianToken'); setGuardianToken(''); accessRole('public'); publishAlerts([]); setAckPending({}); setLoadError('');
  }

  const activeCount = alerts.filter((item) => ['PENDING_DISPATCH', 'DISPATCHING', 'ESCALATED'].includes(item.status)).length;
  return <aside className="guardian-panel" id="feeds" aria-label="Guardian alert panel">
    <div className="guardian-panel-header"><div><p className="eyebrow"><Radio size={13}/> GUARDIAN NETWORK</p><h2>Emergency alerts</h2></div><span className={`guardian-connection ${connection}`}><i/>{connection === 'online' ? 'LIVE' : connection === 'offline' ? 'OFFLINE' : 'CONNECTING'}</span></div>
    {role !== 'guardian' && <div className="guardian-access"><ShieldCheck size={15}/><span>Public feed · private details require verification</span></div>}
    {role !== 'guardian' && <div className="guardian-auth">{showTokenForm ? <form className="guardian-auth-form" onSubmit={connectGuardian}><label className="visually-hidden" htmlFor="guardian-invite">Guardian invite code</label><input id="guardian-invite" type="password" value={tokenDraft} onChange={(event) => setTokenDraft(event.target.value)} placeholder="Guardian invite code" autoComplete="current-password"/><button type="submit">VERIFY</button></form> : <button className="guardian-auth-button" onClick={() => setShowTokenForm(true)}>Verify as guardian</button>}</div>}
    {role === 'guardian' && <button className="guardian-logout" onClick={disconnectGuardian}>Disconnect guardian access</button>}
    <div className="alerts-overview"><span className="overview-mark"><Activity size={17}/></span><span><strong>{activeCount} active {activeCount === 1 ? 'alert' : 'alerts'}</strong><small>{role === 'guardian' ? 'Guardian only incident details' : 'Anonymized safety notices'}</small></span></div>
    {loadError && <div className="panel-error" role="alert"><TriangleAlert size={14}/>{loadError}</div>}
    <div className="alert-list" id="logs" aria-live="polite">
      {loading ? <div className="panel-state"><LoaderCircle className="spinner" size={22}/><strong>Loading alert feed</strong><span>Connecting to live safety updates…</span></div>
        : visibleAlerts.length === 0 ? <div className="panel-state"><span className="empty-shield"><ShieldCheck size={23}/></span><strong>{search && alerts.length ? 'No matching alerts' : 'No active alerts'}</strong><span>{search && alerts.length ? 'Try a different search.' : 'New alerts will appear here in real time.'}</span></div>
          : visibleAlerts.map((alert) => {
            const threat = alert.threat_level;
            const address = alert.location?.address || 'Location unavailable';
            const acknowledged = alert.status === 'ACKNOWLEDGED';
            const activeStatus = ['PENDING_DISPATCH', 'DISPATCHING', 'ESCALATED'].includes(alert.status);
            const countdown = escalationSeconds(alert.created_at, now);
            return <article className="alert-card" key={alert.incident_id}>
              <div className="alert-card-top"><span className={`threat-badge threat-${threat.toLowerCase()}`}><i/>THREAT · {threat}</span><time dateTime={alert.created_at} title={new Date(alert.created_at).toLocaleString()}><Clock3 size={12}/>{elapsedTime(alert.created_at, now)}</time></div>
              <div className="alert-category">{alert.module.replaceAll('_', ' ')}</div>
              <p className="alert-summary">{alert.summary}</p>
              <div className="alert-location"><MapPin size={14}/><span>{address}</span></div>
              {activeStatus && <div className="escalation-countdown" role="timer" aria-label={countdown ? `Escalation in ${countdown} seconds` : 'Escalation is due'}><span><Clock3 size={13}/>ESCALATION</span><strong>{countdown ? `00:${String(countdown).padStart(2, '0')}` : 'DUE'}</strong></div>}
              <div className="alert-meta"><span>{alert.source.toUpperCase()} · {alert.status.replaceAll('_', ' ')}</span>{alert.clip_url && <a href={alert.clip_url} target="_blank" rel="noreferrer" aria-label="Open clip evidence">CLIP EVIDENCE <ArrowUpRight size={12}/></a>}</div>
              {alert.escalated && <p className="alert-escalation-note">{alert.escalation_flag}</p>}
              <button className={`acknowledge-button ${acknowledged ? 'acknowledged' : ''}`} onClick={() => acknowledge(alert)} disabled={role !== 'guardian' || acknowledged || Boolean(ackPending[alert.incident_id])} aria-label={acknowledged ? 'Incident acknowledged' : `Acknowledge and dispatch incident ${alert.incident_id}`}>
                {acknowledged ? <><Check size={15}/>ACKNOWLEDGED</> : ackPending[alert.incident_id] ? <><LoaderCircle className="spinner" size={15}/>SENDING…</> : role !== 'guardian' ? <><ShieldCheck size={15}/>GUARDIAN ACCESS REQUIRED</> : <><ShieldCheck size={15}/>ACKNOWLEDGE &amp; DISPATCH</>}
              </button>
            </article>;
          })}
    </div>
    <footer className="guardian-panel-foot"><span><i className={connection === 'online' && role === 'guardian' ? 'online' : ''}/>{role === 'guardian' ? 'Verified secure channel' : 'Public read-only feed'}</span><span>{role === 'guardian' ? 'GUARDIAN' : 'PUBLIC'}</span></footer>
  </aside>;
}
