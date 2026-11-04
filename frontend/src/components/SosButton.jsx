import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AlertOctagon, Siren, X } from 'lucide-react';
import { createSosClickHandler } from '../sosFlow.js';

export function SosButton({ onClick, sending, active }) {
  const reduceMotion = useReducedMotion();
  return <motion.button className="floating-sos" onClick={createSosClickHandler(onClick)} disabled={sending || active} aria-label={active ? 'An SOS incident is active' : 'Trigger an emergency SOS'} animate={reduceMotion || active ? undefined : { scale: [1, 1.045, 1] }} transition={{ duration: 1.7, repeat: Infinity, ease: 'easeInOut' }}><Siren size={22}/><span>{sending ? 'SENDING' : active ? 'SOS ACTIVE' : 'SOS'}</span></motion.button>;
}

export function CancelToast({ incident, seconds, onCancel, onStandDown }) {
  const reduceMotion = useReducedMotion();
  const dispatchSent = ['SENT', 'ACKNOWLEDGED'].includes(incident?.dispatch_record?.status);
  const activeStatus = ['PENDING_DISPATCH', 'DISPATCHING', 'ACKNOWLEDGED', 'ESCALATED'].includes(incident?.status);
  const visible = activeStatus && (dispatchSent || seconds > 0);
  return <AnimatePresence>{visible && <motion.aside className="cancel-toast" role="alert" aria-live="assertive" initial={reduceMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}><span className="cancel-icon"><AlertOctagon size={17}/></span><span><strong>{dispatchSent ? 'Dispatch has been sent' : `SOS active · dispatch in ${seconds}s`}</strong><small>{dispatchSent ? 'Use Stand down to notify the dispatch provider.' : 'Cancel or report a false alarm before dispatch is sent.'}</small></span>{dispatchSent ? <button onClick={onStandDown} aria-label="Stand down dispatched responders">STAND DOWN</button> : <button onClick={onCancel} aria-label="Cancel SOS before dispatch is sent"><X size={14}/>CANCEL</button>}</motion.aside>}</AnimatePresence>;
}
