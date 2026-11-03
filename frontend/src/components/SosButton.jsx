import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertOctagon, Siren, X } from 'lucide-react';

export function SosButton({ onClick, sending, active }) {
  const reduceMotion = useReducedMotion();
  return <motion.button className="floating-sos" onClick={onClick} disabled={sending || active} aria-label={active ? 'An SOS incident is active' : 'Trigger an emergency SOS'} animate={reduceMotion || active ? undefined : { scale: [1, 1.045, 1] }} transition={{ duration: 1.7, repeat: Infinity, ease: 'easeInOut' }}><Siren size={22}/><span>{sending ? 'SENDING' : active ? 'SOS ACTIVE' : 'SOS'}</span></motion.button>;
}

export function CancelToast({ incident, seconds, onCancel }) {
  const reduceMotion = useReducedMotion();
  const visible = incident?.status === 'PENDING_DISPATCH' && seconds > 0;
  return <AnimatePresence>{visible && <motion.aside className="cancel-toast" role="alert" aria-live="assertive" initial={reduceMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}><span className="cancel-icon"><AlertOctagon size={17}/></span><span><strong>SOS sent · dispatch in {seconds}s</strong><small>Tap cancel if this was triggered by mistake.</small></span><button onClick={onCancel} aria-label="Cancel SOS during 10 second grace period"><X size={14}/>CANCEL</button></motion.aside>}</AnimatePresence>;
}
