import { Bell, Search, ShieldAlert } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { API_URL } from '../config.js';
import { createSosClickHandler } from '../sosFlow.js';

export default function Header({ search, onSearch, onTrigger, sending, active, user, unreadCount, demoMode = false }) {
  const reduceMotion = useReducedMotion();
  return <header className="top-header">
    <div className="header-brand"><a className="fule-logo" href="#home" aria-label="FULE home"><span className="fule-mark">F</span><span>FULE</span></a>{demoMode && <span className="demo-mode-badge header-demo-badge">DEMO MODE</span>}</div>
    <label className="top-search"><Search size={17} aria-hidden="true"/><input aria-label="Search safety streams and alerts" placeholder="Search streams, guardians, alerts" value={search} onChange={(event) => onSearch(event.target.value)}/><kbd>/</kbd></label>
    <div className="header-actions">
      <a className="notification-button" href="#alerts" aria-label={`${unreadCount} unread emergency alerts`}><Bell size={18}/>{unreadCount > 0 && <span>{unreadCount > 9 ? '9+' : unreadCount}</span>}</a>
      <motion.button className="header-sos" onClick={createSosClickHandler(onTrigger)} disabled={sending || active} aria-label="Start live SOS" animate={reduceMotion || active ? undefined : { boxShadow: ['0 0 0 0 #ff3b3030', '0 0 0 8px #ff3b3000'] }} transition={{ duration: 1.5, repeat: Infinity, ease: 'easeOut' }}><ShieldAlert size={17}/>{sending ? 'STARTING…' : active ? 'SOS ACTIVE' : 'START LIVE SOS'}</motion.button>
      {user ? <button className="profile-button" aria-label={`Connected Twitch channel ${user.login}`} title={user.login}>{user.profile_image_url ? <img src={user.profile_image_url} alt="" referrerPolicy="no-referrer"/> : <span className="profile-avatar-fallback">{user.login.slice(0, 1).toUpperCase()}</span>}<span className="profile-name">{user.login}</span></button> : <a className="connect-twitch" href={`${API_URL}/auth/twitch`}><span className="connect-label-desktop">Connect Twitch</span><span className="connect-label-mobile">Connect</span></a>}
    </div>
  </header>;
}
