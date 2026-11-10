const CLOSED_STATUSES = new Set(['CANCELLED', 'FALSE_ALARM', 'RESOLVED']);

export function applyButtonTriggerFloor({ source, threat_level, status = 'PENDING_DISPATCH' }) {
  if (source === 'button' && !CLOSED_STATUSES.has(status)) return 'CRITICAL';
  return threat_level;
}

export function createDeliveryPlan({ threat_level, tieredEnabled = false }) {
  if (!tieredEnabled) {
    return { route: 'standard', notify_guardians: true, notify_trusted_circle_now: false, schedule_escalation: true };
  }
  if (threat_level === 'CRITICAL') {
    return { route: 'critical_guardian_interrupt', notify_guardians: true, notify_trusted_circle_now: false, schedule_escalation: true };
  }
  if (threat_level === 'ELEVATED') {
    return { route: 'trusted_circle_checkin', notify_guardians: false, notify_trusted_circle_now: true, schedule_escalation: true };
  }
  return { route: 'log_only', notify_guardians: false, notify_trusted_circle_now: false, schedule_escalation: false };
}
