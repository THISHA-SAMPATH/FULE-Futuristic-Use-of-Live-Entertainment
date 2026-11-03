import { Activity, CheckCheck, ShieldCheck, Timer } from 'lucide-react';
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion';
import { useEffect } from 'react';

function AnimatedNumber({ value }) {
  const reduceMotion = useReducedMotion();
  const count = useMotionValue(0);
  const rounded = useTransform(count, (latest) => Math.round(latest).toLocaleString());
  useEffect(() => { if (reduceMotion) { count.set(value); return undefined; } const controls = animate(count, value, { duration: .8, ease: 'easeOut' }); return controls.stop; }, [count, value, reduceMotion]);
  return <motion.strong>{rounded}</motion.strong>;
}

export default function NetworkPulse({ stats, demoMode }) {
  const reduceMotion = useReducedMotion();
  const rows = [
    { label: 'Active guardians', value: demoMode ? stats.activeGuardians : null, icon: ShieldCheck, accent: 'purple' },
    { label: 'Avg. response time', value: demoMode ? `00:${String(stats.responseSeconds).padStart(2, '0')}` : '—:—', icon: Timer, accent: 'pink' },
    { label: 'Alerts resolved today', value: demoMode ? stats.resolvedToday : null, icon: CheckCheck, accent: 'green' },
  ];
  return <motion.section className="network-card" initial={reduceMotion ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .35 }} aria-label="Network pulse">
    <div className="section-heading compact"><div><span className="section-kicker"><Activity size={13}/>NETWORK PULSE</span><h2>Showing up together</h2></div><span className="pulse-live"><i/>LIVE</span></div>
    <div className="pulse-rows">{rows.map(({ label, value, icon: Icon, accent }) => <div className="pulse-row" key={label}><span className={`pulse-icon ${accent}`}><Icon size={16}/></span><span className="pulse-label">{label}</span>{typeof value === 'number' ? <AnimatedNumber value={value}/> : <strong>{value ?? '—'}</strong>}</div>)}</div>
    <div className="pulse-footnote">{demoMode ? 'Simulated community activity' : 'Stats appear as the network reports them'}</div>
  </motion.section>;
}
