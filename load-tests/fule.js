import ws from 'k6/ws';
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const api = __ENV.BASE_URL || 'http://localhost:4000';
const wsUrl = __ENV.WS_URL || 'ws://localhost:4000';
const origin = __ENV.FRONTEND_ORIGIN || 'http://localhost:4173';
const token = __ENV.FULE_LOAD_TEST_TOKEN;

export const deliveryLatency = new Trend('fule_alert_delivery_latency_ms', true);
export const requestLatency = new Trend('fule_sos_request_latency_ms', true);
export const requestErrors = new Rate('fule_sos_request_errors');
export const deliveredAlerts = new Counter('fule_alerts_delivered');
export const missingAlerts = new Counter('fule_alerts_missing');

export const options = {
  scenarios: {
    socket_fanout: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [{ duration: '30s', target: 1000 }, { duration: '60s', target: 1000 }, { duration: '10s', target: 0 }],
      gracefulRampDown: '10s',
      exec: 'socketClient',
    },
  },
  thresholds: {
    fule_alert_delivery_latency_ms: ['p(95)<5000'],
    fule_sos_request_errors: ['rate<0.02'],
  },
};

export function socketClient() {
  if (!token) throw new Error('FULE_LOAD_TEST_TOKEN must be set for this demo-only test.');
  const pending = new Map();
  let eventsReceived = 0;
  const response = ws.connect(`${wsUrl}/socket.io/?EIO=4&transport=websocket`, {
    headers: { Origin: origin },
    tags: { role: 'load-test-public-client' },
  }, (socket) => {
    socket.on('open', () => socket.send('40'));
    socket.on('message', (message) => {
      if (message === '2') { socket.send('3'); return; }
      if (!message.startsWith('42')) return;
      try {
        const [event, incident] = JSON.parse(message.slice(2));
        if (event !== 'incident:public' || !incident?.incident_id) return;
        eventsReceived += 1;
        const started = pending.get(incident.incident_id);
        if (started) {
          deliveryLatency.add(Date.now() - started);
          deliveredAlerts.add(1);
          pending.delete(incident.incident_id);
        }
      } catch { /* Engine.IO and non-target Socket.IO messages are ignored. */ }
    });
    socket.on('error', () => requestErrors.add(true));
    if (__VU <= 50) {
      let sequence = 0;
      socket.setInterval(() => {
        const sequenceNumber = sequence++;
        const streamerId = `load-${__VU}-${sequenceNumber}`;
        const idempotencyKey = `load:${__VU}:${sequenceNumber}:fule`;
        const started = Date.now();
        const payload = JSON.stringify({
          streamer_id: streamerId,
          location: { lat: 12.97, lng: 77.59, address: 'Synthetic load-test area' },
          module_type: 'FULE_PROTECT',
          source: 'button',
          audio_transcript_snippet: 'Routine benchmark heartbeat; no assistance requested.',
        });
        const result = http.post(`${api}/api/sos`, payload, {
          headers: { Origin: origin, 'Content-Type': 'application/json', 'x-fule-load-test-token': token, 'Idempotency-Key': idempotencyKey },
          tags: { endpoint: 'sos' },
        });
        requestLatency.add(result.timings.duration);
        const ok = check(result, { 'SOS accepted': (r) => r.status === 201 || r.status === 200 });
        requestErrors.add(!ok);
        if (ok && result.status === 201) {
          const incidentId = result.json('incident.incident_id');
          if (incidentId) pending.set(incidentId, started);
        }
      }, 1000);
    }
    socket.setTimeout(() => {
      missingAlerts.add(pending.size);
      socket.close();
    }, 95_000);
  });
  check(response, { 'Socket.IO WebSocket handshake accepted': (r) => r && r.status === 101 });
  sleep(0.1);
  if (!eventsReceived && __VU > 50) sleep(0.1);
}

export function handleSummary(data) {
  const serialized = JSON.stringify(data, null, 2);
  return { 'load-tests/results/latest.json': serialized, stdout: `${JSON.stringify(data.metrics.fule_alert_delivery_latency_ms || {}, null, 2)}\n` };
}
