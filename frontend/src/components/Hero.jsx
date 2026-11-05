import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Eye, PhoneCall, Radio, ShieldCheck, UsersRound } from 'lucide-react';
import { STREAM_ARTWORK } from '../streamArtwork.js';

function Artwork({ scene = 'violet' }) {
  return <div className="carousel-art"><img src={STREAM_ARTWORK[scene] || STREAM_ARTWORK.violet} alt=""/><span className="artwork-tone"/></div>;
}

function FeaturedPlayer({ stream, demoMode, active }) {
  return <div className="carousel-feature">
    <div className="carousel-media">{demoMode ? <Artwork scene={stream?.scene}/> : <div className="featured-empty"><Radio size={25}/><strong>No featured stream</strong><span>Private live rooms appear here after an incident starts.</span></div>}
      <div className="carousel-media-top"><span className="carousel-live"><i/>{active ? 'EMERGENCY' : 'LIVE'}</span><span className="carousel-area">{active ? 'Private circle' : stream?.region || 'Area shared privately'}</span></div>
      {active && <div className="emergency-overlay" role="status" aria-live="polite"><span className="emergency-beacon"/><strong>EMERGENCY</strong><span>Guardians have been notified</span></div>}
    </div>
    <div className="carousel-feature-info"><div><h2>{active ? 'Emergency response stream' : stream?.title || 'Community safety stream'}</h2><span className="carousel-streamer"><span className="carousel-avatar">{active ? 'SOS' : stream?.initials || 'F'}</span>{active ? 'Demo Streamer' : stream?.streamer || 'FULE community'}</span></div><div className="carousel-stats"><span><Eye size={15}/>{stream?.viewers?.toLocaleString?.() || '—'} watching</span><span><UsersRound size={15}/>{stream?.guardians ?? '—'} guardians</span></div></div>
  </div>;
}

function SideSlide({ stream }) {
  return <div className="carousel-side-card"><Artwork scene={stream?.scene}/><span className="carousel-live"><i/>LIVE</span><div className="carousel-side-copy"><strong>{stream?.title}</strong><small>{stream?.streamer}</small></div></div>;
}

export default function Hero({ active, featuredStream, demoMode, carouselStreams = [], onOpenAlerts, onSetUpCircle }) {
  const reduceMotion = useReducedMotion();
  const streams = carouselStreams.length ? carouselStreams : featuredStream ? [featuredStream] : [];
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchStart = useRef(null);
  const next = useCallback((step) => { if (streams.length > 1) setIndex((current) => (current + step + streams.length) % streams.length); }, [streams.length]);
  useEffect(() => { if (active || paused || reduceMotion || streams.length < 2) return undefined; const timer = window.setInterval(() => next(1), 6000); return () => window.clearInterval(timer); }, [active, paused, reduceMotion, streams.length, next]);
  useEffect(() => { if (index >= streams.length) setIndex(0); }, [index, streams.length]);
  const current = streams[index] || featuredStream;
  const right = streams[(index + 1) % streams.length];
  return <>
    <section className="hero-section carousel-section" aria-label="Featured live safety streams" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocusCapture={() => setPaused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }} onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientX; }} onTouchEnd={(event) => { const delta = touchStart.current - event.changedTouches[0]?.clientX; if (Math.abs(delta) > 45) next(delta > 0 ? 1 : -1); }} onKeyDown={(event) => { if (event.key === 'ArrowLeft') next(-1); if (event.key === 'ArrowRight') next(1); }}>
    <div className="carousel-heading"><div className="hero-copy"><span className="hero-eyebrow">A little more peace of mind</span><h1>Walk home like someone’s <span>watching out for you.</span></h1><p>One tap alerts nearby guardians, shares your live location with your circle, and keeps 112 one tap away.</p><div className="hero-actions"><button type="button" className="hero-primary" onClick={onSetUpCircle}>Set up my safe circle</button><button type="button" className="hero-guardian-link" onClick={onOpenAlerts}>Become a guardian <ArrowRight size={15}/></button></div></div><div className="carousel-controls"><button onClick={() => next(-1)} aria-label="Previous featured stream" disabled={streams.length < 2}><ArrowLeft size={19}/></button><button onClick={() => next(1)} aria-label="Next featured stream" disabled={streams.length < 2}><ArrowRight size={19}/></button></div></div>
    <div className={`coverflow ${active ? 'has-emergency' : ''}`}>
      <motion.div className="coverflow-active" key={active ? 'emergency' : current?.id || index} initial={reduceMotion ? false : { opacity: 0, y: 8, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: reduceMotion ? 0 : .28 }}><FeaturedPlayer stream={current} demoMode={demoMode} active={active}/></motion.div>
      {right && streams.length > 2 && <button className="carousel-side right" onClick={() => next(1)} aria-label={`Show next stream: ${right.title}`}><SideSlide stream={right}/></button>}
      {active && <span className="carousel-emergency-tag"><ShieldCheck size={15}/> LIVE EMERGENCY FEED</span>}
    </div>
    </section>
    <div className="hero-status-strip" role="status"><span><i className="carousel-response-dot"/>{active ? 'Your circle has been alerted' : 'Your safety circle is ready'}</span><span>Typical response <b>{demoMode ? '00:08' : '—:—'}</b></span><a href="tel:112" aria-label="Call emergency services at 112"><PhoneCall size={15}/>Call 112</a></div>
  </>;
}
