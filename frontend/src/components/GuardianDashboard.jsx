import { useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { Activity, ArrowUpRight, Check, Clock3, MapPin, Radio, ShieldCheck } from 'lucide-react';
import './GuardianDashboard.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export default function GuardianDashboard({ search = '' }) {
  const [alerts, setAlerts] = useState([]);
  const [connection, setConnection] = useState('connecting');
  const [acknowledged, setAcknowledged] = useState({});
  const socketRef = useRef(null);

  useEffect(() => {
    const socket = io(API_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;
    socket.on('connect', () => setConnection('online'));
    socket.on('disconnect', () => setConnection('offline'));
    socket.on('sos:alert', (alert) => setAlerts((current) => [alert, ...current].slice(0, 8)));
    socket.on('incident:acknowledged', ({ incidentId }) => setAcknowledged((current) => ({ ...current, [incidentId]: true })));
    return () => socket.disconnect();
  }, []);

  const visibleAlerts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return alerts;
    return alerts.filter((alert) => [
      alert.incidentSummary?.summary,
      alert.incidentSummary?.incident_type,
      alert.incidentSummary?.location_coords,
      alert.victimStatus,
      alert.liveStreamUrl
    ].some((value) => String(value || '').toLowerCase().includes(query)));
  }, [alerts, search]);

  function acknowledge(id) {
    socketRef.current?.emit('incident:acknowledge', id);
    setAcknowledged((current) => ({ ...current, [id]: true }));
  }

  return (
    <aside className="guardian-panel" id="dispatch" aria-label="Guardian alarm dashboard">
      <div className="guardian-panel-header">
        <div><div className="guardian-overline"><Radio size={13} /> GUARDIAN COMMAND</div><h2>Incoming alarms</h2></div>
        <div className={`guardian-connection ${connection}`}><i />{connection === 'online' ? 'LIVE' : connection === 'offline' ? 'RECONNECTING' : 'CONNECTING'}</div>
      </div>

      <div className="alarm-summary"><span className="alarm-summary-icon"><Activity size={16} /></span><span><strong>{alerts.length ? `${alerts.length} active ${alerts.length === 1 ? 'incident' : 'incidents'}` : 'Guardian watch is active'}</strong><small>Latest community safety signals</small></span><span className="alarm-count">{alerts.length.toString().padStart(2, '0')}</span></div>

      <div className="alarm-list" aria-live="polite">
        {visibleAlerts.length === 0 ? (
          <div className="guardian-empty"><span className="empty-shield"><ShieldCheck size={21} /></span><strong>{search && alerts.length ? 'No matching incidents' : 'All clear for now'}</strong><span>{search && alerts.length ? 'Try a different search term.' : 'New SOS alerts will appear here in real time.'}</span></div>
        ) : visibleAlerts.map((alert) => {
          const coords = alert.location || {};
          const lat = Number(coords.latitude);
          const lng = Number(coords.longitude);
          const coordText = alert.incidentSummary?.location_coords || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
          const mapUrl = `https://www.google.com/maps?q=${lat},${lng}`;
          const threat = alert.incidentSummary?.threat_level || 'CRITICAL';
          const isAcknowledged = Boolean(acknowledged[alert.id]);
          return (
            <article className="alarm-card" key={alert.id}>
              <div className="alarm-card-top"><span className={`threat-badge threat-${threat.toLowerCase()}`}><i />THREAT {threat}</span><time><Clock3 size={12} />{new Date(alert.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
              <div className="alarm-type">{alert.incidentSummary?.incident_type || "Women's Safety SOS"}</div>
              <p className="alarm-synthesis">{alert.incidentSummary?.summary || 'SOS received. Verify safety and location immediately.'}</p>
              <div className="alarm-location-row"><a className="location-link" href={mapUrl} target="_blank" rel="noreferrer"><MapPin size={15} /><span><small>GPS PIN</small><strong>{coordText}</strong></span><ArrowUpRight size={13} /></a>{alert.liveStreamUrl && <a className="open-feed" href={alert.liveStreamUrl} target="_blank" rel="noreferrer">OPEN FEED <ArrowUpRight size={12} /></a>}</div>
              <div className="alarm-card-meta"><span>15-SEC AI SYNTHESIS</span><span>{alert.incidentSummary?.summary_source === 'openai' ? 'OPENAI' : 'LOCAL DEMO'}</span></div>
              <button className={`acknowledge-button ${isAcknowledged ? 'acknowledged' : ''}`} onClick={() => acknowledge(alert.id)} disabled={isAcknowledged}>{isAcknowledged ? <><Check size={15} /> ACKNOWLEDGED · DISPATCHING</> : <><ShieldCheck size={15} /> ACKNOWLEDGE &amp; DISPATCH</>}</button>
            </article>
          );
        })}
      </div>

      <div className="guardian-panel-foot"><span><i /> Secure response channel</span><span>DEMO MODE</span></div>
    </aside>
  );
}
