import { Bell, Search, ShieldAlert } from 'lucide-react';
import { API_URL } from '../config.js';
import HoldSosButton from './HoldSosButton.jsx';
import { CategoryChips } from './CommunitySections.jsx';

export default function Header({ search, onSearch, onTrigger, onOpenAlerts, alertsOpen = false, sending, active, user, unreadCount, demoMode = false, category, onCategorySelect }) {
  return <header className="top-header">
    <div className="header-brand"><a className="fule-logo" href="#home" aria-label="FULE home"><span className="fule-mark">F</span><span>FULE</span></a></div>
    <div className="header-category-wrap"><CategoryChips selected={category} onSelect={onCategorySelect}/></div>
    <label className="top-search"><Search size={17} aria-hidden="true"/><input aria-label="Search safety streams and alerts" placeholder="Search streams, guardians, alerts" value={search} onChange={(event) => onSearch(event.target.value)}/><kbd>/</kbd></label>
    <div className="header-actions">
      <HoldSosButton className="header-sos" onTrigger={onTrigger} disabled={sending || active} label={active ? 'SOS active' : 'Hold to start live SOS'}><ShieldAlert size={17}/><span className="header-sos-label-desktop">{sending ? 'Starting…' : active ? 'SOS active' : 'Start live SOS'}</span><span className="header-sos-label-mobile">{sending ? 'Sending' : active ? 'Active' : 'SOS'}</span></HoldSosButton>
      {!active && unreadCount === 0 && <span className="all-clear-chip" aria-label="All clear"><i/>All clear</span>}
      <button className="notification-button" onClick={onOpenAlerts} aria-label={`${unreadCount} unread emergency alerts`} aria-haspopup="dialog" aria-expanded={alertsOpen}><Bell size={18}/>{unreadCount > 0 && <span>{unreadCount > 9 ? '9+' : unreadCount}</span>}</button>
      {user ? <button className="profile-button" aria-label={`Connected Twitch channel ${user.login}`} title={user.login}>{user.profile_image_url ? <img src={user.profile_image_url} alt="" referrerPolicy="no-referrer"/> : <span className="profile-avatar-fallback">{user.login.slice(0, 1).toUpperCase()}</span>}<span className="profile-name">{user.login}</span></button> : <a className="connect-twitch" href={`${API_URL}/auth/twitch`}><span className="connect-label-desktop">Connect Twitch</span><span className="connect-label-mobile">Connect</span></a>}
    </div>
  </header>;
}
