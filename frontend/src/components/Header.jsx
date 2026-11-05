import { useRef, useState } from 'react';
import { Bell, Search, ShieldAlert } from 'lucide-react';
import HoldSosButton from './HoldSosButton.jsx';

export default function Header({ search, onSearch, onTrigger, onOpenAlerts, alertsOpen = false, sending, active, account, unreadCount, demoMode = false }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const inputRef = useRef(null);
  function openSearch() {
    setSearchOpen(true);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }
  return <header className="top-header">
    <div className="page-heading"><h1>Home</h1><p>Your safety circle, close at hand.</p></div>
    <label className={`top-search ${searchOpen ? 'is-open' : ''}`}><button type="button" className="search-toggle" onClick={openSearch} aria-label="Open search"><Search size={17}/></button><input ref={inputRef} aria-label="Search guardians, communities, alerts" placeholder="Search guardians, communities, alerts" value={search} onChange={(event) => onSearch(event.target.value)} onBlur={() => { if (!search) setSearchOpen(false); }}/><kbd>/</kbd></label>
    <div className="header-actions">
      <HoldSosButton className="header-sos" onTrigger={onTrigger} disabled={sending || active} label={active ? 'SOS active' : 'Hold to start live SOS'}><ShieldAlert size={16}/><span className="header-sos-label-desktop">{sending ? 'Starting…' : active ? 'SOS active' : 'SOS'}</span><span className="header-sos-label-mobile">{sending ? 'Sending' : active ? 'Active' : 'SOS'}</span></HoldSosButton>
      <button className="notification-button" onClick={onOpenAlerts} aria-label={`${unreadCount} unread emergency alerts`} aria-haspopup="dialog" aria-expanded={alertsOpen}><Bell size={18}/>{unreadCount > 0 && <span>{unreadCount > 9 ? '9+' : unreadCount}</span>}</button>
      {account ? <button className="profile-button" aria-label={`Signed in as ${account.email}`} title={account.email}><span className="profile-avatar-fallback">{account.email.slice(0, 1).toUpperCase()}</span></button> : <span className="profile-button profile-guest" aria-label="Guest profile"><span className="profile-avatar-fallback">F</span></span>}
      {demoMode && <span className="header-demo-badge">Demo</span>}
    </div>
  </header>;
}
