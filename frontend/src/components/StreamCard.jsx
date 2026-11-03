import { motion, useReducedMotion } from 'framer-motion';
import { Eye, ShieldCheck, UsersRound } from 'lucide-react';

export default function StreamCard({ stream, index = 0, demoMode = false }) {
  const reduceMotion = useReducedMotion();
  return <motion.article className="stream-tile" initial={reduceMotion ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .35, delay: reduceMotion ? 0 : Math.min(index * .07, .35) }}>
    <div className={`tile-art scene-${stream.scene || 'violet'}`} role="img" aria-label="Abstract generated stream thumbnail"><div className="tile-grid"/><span className="tile-shape shape-one"/><span className="tile-shape shape-two"/><span className="tile-shape shape-three"/><span className="tile-title-overlay">{stream.title}</span><span className={`tile-live ${demoMode || stream.live ? '' : 'offline'}`}><i/>{demoMode || stream.live ? 'LIVE' : 'ALERT'}</span>{demoMode && <span className="tile-sim">SIM</span>}</div>
    <div className="tile-details"><span className={`tile-avatar avatar-${stream.scene || 'violet'}`}>{stream.initials || 'F'}</span><div className="tile-copy"><strong>{stream.title}</strong><span>{stream.streamer || 'Safety feed'} <ShieldCheck size={12}/></span></div></div>
    <div className="tile-meta"><span><Eye size={13}/>{stream.viewers == null ? 'Stats unavailable' : stream.viewers.toLocaleString()}</span><span><UsersRound size={13}/>{stream.guardians == null ? '—' : stream.guardians}</span><span className="region-pill">{stream.region || 'Area private'}</span></div>
  </motion.article>;
}
