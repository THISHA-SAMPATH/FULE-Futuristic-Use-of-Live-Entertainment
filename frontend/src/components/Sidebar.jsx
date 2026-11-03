import { Compass, House, Radio, Settings2, ShieldCheck, UsersRound } from 'lucide-react';

const LINKS = [
  { name: 'Home', href: '#home', icon: House },
  { name: 'Guardians', href: '#guardians', icon: ShieldCheck },
  { name: 'SOS Feeds', href: '#streams', icon: Radio },
  { name: 'Logs', href: '#alerts', icon: Compass },
  { name: 'Community', href: '#community', icon: UsersRound },
  { name: 'Settings', href: '#settings', icon: Settings2 },
];

export default function Sidebar({ connection, role, demoMode = false }) {
  const demoOnline = demoMode;
  const guardianOnline = connection === 'online' && role === 'guardian';
  const presenceTitle = demoOnline ? 'Simulated guardian presence' : guardianOnline ? 'Verified guardian connected' : 'Guardian connection inactive';
  return <aside className="sidebar" aria-label="Main navigation"><a className="sidebar-logo" href="#home" aria-label="FULE home">F</a><nav>{LINKS.map(({ name, href, icon: Icon }, index) => <a key={name} href={href} className={`rail-link ${index === 0 ? 'selected' : ''}`} title={name} aria-label={name}><Icon size={19}/><span className="rail-tooltip" role="tooltip">{name}</span>{name === 'Guardians' && <i className={`rail-presence ${demoOnline || guardianOnline ? 'on' : ''}`}/>}</a>)}</nav><div className={`sidebar-connection ${demoOnline || guardianOnline ? 'on' : ''}`} title={presenceTitle} aria-label={presenceTitle}/></aside>;
}
