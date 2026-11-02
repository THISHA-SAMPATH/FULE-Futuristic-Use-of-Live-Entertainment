import { AlertTriangle, Siren } from 'lucide-react';

export function CancelToast({ incident, seconds, onCancel, error }) {
  if (!incident || incident.status !== 'PENDING_DISPATCH' || seconds <= 0) return null;
  return <div className="cancel-toast" role="alert" aria-live="assertive"><span className="toast-icon"><AlertTriangle size={18}/></span><span className="toast-copy"><strong>SOS sent · dispatch in {seconds}s</strong><small>{error || 'Cancel now if this was triggered by mistake.'}</small></span><button onClick={onCancel} aria-label="Cancel SOS during the 10 second grace period">CANCEL SOS</button></div>;
}

export function MobileSOSButton({ onTrigger, sending, active }) {
  return <button className="mobile-sos" onClick={onTrigger} disabled={sending || active} aria-label={sending ? 'Sending SOS' : 'Trigger emergency SOS'}><Siren size={20}/>{sending ? 'SENDING SOS…' : active ? 'SOS ACTIVE' : 'TRIGGER SOS'}</button>;
}
