import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Eye, PhoneCall, Radio, ShieldCheck, UsersRound } from 'lucide-react';
import { twitchPlayerUrl } from '../streamAccess.js';

function Artwork({ scene = 'violet' }) {
  return <div className={`carousel-art scene-${scene}`} aria-hidden="true"><span className="carousel-orbit orbit-one"/><span className="carousel-orbit orbit-two"/><span className="carousel-tower tower-one"/><span className="carousel-tower tower-two"/><span className="carousel-horizon"/><span className="carousel-person"/></div>;
}

function FeaturedPlayer({ stream, demoMode, active }) {
  const player = stream?.stream_url ? twitchPlayerUrl(stream.stream_url, window.location.hostname) : null;
  return <div className="carousel-feature">
    <div className="carousel-media">{player ? <iframe src={player} title="Featured Twitch safety stream" allow="autoplay; fullscreen" allowFullScreen/> : demoMode ? <Artwork scene={stream?.scene}/> : <div className="featured-empty"><Radio size={25}/><strong>No featured stream</strong><span>Verified community streams appear here.</span></div>}
      <div className="carousel-media-top"><span className="carousel-live"><i/>{active ? 'EMERGENCY' : 'LIVE'}</span><span className="carousel-demo">{demoMode ? 'SIMULATED' : 'VERIFIED FEED'}</span></div>
      {active && <div className="emergency-overlay" role="status" aria-live="polite"><span className="emergency-beacon"/><strong>EMERGENCY</strong><span>Guardians have been notified</span></div>}
    </div>
    <div className="carousel-feature-info"><div><h2>{active ? 'Emergency response stream' : stream?.title || 'Community safety stream'}</h2><span className="carousel-streamer"><span className="carousel-avatar">{active ? 'SOS' : stream?.initials || 'F'}</span>{active ? 'Demo Streamer' : stream?.streamer || 'FULE community'}</span></div><div className="carousel-stats"><span><Eye size={15}/>{stream?.viewers?.toLocaleString?.() || '—'} watching</span><span><UsersRound size={15}/>{stream?.guardians ?? '—'} guardians</span></div></div>
  </div>;
}

function SideSlide({ stream }) {
  return <div className="carousel-side-card"><Artwork scene={stream?.scene}/><span className="carousel-live"><i/>LIVE</span><div className="carousel-side-copy"><strong>{stream?.title}</strong><small>{stream?.streamer}</small></div></div>;
}

export default function Hero({ active, featuredStream, demoMode, carouselStreams = [], onOpenAlerts, onTrigger, sending = false }) {
  const reduceMotion = useReducedMotion();
  const streams = carouselStreams.length ? carouselStreams : featuredStream ? [featuredStream] : [];
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchStart = useRef(null);
  const next = useCallback((step) => { if (streams.length > 1) setIndex((current) => (current + step + streams.length) % streams.length); }, [streams.length]);
  useEffect(() => { if (active || paused || reduceMotion || streams.length < 2) return undefined; const timer = window.setInterval(() => next(1), 6000); return () => window.clearInterval(timer); }, [active, paused, reduceMotion, streams.length, next]);
  useEffect(() => { if (index >= streams.length) setIndex(0); }, [index, streams.length]);
  const current = streams[index] || featuredStream;
  const left = streams[(index - 1 + streams.length) % streams.length];
  const right = streams[(index + 1) % streams.length];
  return <section className="hero-section carousel-section" aria-label="Featured live safety streams" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocusCapture={() => setPaused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }} onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientX; }} onTouchEnd={(event) => { const delta = touchStart.current - event.changedTouches[0]?.clientX; if (Math.abs(delta) > 45) next(delta > 0 ? 1 : -1); }} onKeyDown={(event) => { if (event.key === 'ArrowLeft') next(-1); if (event.key === 'ArrowRight') next(1); }}>
    <div className="carousel-heading"><div><span className="hero-eyebrow">FULE community live <span className="demo-label">{demoMode ? 'Demo' : 'Network'}</span></span><h1>Stay safer,<br/><span>together.</span></h1><p>Real people. Shared awareness. A community that shows up when it matters.</p><div className="hero-actions"><button className="hero-primary" onClick={() => onTrigger?.()} disabled={sending || active}>{sending ? 'Starting…' : 'Start live SOS'}</button><button type="button" className="hero-secondary" onClick={onOpenAlerts}>Join as a guardian</button></div></div><div className="carousel-controls"><button onClick={() => next(-1)} aria-label="Previous featured stream" disabled={streams.length < 2}><ArrowLeft size={19}/></button><button onClick={() => next(1)} aria-label="Next featured stream" disabled={streams.length < 2}><ArrowRight size={19}/></button></div></div>
    <div className={`coverflow ${active ? 'has-emergency' : ''}`}>
      {left && streams.length > 2 && <button className="carousel-side left" onClick={() => next(-1)} aria-label={`Show previous stream: ${left.title}`}><SideSlide stream={left}/></button>}
      <motion.div className="coverflow-active" key={active ? 'emergency' : current?.id || index} initial={reduceMotion ? false : { opacity: 0, y: 8, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: reduceMotion ? 0 : .28 }}><FeaturedPlayer stream={current} demoMode={demoMode} active={active}/></motion.div>
      {right && streams.length > 2 && <button className="carousel-side right" onClick={() => next(1)} aria-label={`Show next stream: ${right.title}`}><SideSlide stream={right}/></button>}
      {active && <span className="carousel-emergency-tag"><ShieldCheck size={15}/> LIVE EMERGENCY FEED</span>}
    </div>
    <div className="carousel-footer"><span><i className="carousel-response-dot"/> {demoMode ? 'Community watch is active' : 'Verified safety feeds'}</span><span>Response time <b>{demoMode ? '00:08' : '—:—'}</b></span><a className="hero-112-call" href="tel:112" aria-label="Call emergency services at 112"><PhoneCall size={14}/>Call 112</a>{active && <button onClick={onOpenAlerts}>Open emergency alerts <ArrowRight size={14}/></button>}</div>
  </section>;
}
