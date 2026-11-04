import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry });
export const httpRequests = new Counter({ name: 'fule_http_requests_total', help: 'HTTP requests by method, route, and status', labelNames: ['method', 'route', 'status'], registers: [metricsRegistry] });
export const alertDeliveryLatency = new Histogram({ name: 'fule_alert_delivery_latency_seconds', help: 'SOS to guardian alert delivery latency', buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5], registers: [metricsRegistry] });
export const activeSockets = new Gauge({ name: 'fule_active_sockets', help: 'Connected Socket.IO clients on this instance', registers: [metricsRegistry] });
export const queueDepth = new Gauge({ name: 'fule_queue_depth', help: 'Pending BullMQ jobs', labelNames: ['queue'], registers: [metricsRegistry] });

export function log(level, message, fields = {}) { process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...fields })}\n`); }
