import { createHmac, randomUUID } from 'node:crypto';

export function createEmergencyReport(incident, { streamerContact = null, guardianResponses = [] } = {}) {
  return {
    incident_id: incident.incident_id,
    threat_level: incident.threat_level,
    location: { lat: incident.location.lat, lng: incident.location.lng, address: incident.location.address },
    ai_summary: incident.summary,
    transcript_snippet: incident.transcript_snippet || '',
    clip_url: incident.clip_url,
    live_stream_url: incident.stream_url,
    streamer_contact: streamerContact,
    timestamps: { created_at: incident.created_at, acknowledged_at: incident.acknowledged_at || null },
    guardian_responses: guardianResponses
  };
}

function makeRecord({ id, status, eta }) {
  return { dispatch_id: id || `dispatch-${randomUUID()}`, status, responder_eta_minutes: eta ?? null, queued_at: new Date().toISOString(), sent_at: status === 'SENT' ? new Date().toISOString() : null };
}

export class SimulatedDispatch {
  constructor({ etaMinutes = 7 } = {}) { this.etaMinutes = etaMinutes; this.name = 'SimulatedDispatch'; }
  async dispatch(report) {
    return { ...makeRecord({ status: 'SENT', eta: this.etaMinutes }), simulated: true, report_id: report.incident_id };
  }
  async standDown(record, reason) {
    return { ...record, status: 'ACKNOWLEDGED', stage: 'STAND_DOWN', stand_down_at: new Date().toISOString(), stand_down_reason: reason, simulated: true };
  }
  async update(record, stage) { return { ...record, status: stage === 'ACCEPTED' ? 'ACKNOWLEDGED' : record.status, stage }; }
}

export class WebhookDispatch {
  constructor({ url, secret, fetchImpl = globalThis.fetch, retries = 2, retryDelayMs = 150, timeoutMs = 8_000 } = {}) {
    if (!url || !secret) throw new Error('DISPATCH_WEBHOOK_URL and DISPATCH_WEBHOOK_SECRET are required for webhook dispatch.');
    this.url = url; this.secret = secret; this.fetch = fetchImpl; this.retries = retries; this.retryDelayMs = retryDelayMs; this.timeoutMs = timeoutMs; this.name = 'WebhookDispatch';
  }
  signature(body) { return `sha256=${createHmac('sha256', this.secret).update(body).digest('hex')}`; }
  async post(payload, type) {
    const body = JSON.stringify({ type, ...payload });
    const signature = this.signature(body);
    let lastError;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await this.fetch(this.url, {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-fule-signature': signature, 'x-fule-event': type },
          body, signal: controller.signal
        });
        if (response.ok) return { response, body };
        lastError = new Error(`Dispatch webhook returned HTTP ${response.status}.`);
      } catch (error) { lastError = error; }
      finally { clearTimeout(timer); }
      if (attempt < this.retries) await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs * (attempt + 1)));
    }
    throw lastError || new Error('Dispatch webhook failed.');
  }
  async dispatch(report) {
    const { response } = await this.post({ report }, 'dispatch.report');
    let result = {};
    try { result = await response.json(); } catch { /* A 2xx response may have no JSON body. */ }
    return { ...makeRecord({ id: result.dispatch_id, status: 'SENT', eta: result.responder_eta_minutes }), sent_at: new Date().toISOString(), provider: 'webhook' };
  }
  async standDown(record, reason) {
    await this.post({ dispatch_id: record.dispatch_id, incident_id: record.incident_id, reason }, 'dispatch.stand_down');
    return { ...record, status: 'ACKNOWLEDGED', stage: 'STAND_DOWN', stand_down_at: new Date().toISOString() };
  }
  async update(record, stage) {
    await this.post({ dispatch_id: record.dispatch_id, incident_id: record.incident_id, stage }, 'dispatch.status');
    return { ...record, status: stage === 'ACCEPTED' ? 'ACKNOWLEDGED' : record.status, stage };
  }
}

export class UnconfiguredDispatch {
  constructor() { this.name = 'UnconfiguredDispatch'; }
  async dispatch() { throw new Error('Emergency dispatch is not configured. Set DISPATCH_WEBHOOK_URL and DISPATCH_WEBHOOK_SECRET.'); }
  async standDown() { throw new Error('Dispatch stand-down is unavailable because no provider is configured.'); }
  async update() { throw new Error('Dispatch status updates are unavailable because no provider is configured.'); }
}

export function createDispatchProvider({ demoMode, url, secret, ...options } = {}) {
  if (demoMode) return new SimulatedDispatch(options);
  if (!url || !secret) return new UnconfiguredDispatch();
  return new WebhookDispatch({ url, secret, ...options });
}
