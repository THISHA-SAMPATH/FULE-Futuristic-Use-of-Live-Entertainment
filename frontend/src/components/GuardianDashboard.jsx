import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { Activity, ArrowUpRight, Check, MapPin, Radio, ShieldCheck } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export default function GuardianDashboard() {
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

  function acknowledge(id) {
    socketRef.current?.emit('incident:acknowledge', id);
    setAcknowledged((current) => ({ ...current, [id]: true }));
  }

  return (
    <section className="dashboard">
      <div className="section-title"><div><div className="eyebrow"><Radio size={14} /> GUARDIAN NETWORK</div><h2>Safety command</h2></div><div className={`connection ${connection}`}><span /> {connection === 'online' ? 'CONNECTED' : connection === 'offline' ? 'RECONNECTING' : 'CONNECTING'}</div></div>
      <div className="dashboard-grid">
        <div className="incident-list">
          <div className="panel-heading"><div><span className="panel-kicker">LIVE INCIDENTS</span><h3>Incoming alerts <span className="count-badge">{alerts.length}</span></h3></div><span className="sort-label"><Activity size={13} /> MOST RECENT</span></div>
          {alerts.length === 0 ? <div className="empty-state"><div className="empty-symbol"><ShieldCheck size={22} /></div><strong>All clear for now</strong><span>New SOS alerts will appear here instantly.</span></div> : alerts.map((alert) => {
            const coords = alert.location || {};
            const mapUrl = `https://www.google.com/maps?q=${coords.latitude},${coords.longitude}`;
            return <article className="incident-card" key={alert.id}>
              <div className="incident-top"><span className="critical-pill"><i /> CRITICAL</span><time>{new Date(alert.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></div>
              <p className="incident-summary">{alert.incidentSummary?.summary || 'SOS received. Verify safety and location.'}</p>
              <p className="victim-status">{alert.victimStatus}</p>
              <div className="incident-meta"><a href={mapUrl} target="_blank" rel="noreferrer"><MapPin size={14} /> {Number(coords.latitude).toFixed(4)}, {Number(coords.longitude).toFixed(4)} <ArrowUpRight size={12} /></a>{alert.liveStreamUrl && <a href={alert.liveStreamUrl} target="_blank" rel="noreferrer">OPEN STREAM <ArrowUpRight size={12} /></a>}</div>
              <button className={`dispatch-button ${acknowledged[alert.id] ? 'dispatched' : ''}`} onClick={() => acknowledge(alert.id)} disabled={acknowledged[alert.id]}>{acknowledged[alert.id] ? <><Check size={16} /> ACKNOWLEDGED — DISPATCH IN PROGRESS</> : <><ShieldCheck size={16} /> ACKNOWLEDGE &amp; DISPATCH</>}</button>
            </article>;
          })}
        </div>
        <aside className="response-panel"><div className="panel-kicker">RESPONSE PROTOCOL</div><h3>Every second<br />matters.</h3><p>When an SOS arrives, connect with the person, confirm their location, then coordinate with local emergency services as appropriate.</p><div className="protocol-step"><span>01</span><div><b>ACKNOWLEDGE</b><small>Let the person know help is here</small></div></div><div className="protocol-step"><span>02</span><div><b>VERIFY LOCATION</b><small>Open the shared map pin</small></div></div><div className="protocol-step"><span>03</span><div><b>COORDINATE HELP</b><small>Use local emergency resources</small></div></div><div className="demo-note">MVP DEMO <span>Alerts and locations are simulated.</span></div></aside>
      </div>
    </section>
  );
}
