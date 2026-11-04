import { Bell, Search, ShieldAlert } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import { API_URL } from '../config.js';
import { createSosClickHandler } from '../sosFlow.js';

export default function Header({ search, onSearch, onTrigger, onOpenAlerts, alertsOpen = false, sending, active, user, unreadCount, demoMode = false }) {
  const reduceMotion = useReducedMotion();
  return <header className="top-header">
    <div className="header-brand"><a className="fule-logo" href="#home" aria-label="FULE home"><span className="fule-mark">F</span><span>FULE</span></a></div>
    <label className="top-search"><Search size={17} aria-hidden="true"/><input aria-label="Search safety streams and alerts" placeholder="Search streams, guardians, alerts" value={search} onChange={(event) => onSearch(event.target.value)}/><kbd>/</kbd></label>
    <div className="header-actions">
      <motion.button className="header-sos" onClick={createSosClickHandler(onTrigger)} disabled={sending || active} aria-label={active ? 'SOS active' : 'Start live SOS'} animate={reduceMotion || active ? undefined : { boxShadow: ['0 0 0 0 #ff3b3030', '0 0 0 8px #ff3b3000'] }} transition={{ duration: 1.5, repeat: Infinity, ease: 'easeOut' }}><ShieldAlert size={17}/><span className="header-sos-label-desktop">{sending ? 'STARTING…' : active ? 'SOS ACTIVE' : 'START LIVE SOS'}</span><span className="header-sos-label-mobile">{sending ? 'Sending' : active ? 'Active' : 'SOS'}</span></motion.button>
      {!active && unreadCount === 0 && <span className="all-clear-chip" aria-label="All clear"><i/>All clear</span>}
      <button className="notification-button" onClick={onOpenAlerts} aria-label={`${unreadCount} unread emergency alerts`} aria-haspopup="dialog" aria-expanded={alertsOpen}><Bell size={18}/>{unreadCount > 0 && <span>{unreadCount > 9 ? '9+' : unreadCount}</span>}</button>
      {user ? <button className="profile-button" aria-label={`Connected Twitch channel ${user.login}`} title={user.login}>{user.profile_image_url ? <img src={user.profile_image_url} alt="" referrerPolicy="no-referrer"/> : <span className="profile-avatar-fallback">{user.login.slice(0, 1).toUpperCase()}</span>}<span className="profile-name">{user.login}</span></button> : <a className="connect-twitch" href={`${API_URL}/auth/twitch`}><span className="connect-label-desktop">Connect Twitch</span><span className="connect-label-mobile">Connect</span></a>}
    </div>
  </header>;
}
