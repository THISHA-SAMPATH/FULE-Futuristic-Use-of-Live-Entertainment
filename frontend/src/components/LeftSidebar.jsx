import { ClipboardList, House, Radio, Shield } from 'lucide-react';

const LINKS = [
  { label: 'Home', icon: House, href: '#home' },
  { label: 'Active Guardians', icon: Shield, href: '#guardians' },
  { label: 'SOS Feeds', icon: Radio, href: '#feeds' },
  { label: 'Emergency Logs', icon: ClipboardList, href: '#logs' },
];

export default function LeftSidebar({ connection, role }) {
  const guardianOnline = connection === 'online' && role === 'guardian';
  return <aside className="left-sidebar" aria-label="FULE navigation">
    <div className="sidebar-section-label">WORKSPACE</div>
    <nav className="sidebar-nav">{LINKS.map(({ label, icon: Icon, href }) => <a href={href} key={label}><Icon size={17}/><span>{label}</span>{label === 'Active Guardians' && <i className={`presence-dot ${guardianOnline ? 'online' : ''}`} aria-label={guardianOnline ? 'Guardian connection active' : 'Guardian connection inactive'}/>}</a>)}</nav>
    <div className="sidebar-presence" id="guardians"><span className={`presence-dot ${guardianOnline ? 'online' : ''}`}/><span><strong>Guardian connection</strong><small>{role === 'guardian' ? guardianOnline ? 'Verified · connected' : 'Verified · reconnecting' : 'Guardian access required'}</small></span></div>
    <div className="sidebar-footer"><span className="sidebar-live-dot"/>LIVE SAFETY NETWORK</div>
  </aside>;
}
