import { useState } from 'react';
import { Check, Clock3, Copy, PhoneCall, Radio, ShieldCheck, UsersRound } from 'lucide-react';
import './DispatchTimeline.css';

export function DispatchTimeline({ incident }) {
  if (!incident) return null;
  const acknowledged = incident.status === 'ACKNOWLEDGED' || Boolean(incident.acknowledged_by);
  const dispatchStatus = incident.dispatch_record?.status;
  const dispatched = ['SENT', 'ACKNOWLEDGED'].includes(dispatchStatus);
  const resolved = incident.status === 'RESOLVED' || incident.dispatch_stage === 'RESOLVED';
  const stoodDown = incident.dispatch_stage === 'STAND_DOWN';
  const steps = [
    { label: 'Alerted', done: true, icon: Radio },
    { label: 'Guardians', done: acknowledged, current: !acknowledged && !dispatched, icon: ShieldCheck },
    { label: 'Contacts', done: Boolean(incident.contacts_notified_at), current: !incident.contacts_notified_at && !acknowledged && !dispatched, icon: UsersRound },
    { label: 'Police dispatched', done: dispatched, failed: dispatchStatus === 'FAILED', current: dispatchStatus === 'QUEUED', icon: PhoneCall },
    { label: 'En route', done: incident.dispatch_stage === 'EN_ROUTE' || resolved, current: dispatched && incident.dispatch_stage !== 'EN_ROUTE' && !resolved && !stoodDown, icon: Clock3 },
    { label: resolved ? 'Resolved' : stoodDown ? 'Stood down' : 'Active response', done: resolved || stoodDown, current: !resolved && !stoodDown, icon: Check }
  ];
  return <ol className="dispatch-timeline" aria-label="Live emergency response timeline">{steps.map(({ label, done, current, failed, icon: Icon }) => <li key={label} className={`${done ? 'done' : ''} ${current ? 'current' : ''} ${failed ? 'failed' : ''}`}><span className="timeline-dot"><Icon size={12}/></span><span>{label}</span></li>)}</ol>;
}

export function OperatorBrief({ incident, compact = false, privateLocation = false }) {
  const [copied, setCopied] = useState(false);
  if (!incident) return null;
  const address = incident.location?.address || 'Address unavailable';
  const hasExactPin = privateLocation && Number.isFinite(incident.location?.lat) && Number.isFinite(incident.location?.lng);
  const brief = `${incident.threat_level} safety incident. ${incident.summary} Address: ${address}.${hasExactPin ? ` Coordinates: ${incident.location.lat}, ${incident.location.lng}.` : ''} Incident ID: ${incident.incident_id}.`;
  async function copy() {
    try { await navigator.clipboard.writeText(brief); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
    catch { setCopied(false); }
  }
  return <section className={`operator-brief ${compact ? 'compact' : ''}`} aria-label="Incident summary for emergency services"><div><strong>Read this to the 112 operator</strong><p>{brief}</p></div><div className="operator-brief-actions"><a href="tel:112" aria-label="Call emergency services at 112"><PhoneCall size={14}/>Call 112</a><button onClick={copy} aria-label="Copy incident summary"><Copy size={13}/>{copied ? 'Copied' : 'Copy summary'}</button></div></section>;
}
