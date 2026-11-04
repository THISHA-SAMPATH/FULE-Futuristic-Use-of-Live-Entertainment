import { useState } from 'react';
import { Bell, Bookmark, Clapperboard, Compass, House, ShieldCheck, UsersRound, ChevronDown, BadgeCheck } from 'lucide-react';
import { DEMO_GUARDIANS } from '../demo/seedData.js';

const LINKS = [
  { name: 'Home', href: '#home', icon: House },
  { name: 'My Guardians', href: '#guardians', icon: ShieldCheck },
  { name: 'Active Alerts', href: '#alerts', icon: Bell, alert: true },
  { name: 'Saved Evidence', href: '#alerts', icon: Bookmark, alert: true },
  { name: 'My Clips', href: '#streams', icon: Clapperboard, insights: true },
  { name: 'Explore Communities', href: '#categories', icon: Compass },
];
const COMMUNITIES = [
  { initials: 'WS', name: "Women's Safety Network", members: '2.4k', color: 'community-coral' },
  { initials: 'NC', name: 'Night Commute Crew', members: '1.8k', color: 'community-navy' },
  { initials: 'CW', name: 'Campus Watch', members: '980', color: 'community-green' },
];

export default function Sidebar({ connection, role, demoMode = false, unreadCount = 0, onOpenAlerts, onOpenInsights }) {
  const [showMore, setShowMore] = useState(false);
  const guardianOnline = demoMode || (connection === 'online' && role === 'guardian');
  const navigate = (event, link) => {
    if (link.alert) { event.preventDefault(); onOpenAlerts?.(); }
    else if (link.insights) { event.preventDefault(); onOpenInsights?.(); }
  };
  return <>
    <aside className="sidebar" aria-label="Main navigation">
      <a className="sidebar-logo" href="#home" aria-label="FULE home">F</a>
      <nav className="sidebar-nav">{LINKS.map(({ name, href, icon: Icon, alert }) => <a key={name} href={href} className={`rail-link ${name === 'Home' ? 'selected' : ''}`} title={name} aria-label={name} onClick={(event) => navigate(event, { alert })}><Icon size={19}/><span>{name}</span>{name === 'Active Alerts' && unreadCount > 0 && <b className="sidebar-unread">{unreadCount > 9 ? '9+' : unreadCount}</b>}</a>)}</nav>
      <section className="sidebar-group" id="communities"><h2>COMMUNITIES</h2>{demoMode ? <>{(showMore ? COMMUNITIES : COMMUNITIES.slice(0, 2)).map((community) => <a className="sidebar-community" href="#categories" key={community.name}><span className={`sidebar-community-avatar ${community.color}`}>{community.initials}</span><span className="sidebar-community-copy"><strong>{community.name}</strong><small>{community.members} members</small></span><i aria-label="Verified community" title="Verified community">✓</i></a>)}<button className="sidebar-show-more" onClick={() => setShowMore((value) => !value)}>{showMore ? 'Show less' : 'Show more'} <ChevronDown size={14}/></button></> : <span className="sidebar-empty">Communities will appear as they connect.</span>}</section>
      <section className="sidebar-group guardians-online" id="guardians"><h2>GUARDIANS ONLINE <span>{guardianOnline ? '•' : ''}</span></h2>{(demoMode ? DEMO_GUARDIANS.slice(0, 3) : []).map((guardian) => <div className="sidebar-guardian" key={guardian.id}><span className="sidebar-guardian-avatar">{guardian.initials}<i><BadgeCheck size={11}/></i></span><span className="sidebar-community-copy"><strong>{guardian.name}</strong><small>{guardian.response} response</small></span></div>)}{!demoMode && <span className="sidebar-empty">Verified responders appear here</span>}</section>
      <span className={`sidebar-connection ${guardianOnline ? 'on' : ''}`} title={guardianOnline ? 'Guardian network online' : 'Guardian network disconnected'} aria-label={guardianOnline ? 'Guardian network online' : 'Guardian network disconnected'}/>
    </aside>
    <nav className="mobile-tabbar" aria-label="Mobile navigation">{LINKS.slice(0, 4).map(({ name, href, icon: Icon, alert }) => <a key={name} href={href} aria-label={name} onClick={(event) => navigate(event, { alert })}><Icon size={20}/><span>{name === 'Active Alerts' ? 'Alerts' : name === 'My Guardians' ? 'Guardians' : name}</span>{name === 'Active Alerts' && unreadCount > 0 && <i/>}</a>)}</nav>
  </>;
}
