import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { Activity, ArrowUpRight, Check, Clock3, MapPin, Radio, ShieldCheck } from 'lucide-react';
import { isIncident } from '../../../shared/incident.mjs';
import './GuardianDashboard.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const DEMO_MODE = import.meta.env.VITE_DEMO_MODE !== 'false';

export default function GuardianDashboard({ search = '' }) {
  const [alerts, setAlerts] = useState([]);
  const [connection, setConnection] = useState('connecting');
  const [role, setRole] = useState('public');
  const [acknowledged, setAcknowledged] = useState({});
  const [guardianToken, setGuardianToken] = useState(() => sessionStorage.getItem('fuleGuardianToken') || '');
  const [tokenDraft, setTokenDraft] = useState('');
  const [showTokenForm, setShowTokenForm] = useState(false);
  const socketRef = useRef(null);
  const roleRef = useRef('public');

  useEffect(() => {
    const socket = io(API_URL, { transports: ['websocket', 'polling'], auth: { guardianToken } });
    socketRef.current = socket;
    socket.on('connect', () => setConnection('online'));
    socket.on('disconnect', () => setConnection('offline'));
    socket.on('fule:access', ({ role: accessRole }) => {
      roleRef.current = accessRole;
      setRole(accessRole);
      if (accessRole === 'guardian' && guardianToken) {
        fetch(`${API_URL}/api/incidents`, { headers: { Authorization: `Bearer ${guardianToken}` } })
          .then((response) => response.ok ? response.json() : null)
          .then((data) => { if (data?.incidents) setAlerts(data.incidents); })
          .catch(() => {});
      }
    });
    socket.on('sos_activated', (incident) => {
      if (isIncident(incident)) setAlerts((current) => [incident, ...current.filter((item) => item.incident_id !== incident.incident_id)].slice(0, 8));
    });
    socket.on('incident:public', (incident) => {
      if (roleRef.current !== 'guardian' && isIncident(incident)) setAlerts((current) => [incident, ...current.filter((item) => item.incident_id !== incident.incident_id)].slice(0, 8));
    });
    socket.on('incident_acknowledged', (incident) => {
      if (!isIncident(incident)) return;
      setAcknowledged((current) => ({ ...current, [incident.incident_id]: true }));
      setAlerts((current) => current.map((item) => item.incident_id === incident.incident_id ? incident : item));
    });
    socket.on('incident_clip_ready', (incident) => { if (roleRef.current === 'guardian' && isIncident(incident)) setAlerts((current) => current.map((item) => item.incident_id === incident.incident_id ? incident : item)); });
    for (const event of ['incident_dispatch_ready', 'incident_escalated', 'sos_cancelled']) {
      socket.on(event, (incident) => {
        if (isIncident(incident)) setAlerts((current) => current.map((item) => item.incident_id === incident.incident_id ? incident : item));
      });
    }
    socket.on('incident:public:update', (update) => {
      setAlerts((current) => current.map((item) => item.incident_id === update.incident_id
        ? { ...item, status: update.status, escalated: update.escalated ?? item.escalated, escalation_flag: update.escalation_flag ?? item.escalation_flag }
        : item));
    });
    return () => socket.disconnect();
  }, [guardianToken]);

  const visibleAlerts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return alerts;
    return alerts.filter((alert) => [alert.summary, alert.module, alert.location?.address, `${alert.location?.lat}, ${alert.location?.lng}`, alert.clip_url]
      .some((value) => String(value || '').toLowerCase().includes(query)));
  }, [alerts, search]);

  async function connectGuardian(event) {
    event.preventDefault();
    const inviteCode = tokenDraft.trim();
    if (!inviteCode) return;
    try {
      const response = await fetch(`${API_URL}/api/guardians/verify`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invite_code: inviteCode })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Invite verification failed.');
      sessionStorage.setItem('fuleGuardianToken', result.access_token);
      setGuardianToken(result.access_token);
      setTokenDraft('');
      setShowTokenForm(false);
    } catch (error) {
      setTokenDraft('');
      window.alert(error.message);
    }
  }

  function disconnectGuardian() {
    sessionStorage.removeItem('fuleGuardianToken');
    setGuardianToken('');
    setAlerts([]);
    setAcknowledged({});
  }

  function acknowledge(incidentId) {
    if (role === 'guardian') socketRef.current?.emit('acknowledge_incident', incidentId);
  }

  return (
    <aside className="guardian-panel" id="dispatch" aria-label="Guardian alarm dashboard">
      <div className="guardian-panel-header">
        <div><div className="guardian-overline"><Radio size={13} /> GUARDIAN COMMAND</div><h2>Incoming alarms</h2></div>
        <div className={`guardian-connection ${connection}`}><i />{connection === 'online' ? 'LIVE' : connection === 'offline' ? 'RECONNECTING' : 'CONNECTING'}</div>
      </div>

      {role !== 'guardian' && <div className="guardian-access-note"><ShieldCheck size={14} /> Public view · precise location restricted</div>}
      {role !== 'guardian' && <div className="guardian-auth-area">
        {showTokenForm ? <form className="guardian-auth-form" onSubmit={connectGuardian}><input type="password" value={tokenDraft} onChange={(event) => setTokenDraft(event.target.value)} placeholder="Guardian invite code" aria-label="Guardian invite code" autoComplete="current-password" /><button type="submit">VERIFY</button></form> : <button className="guardian-auth-open" onClick={() => setShowTokenForm(true)}>Verify guardian invite</button>}
      </div>}
      {role === 'guardian' && guardianToken && <button className="guardian-disconnect" onClick={disconnectGuardian}>Disconnect guardian access</button>}

      <div className="alarm-summary"><span className="alarm-summary-icon"><Activity size={16} /></span><span><strong>{alerts.length ? `${alerts.length} active ${alerts.length === 1 ? 'incident' : 'incidents'}` : 'Guardian watch is active'}</strong><small>{role === 'guardian' ? 'Verified guardian safety signals' : 'Public updates are anonymized'}</small></span><span className="alarm-count">{alerts.length.toString().padStart(2, '0')}</span></div>

      <div className="alarm-list" aria-live="polite">
        {visibleAlerts.length === 0 ? (
          <div className="guardian-empty"><span className="empty-shield"><ShieldCheck size={21} /></span><strong>{search && alerts.length ? 'No matching incidents' : 'All clear for now'}</strong><span>{search && alerts.length ? 'Try a different search term.' : 'New SOS alerts will appear here in real time.'}</span></div>
        ) : visibleAlerts.map((alert) => {
          const coords = alert.location || {};
          const lat = Number(coords.lat);
          const lng = Number(coords.lng);
          const isPrecise = role === 'guardian';
          const coordText = isPrecise ? `${lat.toFixed(4)}, ${lng.toFixed(4)}` : coords.address;
          const mapUrl = Number.isFinite(lat) && Number.isFinite(lng) ? `https://www.google.com/maps?q=${lat},${lng}` : null;
          const threat = alert.threat_level || 'CRITICAL';
          const isAcknowledged = Boolean(acknowledged[alert.incident_id]) || ['ACKNOWLEDGED', 'CANCELLED', 'FALSE_ALARM', 'RESOLVED'].includes(alert.status);
          return (
            <article className="alarm-card" key={alert.incident_id}>
              <div className="alarm-card-top"><span className={`threat-badge threat-${threat.toLowerCase()}`}><i />THREAT {threat}</span><time><Clock3 size={12} />{new Date(alert.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
              <div className="alarm-type">{alert.module.replaceAll('_', ' ')}</div>
              <p className="alarm-synthesis">{alert.summary}</p>
              {role === 'guardian' && alert.stream_url && <div className="guardian-live-stream"><iframe title={`Private guardian view for ${alert.incident_id}`} src={`https://player.twitch.tv/?channel=${encodeURIComponent(alert.stream_url.split('/').pop())}&parent=${encodeURIComponent(window.location.hostname)}&muted=true`} allowFullScreen allow="autoplay; fullscreen" /><span><Radio size={12} /> GUARDIAN LIVE FEED</span></div>}
              <div className="alarm-location-row">{isPrecise && mapUrl ? <a className="location-link" href={mapUrl} target="_blank" rel="noreferrer"><MapPin size={15} /><span><small>PRECISE GPS PIN</small><strong>{coordText}</strong></span><ArrowUpRight size={13} /></a> : <span className="location-link public-location"><MapPin size={15} /><span><small>{isPrecise ? 'LOCATION UNAVAILABLE' : 'APPROXIMATE LOCATION'}</small><strong>{isPrecise ? 'No GPS supplied' : coordText}</strong></span></span>}{alert.clip_url && <a className="open-feed" href={alert.clip_url} target="_blank" rel="noreferrer">OPEN CLIP <ArrowUpRight size={12} /></a>}</div>
              <div className="alarm-card-meta"><span>15-SEC AI SYNTHESIS</span><span>{alert.source.toUpperCase()} · {alert.status}</span></div>
              {alert.escalated && <div className="escalation-note">ESCALATED · {alert.escalation_flag}</div>}
              <button className={`acknowledge-button ${isAcknowledged ? 'acknowledged' : ''}`} onClick={() => acknowledge(alert.incident_id)} disabled={isAcknowledged || role !== 'guardian'}>{role !== 'guardian' ? <><ShieldCheck size={15} /> GUARDIAN ACCESS REQUIRED</> : isAcknowledged ? <><Check size={15} /> ACKNOWLEDGED · DISPATCHING</> : <><ShieldCheck size={15} /> ACKNOWLEDGE &amp; DISPATCH</>}</button>
            </article>
          );
        })}
      </div>

      <div className="guardian-panel-foot"><span><i /> Secure response channel</span><span>{DEMO_MODE ? 'DEMO MODE' : role === 'guardian' ? 'GUARDIAN' : 'PUBLIC'}</span></div>
    </aside>
  );
}
