import { useState } from 'react';
import { Bell, Bookmark, Clapperboard, Compass, House, ShieldCheck, ChevronDown, BadgeCheck, Siren } from 'lucide-react';
import { DEMO_GUARDIANS } from '../demo/seedData.js';
import HoldSosButton from './HoldSosButton.jsx';

const LINKS = [
  { name: 'Home', href: '#home', icon: House },
  { name: 'My Guardians', href: '#guardians', icon: ShieldCheck },
  { name: 'Active Alerts', href: '#alerts', icon: Bell, alert: true },
  { name: 'Saved Evidence', href: '#alerts', icon: Bookmark, alert: true },
  { name: 'My Clips', href: '#streams', icon: Clapperboard, insights: true },
  { name: 'Explore Communities', href: '#categories', icon: Compass },
  { name: 'Police Control Room', href: '/dispatch', icon: Siren },
];
const COMMUNITIES = [
  { initials: 'WS', name: "Women's Safety Network", members: '2.4k', color: 'community-coral' },
  { initials: 'NC', name: 'Night Commute Crew', members: '1.8k', color: 'community-navy' },
  { initials: 'CW', name: 'Campus Watch', members: '980', color: 'community-green' },
];

export default function Sidebar({ connection, role, demoMode = false, unreadCount = 0, incidents = [], onOpenAlerts, onOpenInsights, onTrigger, sending = false, active = false }) {
  const [showMore, setShowMore] = useState(false);
  const guardianOnline = demoMode || (connection === 'online' && role === 'guardian');
  const navigate = (event, link) => {
    if (link.alert) { event.preventDefault(); onOpenAlerts?.(); }
    else if (link.insights) { event.preventDefault(); onOpenInsights?.(); }
  };
  return <>
    <aside className="sidebar" aria-label="Main navigation">
      <a className="sidebar-logo" href="#home" aria-label="FULE home">F</a>
      <HoldSosButton className="sidebar-sos" onTrigger={onTrigger} disabled={sending || active} label="Hold to trigger SOS"><Siren size={17}/><span>Start SOS</span></HoldSosButton>
      <nav className="sidebar-nav">{LINKS.map(({ name, href, icon: Icon, alert }) => <a key={name} href={href} className={`rail-link ${name === 'Home' ? 'selected' : ''}`} title={name} aria-label={name} onClick={(event) => navigate(event, { alert })}><Icon size={19}/><span>{name}</span>{name === 'Active Alerts' && unreadCount > 0 && <b className="sidebar-unread">{unreadCount > 9 ? '9+' : unreadCount}</b>}</a>)}</nav>
      <section className="sidebar-group" id="communities"><h2>Communities</h2>{demoMode ? <>{(showMore ? COMMUNITIES : COMMUNITIES.slice(0, 2)).map((community) => <a className="sidebar-community" href="#categories" key={community.name}><span className={`sidebar-community-avatar ${community.color}`}>{community.initials}</span><span className="sidebar-community-copy"><strong>{community.name}</strong><small>{community.members} members</small></span><i aria-label="Verified community" title="Verified community">✓</i></a>)}<button className="sidebar-show-more" onClick={() => setShowMore((value) => !value)}>{showMore ? 'Show less' : 'Show more'} <ChevronDown size={14}/></button></> : <span className="sidebar-empty">Communities will appear as they connect.</span>}</section>
      <section className="sidebar-group guardians-online" id="guardians"><h2>Guardians online <span>{guardianOnline ? '•' : ''}</span></h2>{(demoMode ? DEMO_GUARDIANS.slice(0, 3) : []).map((guardian) => <div className="sidebar-guardian" key={guardian.id}><span className="sidebar-guardian-avatar">{guardian.initials}<i><BadgeCheck size={11}/></i></span><span className="sidebar-community-copy"><strong>{guardian.name}</strong><small>{guardian.response} response</small></span></div>)}{!demoMode && <span className="sidebar-empty">Verified responders appear here</span>}</section>
      <section className="sidebar-group incident-rail" aria-labelledby="active-incidents-title"><h2 id="active-incidents-title">Active incidents</h2>{incidents.filter((incident) => ['PENDING_DISPATCH','DISPATCHING','ACKNOWLEDGED','ESCALATED'].includes(incident.status)).slice(0, 3).map((incident) => { const elapsed = Math.max(0, Date.now() - Date.parse(incident.created_at || Date.now())); const remaining = Math.max(0, 100 - (elapsed / 60_000) * 100); return <button className="incident-rail-card" key={incident.incident_id} onClick={onOpenAlerts}><span className="incident-rail-ring" style={{ '--timer-progress': remaining }} aria-hidden="true"/><span><strong>{incident.incident_type || 'Safety alert'}</strong><small>{incident.location?.address || 'Nearby area'} · {new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit'}).format(new Date(incident.created_at))}</small></span></button>;})}{!incidents.some((incident) => ['PENDING_DISPATCH','DISPATCHING','ACKNOWLEDGED','ESCALATED'].includes(incident.status)) && <span className="sidebar-empty">No active incidents</span>}</section>
      <span className={`sidebar-connection ${guardianOnline ? 'on' : ''}`} title={guardianOnline ? 'Guardian network online' : 'Guardian network disconnected'} aria-label={guardianOnline ? 'Guardian network online' : 'Guardian network disconnected'}/>
    </aside>
    <nav className="mobile-tabbar" aria-label="Mobile navigation">{LINKS.slice(0, 4).map(({ name, href, icon: Icon, alert }) => <a key={name} href={href} aria-label={name} onClick={(event) => navigate(event, { alert })}><Icon size={20}/><span>{name === 'Active Alerts' ? 'Alerts' : name === 'My Guardians' ? 'Guardians' : name}</span>{name === 'Active Alerts' && unreadCount > 0 && <i/>}</a>)}</nav>
  </>;
}
