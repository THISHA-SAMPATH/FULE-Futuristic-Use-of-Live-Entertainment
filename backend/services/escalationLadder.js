const ACTIVE = new Set(['PENDING_DISPATCH', 'DISPATCHING', 'ESCALATED']);

export function createEscalationLadder({
  incident, isAcknowledged, isCancelled, isDispatchSent, onContacts, onDispatch,
  contactsDelayMs = 30_000, dispatchDelayMs = 60_000,
  setTimer = setTimeout, clearTimer = clearTimeout, now = Date.now
}) {
  let contactsTimer;
  let dispatchTimer;
  let stopped = false;
  const stillNeedsResponse = () => !stopped && ACTIVE.has(incident.status)
    && !isAcknowledged() && !isCancelled();
  const age = Math.max(0, now() - Date.parse(incident.created_at));
  const runContacts = () => {
    if (stillNeedsResponse()) void onContacts(incident);
  };
  const runDispatch = () => {
    if (stillNeedsResponse() && !isDispatchSent()) void onDispatch(incident);
  };
  if (incident.threat_level === 'CRITICAL' && !isDispatchSent()) dispatchTimer = setTimer(runDispatch, 0);
  else if (!isDispatchSent()) dispatchTimer = setTimer(runDispatch, Math.max(0, dispatchDelayMs - age));
  if (!incident.contacts_notified_at) contactsTimer = setTimer(runContacts, Math.max(0, contactsDelayMs - age));
  return {
    cancel() { stopped = true; if (contactsTimer) clearTimer(contactsTimer); if (dispatchTimer) clearTimer(dispatchTimer); },
    runContacts,
    runDispatch
  };
}
