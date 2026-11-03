import { motion, useReducedMotion } from 'framer-motion';
import { ArrowUpRight, Headphones, Radio, ShieldCheck, UsersRound } from 'lucide-react';

function FeaturedPlayer({ stream, demoMode, active }) {
  const isRealStream = Boolean(stream?.stream_url);
  const channel = stream?.stream_url?.split('/').filter(Boolean).pop();
  const player = isRealStream ? `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=${encodeURIComponent(window.location.hostname)}&muted=true` : null;
  return <div className="featured-player">
    <div className="featured-art">
      {player ? <iframe src={player} title="Featured Twitch safety stream" allow="autoplay; fullscreen" allowFullScreen/> : demoMode ? <div className={`generated-scene scene-${stream?.scene || 'violet'}`} aria-hidden="true"><span className="scene-orbit orbit-a"/><span className="scene-orbit orbit-b"/><span className="scene-tower tower-a"/><span className="scene-tower tower-b"/><span className="scene-tower tower-c"/><span className="scene-horizon"/><span className="scene-person"/></div> : <div className="featured-empty"><Radio size={26}/><strong>No featured stream</strong><span>Connect Twitch or wait for a verified community feed.</span></div>}
      <div className="player-glass"><span className={`live-pill ${demoMode || active ? 'is-live' : ''}`}><i/>{demoMode || active ? 'LIVE' : isRealStream ? 'CHANNEL' : 'OFFLINE'}</span><span className="player-caption">{stream?.title || (demoMode ? 'Community watch is live' : 'Live feed unavailable')}</span><span className="player-chapter"><Radio size={13}/>{demoMode ? 'SIMULATED FEED' : active ? 'INCIDENT FEED' : 'FEATURED CHANNEL'}</span></div>
    </div>
    <div className="player-info"><div className="player-info-top"><span className="player-avatar">{stream?.initials || 'F'}</span><span className="player-streamer"><strong>{stream?.streamer || 'FULE Community'}</strong><small>{stream?.region || 'Safety network'}</small></span><span className="player-live-count"><i/>{stream?.viewers ? stream.viewers.toLocaleString() : '—'}<small>watching</small></span></div><div className="player-stats"><span><UsersRound size={14}/>{stream?.guardians ?? '—'} guardians nearby</span><span><Headphones size={14}/>Response time <b>{demoMode ? '00:08' : '—:—'}</b></span></div></div>
  </div>;
}

export default function Hero({ onTrigger, sending, active, featuredStream, demoMode, onJoinGuardian }) {
  const reduceMotion = useReducedMotion();
  return <section className="hero-section"><motion.div className="hero-copy" initial={reduceMotion ? false : { opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55 }}>
    <div className="hero-eyebrow"><span className="hero-wave"><i/><i/><i/></span>THE COMMUNITY SAFETY NETWORK<span className="demo-label">{demoMode ? 'DEMO' : 'LIVE NETWORK'}</span></div>
    <h1>Go live.<br/><span>Stay safe.</span><br/>Never alone.</h1>
    <p>Live entertainment, with a community that shows up when it matters. Stream together, look out for each other.</p>
    <div className="hero-actions"><button className="hero-primary" onClick={onTrigger} disabled={sending || active}><Radio size={17}/>{sending ? 'Starting stream…' : active ? 'SOS is active' : 'Start Live SOS'}</button><button className="hero-secondary" onClick={onJoinGuardian}><ShieldCheck size={17}/>Join as Guardian<ArrowUpRight size={14}/></button></div>
    <div className="hero-trust"><span><span className="trust-check">✓</span>Verified community responders</span><span>Location shared privately</span></div>
  </motion.div><motion.div className="hero-player-wrap" initial={reduceMotion ? false : { opacity: 0, scale: .98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: .65, delay: .08 }}><FeaturedPlayer stream={featuredStream} demoMode={demoMode} active={active}/></motion.div></section>;
}
