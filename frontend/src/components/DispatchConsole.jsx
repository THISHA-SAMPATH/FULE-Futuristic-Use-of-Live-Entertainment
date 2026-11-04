import { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { Activity, ArrowLeft, BadgeCheck, Check, Clock3, MapPin, Radio, ShieldAlert, Siren, TriangleAlert, Truck } from 'lucide-react';
import { API_URL } from '../config.js';
import { twitchPlayerUrl } from '../streamAccess.js';
import './DispatchConsole.css';

const TOKEN_KEY = 'fuleGuardianToken';
const activeDispatch = (incident) => incident?.dispatch_record && !['RESOLVED', 'STAND_DOWN'].includes(incident.dispatch_stage);

export default function DispatchConsole() {
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState({});
  const [connection, setConnection] = useState('connecting');
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState('');
  const demoMode = import.meta.env.VITE_DEMO_MODE === 'true';
  const token = sessionStorage.getItem(TOKEN_KEY) || '';

  useEffect(() => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    fetch(`${API_URL}/api/dispatch/queue`, { headers, credentials: 'include' }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load dispatch queue.');
      setIncidents(data.incidents || []); setError('');
    }).catch((requestError) => setError(requestError.message)).finally(() => setLoading(false));
    const socket = io(API_URL, { transports: ['websocket', 'polling'], auth: { guardianToken: token } });
    socket.on('connect', () => setConnection('online'));
    socket.on('disconnect', () => setConnection('offline'));
    socket.on('connect_error', () => setConnection('offline'));
    const upsert = (incident) => setIncidents((current) => [incident, ...current.filter((item) => item.incident_id !== incident.incident_id)]);
    for (const event of ['dispatch_queued', 'dispatch_sent', 'dispatch_acknowledged', 'dispatch_status_updated', 'incident_escalated', 'incident_updated']) socket.on(event, upsert);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearInterval(timer); socket.disconnect(); };
  }, [token]);

  const queue = useMemo(() => incidents.filter(activeDispatch), [incidents]);
  async function act(incident, action) {
    setBusy((current) => ({ ...current, [incident.incident_id]: action })); setError('');
    try {
      const response = await fetch(`${API_URL}/api/dispatch/${encodeURIComponent(incident.incident_id)}/action`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ action })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Dispatch status could not be updated.');
      setIncidents((current) => [result.incident, ...current.filter((item) => item.incident_id !== result.incident.incident_id)]);
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy((current) => ({ ...current, [incident.incident_id]: '' })); }
  }
  async function copySummary(incident) {
    const text = `${incident.threat_level} safety incident. ${incident.summary} Address: ${incident.location?.address || 'unavailable'}. Coordinates: ${incident.location?.lat}, ${incident.location?.lng}. Incident ID: ${incident.incident_id}.`;
    try { await navigator.clipboard.writeText(text); setCopied(incident.incident_id); window.setTimeout(() => setCopied(''), 1800); }
    catch { setError('Clipboard access is unavailable. Select the summary text to copy it.'); }
  }
  function since(iso) { const seconds = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000)); return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`; }

  return <main className="dispatch-console" data-demo={demoMode}>
    <header className="dispatch-topbar"><a href="/" className="dispatch-back"><ArrowLeft size={16}/>FULE Network</a><div className="dispatch-title"><span className="dispatch-live"><i/>CONTROL ROOM LIVE</span><h1>Emergency Dispatch</h1></div><span className="dispatch-connection"><i className={connection === 'online' ? 'on' : ''}/>{connection}</span></header>
    <div className="dispatch-warning"><ShieldAlert size={16}/><strong>{demoMode ? 'SIMULATED DISPATCH' : 'AUTHORIZED DISPATCH VIEW'}</strong><span>{demoMode ? 'Demo only · no emergency authority is contacted.' : 'Incident details are restricted to verified responders.'}</span></div>
    {error && <div className="dispatch-error" role="alert"><TriangleAlert size={16}/>{error}</div>}
    <section className="dispatch-queue-heading"><div><span>LIVE INCIDENT QUEUE</span><h2>Incoming reports <b>{queue.length}</b></h2></div><span className="dispatch-clock"><Clock3 size={15}/>{new Date(now).toLocaleTimeString()}</span></section>
    {loading ? <div className="dispatch-empty"><Activity size={23}/><strong>Loading secure queue…</strong></div> : !queue.length ? <div className="dispatch-empty"><Radio size={24}/><strong>Queue clear</strong><span>New escalations appear here in real time.</span></div> : <section className="dispatch-grid">{queue.map((incident) => {
      const exactMap = Number.isFinite(incident.location?.lat) && Number.isFinite(incident.location?.lng) ? `https://maps.google.com/?q=${incident.location.lat},${incident.location.lng}` : null;
      const playerUrl = twitchPlayerUrl(incident.stream_url, window.location.hostname);
      const sent = ['SENT', 'ACKNOWLEDGED'].includes(incident.dispatch_record?.status);
      return <article className={`dispatch-card severity-${incident.threat_level.toLowerCase()}`} key={incident.incident_id}>
        <div className="dispatch-card-head"><span className={`dispatch-severity ${incident.threat_level.toLowerCase()}`}><i/>{incident.threat_level}</span><span className="dispatch-id">{incident.incident_id}</span><time>{since(incident.created_at)} ago</time></div>
        <div className="dispatch-report-title"><Siren size={19}/><div><strong>{incident.module.replaceAll('_', ' ')} · {incident.source.toUpperCase()}</strong><small>{incident.streamer_contact?.display_name || incident.streamer_contact?.twitch_login || 'Streamer'} · {incident.status.replaceAll('_', ' ')}</small></div></div>
        <p className="dispatch-summary">{incident.summary}</p>
        <div className="dispatch-location"><MapPin size={16}/><span><strong>{incident.location?.address || 'Address unavailable'}</strong><small>{incident.location?.lat ?? '—'}, {incident.location?.lng ?? '—'}</small></span>{exactMap && <a href={exactMap} target="_blank" rel="noreferrer">MAP PIN</a>}</div>
        <div className="dispatch-eta"><Truck size={15}/><span>Response ETA</span><strong>{incident.dispatch_record?.responder_eta_minutes != null ? `${incident.dispatch_record.responder_eta_minutes} min` : 'Awaiting provider'}</strong><span className="dispatch-provider-state">{incident.dispatch_record?.status || 'QUEUED'}</span></div>
        {incident.transcript_snippet && <details className="dispatch-transcript"><summary>Transcript snippet</summary><p>{incident.transcript_snippet}</p></details>}
        {incident.clip_url && <a className="dispatch-evidence" href={incident.clip_url} target="_blank" rel="noreferrer"><BadgeCheck size={15}/>Clip evidence</a>}
        {playerUrl ? <iframe className="dispatch-player" src={playerUrl} title={`Live stream for ${incident.incident_id}`} allow="autoplay; fullscreen" allowFullScreen/> : <div className="dispatch-stream-placeholder"><Radio size={16}/>No live stream available</div>}
        <div className="dispatch-operator-read"><strong>Operator summary</strong><p>{incident.summary} Address: {incident.location?.address || 'unavailable'}.</p><button onClick={() => copySummary(incident)}>{copied === incident.incident_id ? <Check size={14}/> : null}{copied === incident.incident_id ? 'Copied' : 'Copy summary to read'}</button><a href="tel:112"><Siren size={14}/>Call 112</a></div>
        <div className="dispatch-card-actions">
          {!sent && <button onClick={() => act(incident, 'ACCEPT')} disabled={Boolean(busy[incident.incident_id])}>{busy[incident.incident_id] === 'ACCEPT' ? 'Accepting…' : 'Accept'}</button>}
          {sent && incident.dispatch_stage !== 'EN_ROUTE' && <button onClick={() => act(incident, 'EN_ROUTE')} disabled={Boolean(busy[incident.incident_id])}>{busy[incident.incident_id] === 'EN_ROUTE' ? 'Updating…' : 'En route'}</button>}
          {sent && <button className="resolved" onClick={() => act(incident, 'RESOLVED')} disabled={Boolean(busy[incident.incident_id])}>{busy[incident.incident_id] === 'RESOLVED' ? 'Resolving…' : 'Resolved'}</button>}
          {sent && <button className="stand-down" onClick={() => act(incident, 'STAND_DOWN')} disabled={Boolean(busy[incident.incident_id])}>Stand down</button>}
        </div>
      </article>;
    })}</section>}
    <footer className="dispatch-footer">FULE · Emergency services are the authority of record. Use the direct 112 call action when immediate assistance is required.</footer>
  </main>;
}
