import { useState } from 'react';
import { Bell, Bookmark, Clapperboard, Compass, House, ShieldCheck, ChevronDown, BadgeCheck, Siren } from 'lucide-react';
import { DEMO_GUARDIANS } from '../demo/seedData.js';
import FuleLogo from './FuleLogo.jsx';

const NAV_GROUPS = [
  { label: 'Overview', links: [{ name: 'Home', href: '#home', icon: House }] },
  { label: 'Safety', links: [
    { name: 'Guardians', href: '#guardians', icon: ShieldCheck },
    { name: 'Alerts', href: '#alerts', icon: Bell, alert: true },
    { name: 'Evidence', href: '#alerts', icon: Bookmark, alert: true },
  ] },
  { label: 'Community', links: [
    { name: 'My Clips', href: '#streams', icon: Clapperboard, insights: true },
    { name: 'Communities', href: '#communities', icon: Compass },
    { name: 'Dispatch', href: '/dispatch', icon: Siren },
  ] },
];
const COMMUNITIES = [
  { initials: 'WS', name: "Women's Safety", members: '2.4k', color: 'community-coral' },
  { initials: 'NC', name: 'Night Commute', members: '1.8k', color: 'community-navy' },
  { initials: 'CW', name: 'Campus Watch', members: '980', color: 'community-green' },
];

const LINKS = NAV_GROUPS.flatMap(({ links }) => links);

export default function Sidebar({ connection, role, demoMode = false, unreadCount = 0, incidents = [], onOpenAlerts, onOpenInsights }) {
  const [showMore, setShowMore] = useState(false);
  const guardianOnline = demoMode || (connection === 'online' && role === 'guardian');
  const navigate = (event, link) => {
    if (link.alert) { event.preventDefault(); onOpenAlerts?.(); }
    else if (link.insights) { event.preventDefault(); onOpenInsights?.(); }
  };
  return <>
    <aside className="sidebar" aria-label="Main navigation">
      <a className="sidebar-logo" href="#home" aria-label="Fule home"><FuleLogo/></a>
      <nav className="sidebar-nav">{NAV_GROUPS.map(({ label, links }) => <section className="sidebar-nav-group" key={label} aria-label={label}><span className="sidebar-section-label">{label}</span>{links.map(({ name, href, icon: Icon, alert, insights }) => <a key={name} href={href} className={`rail-link ${name === 'Home' ? 'selected' : ''}`} title={name} aria-label={name} aria-current={name === 'Home' ? 'page' : undefined} onClick={(event) => navigate(event, { alert, insights })}><Icon size={18} strokeWidth={1.8}/><span>{name}</span>{name === 'Alerts' && unreadCount > 0 && <b className="sidebar-unread">{unreadCount > 9 ? '9+' : unreadCount}</b>}</a>)}</section>)}</nav>
      <section className="sidebar-group" id="communities"><h2>Communities</h2>{demoMode ? <>{(showMore ? COMMUNITIES : COMMUNITIES.slice(0, 2)).map((community) => <a className="sidebar-community" href="#categories" key={community.name}><span className={`sidebar-community-avatar ${community.color}`}>{community.initials}</span><span className="sidebar-community-copy"><strong>{community.name}</strong><small>{community.members} members</small></span><i aria-label="Verified community" title="Verified community">✓</i></a>)}<button className="sidebar-show-more" onClick={() => setShowMore((value) => !value)}>{showMore ? 'Show less' : 'Show more'} <ChevronDown size={14}/></button></> : <span className="sidebar-empty">Communities will appear as they connect.</span>}</section>
      <section className="sidebar-group guardians-online" id="guardians"><h2>Guardians online <span>{guardianOnline ? '•' : ''}</span></h2>{(demoMode ? DEMO_GUARDIANS.slice(0, 3) : []).map((guardian) => <div className="sidebar-guardian" key={guardian.id}><span className="sidebar-guardian-avatar">{guardian.initials}<i><BadgeCheck size={11}/></i></span><span className="sidebar-community-copy"><strong>{guardian.name}</strong><small>{guardian.response} response</small></span></div>)}{!demoMode && <span className="sidebar-empty">Verified responders appear here</span>}</section>
      <section className="sidebar-group incident-rail" aria-labelledby="active-incidents-title"><h2 id="active-incidents-title">Active incidents</h2>{incidents.filter((incident) => ['PENDING_DISPATCH','DISPATCHING','ACKNOWLEDGED','ESCALATED'].includes(incident.status)).slice(0, 3).map((incident) => { const elapsed = Math.max(0, Date.now() - Date.parse(incident.created_at || Date.now())); const remaining = Math.max(0, 100 - (elapsed / 60_000) * 100); return <button className="incident-rail-card" key={incident.incident_id} onClick={onOpenAlerts}><span className="incident-rail-ring" style={{ '--timer-progress': remaining }} aria-hidden="true"/><span><strong>{incident.incident_type || 'Safety alert'}</strong><small>{incident.location?.address || 'Nearby area'} · {new Intl.DateTimeFormat(undefined,{hour:'2-digit',minute:'2-digit'}).format(new Date(incident.created_at))}</small></span></button>;})}{!incidents.some((incident) => ['PENDING_DISPATCH','DISPATCHING','ACKNOWLEDGED','ESCALATED'].includes(incident.status)) && <span className="sidebar-empty">No active incidents</span>}</section>
      <span className={`sidebar-connection ${guardianOnline ? 'on' : ''}`} title={guardianOnline ? 'Guardian network online' : 'Guardian network disconnected'} aria-label={guardianOnline ? 'Guardian network online' : 'Guardian network disconnected'}/>
    </aside>
    <nav className="mobile-tabbar" aria-label="Mobile navigation">{LINKS.slice(0, 4).map(({ name, href, icon: Icon, alert, insights }) => <a key={name} href={href} aria-label={name} aria-current={name === 'Home' ? 'page' : undefined} onClick={(event) => navigate(event, { alert, insights })}><Icon size={20}/><span>{name}</span>{name === 'Alerts' && unreadCount > 0 && <i/>}</a>)}</nav>
  </>;
}
