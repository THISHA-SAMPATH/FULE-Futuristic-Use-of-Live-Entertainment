import { randomUUID } from 'node:crypto';

export function createEmergencyReport(incident, { streamerContact = null, guardianResponses = [] } = {}) {
  return {
    incident_id: incident.incident_id,
    threat_level: incident.threat_level,
    location: { lat: incident.location.lat, lng: incident.location.lng, address: incident.location.address },
    summary: incident.summary,
    transcript_snippet: incident.transcript_snippet || '',
    live_stream_url: incident.stream_url || null,
    streamer_contact: streamerContact,
    timestamps: { created_at: incident.created_at, acknowledged_at: incident.acknowledged_at || null },
    guardian_responses: guardianResponses
  };
}

export class SimulatedDispatch {
  constructor({ etaMinutes = 7 } = {}) { this.etaMinutes = etaMinutes; this.name = 'SimulatedDispatch'; }
  async dispatch(report) {
    return {
      dispatch_id: `simulation-${randomUUID()}`,
      status: 'SENT',
      responder_eta_minutes: this.etaMinutes,
      queued_at: new Date().toISOString(),
      sent_at: new Date().toISOString(),
      simulated: true,
      report_id: report.incident_id
    };
  }
  async standDown(record, reason) {
    return { ...record, status: 'ACKNOWLEDGED', stage: 'STAND_DOWN', stand_down_at: new Date().toISOString(), stand_down_reason: reason, simulated: true };
  }
  async update(record, stage) {
    return { ...record, status: stage === 'ACCEPTED' ? 'ACKNOWLEDGED' : record.status, stage, simulated: true };
  }
}

export function createDispatchProvider() { return new SimulatedDispatch(); }
