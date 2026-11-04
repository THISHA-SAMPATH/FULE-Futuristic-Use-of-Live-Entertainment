import { Search, Siren } from 'lucide-react';
import { API_URL } from '../config.js';
import { createSosClickHandler } from '../sosFlow.js';

export default function TopHeader({ search, onSearch, onTrigger, sending, active, user }) {
  return <header className="top-header">
    <a className="fule-brand" href="#home" aria-label="FULE home"><span className="brand-symbol">F</span><span>FULE</span><small>PROTECT</small></a>
    <label className="search-box"><Search size={17} aria-hidden="true"/><input aria-label="Search emergency alerts" placeholder="Search alerts, address, or status" value={search} onChange={(e) => onSearch(e.target.value)}/><kbd>/</kbd></label>
    <div className="header-actions">
      <button className="header-sos" onClick={createSosClickHandler(onTrigger)} disabled={sending || active} aria-label="Start live SOS"><Siren size={16}/>{sending ? 'SENDING…' : active ? 'SOS ACTIVE' : 'START LIVE SOS'}</button>
      {user ? <div className="user-chip" title={user.login}><span className="user-avatar">{user.login.slice(0,1).toUpperCase()}</span><span>{user.login}</span></div> : <a className="connect-twitch" href={`${API_URL}/auth/twitch`}>Connect Twitch</a>}
    </div>
  </header>;
}
