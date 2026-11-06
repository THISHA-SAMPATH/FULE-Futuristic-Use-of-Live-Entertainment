import { useRef, useState } from 'react';
import { Bell, Search, ShieldAlert, UserRound } from 'lucide-react';
import HoldSosButton from './HoldSosButton.jsx';

const PAGE_LABELS = {
  home: ['Right now', 'Your safety circle, close at hand.'], walk: ['Safe Walk', 'A check-in plan that moves at your pace.'],
  circle: ['My Circle', 'Choose who you trust and how they can help.'], community: ['Community', 'Find local people and shared safety spaces.'],
  privacy: ['Privacy', 'See how incident details are shared.'], evidence: ['Evidence', 'Review what is available for an incident.'],
  activity: ['Activity', 'Incident updates and response history.']
};

export default function Header({ search, onSearch, onTrigger, onOpenAlerts, alertsOpen = false, sending, active, account, unreadCount, demoMode = false, route = 'home' }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const inputRef = useRef(null);
  function openSearch() {
    setSearchOpen(true);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }
  return <header className="top-header">
    <div className="page-heading"><h1>{PAGE_LABELS[route]?.[0] || 'FULE'}</h1><p>{PAGE_LABELS[route]?.[1] || 'Your safety circle, close at hand.'}</p></div>
    <label className={`top-search ${searchOpen ? 'is-open' : ''}`}><button type="button" className="search-toggle" onClick={openSearch} aria-label="Open search"><Search size={17}/></button><input ref={inputRef} aria-label="Search guardians, communities, alerts" placeholder="Search guardians, communities, alerts" value={search} onChange={(event) => onSearch(event.target.value)} onBlur={() => { if (!search) setSearchOpen(false); }}/><kbd>/</kbd></label>
    <div className="header-actions">
      <HoldSosButton className="header-sos" onTrigger={onTrigger} disabled={sending || active} label={active ? 'SOS active' : 'Hold to start live SOS'}><ShieldAlert size={16}/><span className="header-sos-label-desktop">{sending ? 'Starting…' : active ? 'SOS active' : 'SOS'}</span><span className="header-sos-label-mobile">{sending ? 'Sending' : active ? 'Active' : 'SOS'}</span></HoldSosButton>
      <button className="notification-button" onClick={onOpenAlerts} aria-label={demoMode ? 'Open prototype alerts' : `${unreadCount} unread emergency alerts`} aria-haspopup="dialog" aria-expanded={alertsOpen}><Bell size={18}/>{unreadCount > 0 && <span className={demoMode ? 'demo-indicator' : ''} aria-hidden="true">{demoMode ? '' : unreadCount > 9 ? '9+' : unreadCount}</span>}</button>
      {account ? <button className="profile-button" aria-label={`Signed in as ${account.email}`} title={account.email}><span className="profile-avatar-fallback">{account.email.slice(0, 1).toUpperCase()}</span></button> : <span className="profile-button profile-guest" aria-label="Guest profile"><UserRound size={17}/></span>}
      {demoMode && <span className="header-demo-badge">Demo</span>}
    </div>
  </header>;
}
