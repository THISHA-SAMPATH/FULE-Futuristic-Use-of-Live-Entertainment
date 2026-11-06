import { BadgeCheck, BookHeart, Compass, FileClock, HeartHandshake, House, MapPinned, ShieldCheck, UsersRound } from 'lucide-react';
import { DEMO_GUARDIANS } from '../demo/seedData.js';
import FuleLogo from './FuleLogo.jsx';
import HoldSosButton from './HoldSosButton.jsx';

const NAV_GROUPS = [
  { label: 'Overview', links: [{ name: 'Home', href: '#/home', icon: House }] },
  { label: 'Safety', links: [
    { name: 'Safe Walk', href: '#/walk', icon: MapPinned },
    { name: 'My Circle', href: '#/circle', icon: HeartHandshake },
    { name: 'Privacy', href: '#/privacy', icon: ShieldCheck },
    { name: 'Evidence', href: '#/evidence', icon: BookHeart },
    { name: 'Activity', href: '#/activity', icon: FileClock },
  ] },
  { label: 'Community', links: [{ name: 'Community', href: '#/community', icon: Compass }] },
];
const MOBILE_LINKS = [
  { name: 'Home', href: '#/home', icon: House },
  { name: 'Walk', href: '#/walk', icon: MapPinned },
  { name: 'Circle', href: '#/circle', icon: UsersRound },
  { name: 'Community', href: '#/community', icon: Compass },
];
const COMMUNITIES = [
  { initials: 'WS', name: "Women's Safety", color: 'community-coral' },
  { initials: 'NC', name: 'Night Commute', color: 'community-navy' },
  { initials: 'CW', name: 'Campus Watch', color: 'community-green' },
];

export default function Sidebar({ connection, role, demoMode = false, unreadCount = 0, incidents = [], route = 'home', onOpenAlerts, onTrigger, sending, active }) {
  const guardianOnline = demoMode || (connection === 'online' && role === 'guardian');
  const links = NAV_GROUPS.flatMap(({ links: groupLinks }) => groupLinks);
  return <>
    <aside className="sidebar app-rail" aria-label="Main navigation">
      <a className="sidebar-logo" href="#/home" aria-label="Fule home"><FuleLogo compact/><span className="rail-wordmark">Fule</span></a>
      <nav className="sidebar-nav">{NAV_GROUPS.map(({ label, links: groupLinks }) => <section className="sidebar-nav-group" key={label} aria-label={label}><span className="sidebar-section-label">{label}</span>{groupLinks.map(({ name, href, icon: Icon, alert }) => <a key={name} href={href} className={`rail-link ${route === href.slice(2) ? 'selected' : ''}`} title={name} aria-label={name} aria-current={route === href.slice(2) ? 'page' : undefined} onClick={alert ? (event) => { event.preventDefault(); onOpenAlerts?.(); } : undefined}><Icon size={19} strokeWidth={1.8}/><span className="rail-label">{name}</span>{alert && unreadCount > 0 && <b className="sidebar-unread">{unreadCount > 9 ? '9+' : unreadCount}</b>}</a>)}</section>)}</nav>
      <div className="rail-communities"><section className="sidebar-group"><h2>Communities</h2>{demoMode ? COMMUNITIES.slice(0, 2).map((community) => <a className="sidebar-community" href="#/community" key={community.name}><span className={`sidebar-community-avatar ${community.color}`}>{community.initials}</span><span className="sidebar-community-copy"><strong>{community.name}</strong><small>Community preview</small></span></a>) : <span className="sidebar-empty">Communities appear here when available.</span>}</section>
      <section className="sidebar-group guardians-online"><h2>Guardians online <span>{guardianOnline ? '•' : ''}</span></h2>{demoMode ? DEMO_GUARDIANS.slice(0, 2).map((guardian) => <div className="sidebar-guardian" key={guardian.id}><span className="sidebar-guardian-avatar">{guardian.initials}<i><BadgeCheck size={11}/></i></span><span className="sidebar-community-copy"><strong>{guardian.name}</strong><small>Responder profile</small></span></div>) : <span className="sidebar-empty">Verified responders appear here.</span>}</section></div>
      <section className="sidebar-group incident-rail" aria-labelledby="active-incidents-title"><h2 id="active-incidents-title">Active incidents</h2>{incidents.filter((incident) => ['PENDING_DISPATCH','DISPATCHING','ACKNOWLEDGED','ESCALATED'].includes(incident.status)).slice(0, 3).map((incident) => { const elapsed = Math.max(0, Date.now() - Date.parse(incident.created_at || Date.now())); const remaining = Math.max(0, 100 - elapsed / 60_000 * 100); return <button className="incident-rail-card" key={incident.incident_id} onClick={onOpenAlerts} title="Open incident alerts"><span className="incident-rail-ring" style={{ '--timer-progress': remaining }} aria-hidden="true"/><span><strong>{incident.incident_type || 'Safety alert'}</strong><small>{incident.location?.address || 'Nearby area'}</small></span></button>; })}{!incidents.some((incident) => ['PENDING_DISPATCH','DISPATCHING','ACKNOWLEDGED','ESCALATED'].includes(incident.status)) && <span className="sidebar-empty">No active incidents</span>}</section>
      <span className={`sidebar-connection ${guardianOnline ? 'on' : ''}`} title={guardianOnline ? 'Guardian network online' : 'Guardian network disconnected'} aria-label={guardianOnline ? 'Guardian network online' : 'Guardian network disconnected'}/>
    </aside>
    <nav className="mobile-tabbar app-bottom-nav" aria-label="Mobile navigation">{MOBILE_LINKS.slice(0, 2).map(({ name, href, icon: Icon }) => <a key={name} href={href} aria-label={name} aria-current={route === href.slice(2) ? 'page' : undefined}><Icon size={20}/><span>{name}</span></a>)}<HoldSosButton className="mobile-sos-control" onTrigger={onTrigger} disabled={sending || active} label={active ? 'An SOS incident is active' : 'Press and hold to trigger emergency SOS'}><span aria-hidden="true">SOS</span></HoldSosButton>{MOBILE_LINKS.slice(2).map(({ name, href, icon: Icon }) => <a key={name} href={href} aria-label={name} aria-current={route === href.slice(2) ? 'page' : undefined}><Icon size={20}/><span>{name}</span></a>)}</nav>
  </>;
}
