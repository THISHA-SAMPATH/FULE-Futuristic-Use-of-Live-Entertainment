import { motion, useReducedMotion } from 'framer-motion';
import { BadgeCheck, HeartHandshake } from 'lucide-react';

export default function GuardianCard({ guardian, index = 0 }) {
  const reduceMotion = useReducedMotion();
  return <motion.article className="guardian-tile" initial={reduceMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .32, delay: reduceMotion ? 0 : index * .06 }}>
    <div className={`guardian-ring ring-${guardian.color || 'lilac'}`}><span>{guardian.initials}</span><i><BadgeCheck size={12}/></i></div><strong>{guardian.name}</strong><span className="guardian-verified"><BadgeCheck size={13}/>Verified guardian</span><div className="guardian-stats"><span><small>RESPONSE</small><b>{guardian.response}</b></span><span><small>ASSISTED</small><b><HeartHandshake size={13}/>{guardian.assisted}</b></span></div>
  </motion.article>;
}
