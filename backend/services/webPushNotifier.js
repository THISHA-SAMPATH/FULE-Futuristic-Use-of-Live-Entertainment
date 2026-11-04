import webpush from 'web-push';
import { safetyFeatureStore } from './safetyFeatureStore.js';
import { log } from './securityMetrics.js';

let configured = false;
function configure() {
  if (configured) return Boolean(process.env.WEB_PUSH_PUBLIC_KEY && process.env.WEB_PUSH_PRIVATE_KEY);
  configured = true;
  if (!process.env.WEB_PUSH_PUBLIC_KEY || !process.env.WEB_PUSH_PRIVATE_KEY) return false;
  webpush.setVapidDetails(process.env.WEB_PUSH_SUBJECT || 'mailto:safety@example.invalid', process.env.WEB_PUSH_PUBLIC_KEY, process.env.WEB_PUSH_PRIVATE_KEY);
  return true;
}

export function getWebPushPublicKey() { return process.env.WEB_PUSH_PUBLIC_KEY || ''; }

export async function sendSafeWalkPush(streamerId, { event, countdown_seconds: countdown = 60 }) {
  if (event !== 'safe_walk_checkin_due' || !configure()) return { sent: 0, configured: false };
  const subscriptions = await safetyFeatureStore.loadPushSubscriptions(streamerId);
  let sent = 0;
  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification(subscription, JSON.stringify({ title: 'FULE check-in', body: `Are you OK? Check in within ${countdown} seconds.`, url: '/' }), { TTL: countdown + 30, urgency: 'high' });
      sent += 1;
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) await safetyFeatureStore.removePushSubscription(streamerId, subscription.endpoint);
      else log('error', 'safe_walk_push_failed', { error: error.message, status: error.statusCode || null });
    }
  }));
  return { sent, configured: true };
}
