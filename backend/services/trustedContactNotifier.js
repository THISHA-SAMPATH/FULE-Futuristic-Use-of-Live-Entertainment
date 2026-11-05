import { incidentRepository } from './incidentStore.js';
import { sendTrustedContactPush } from './webPushNotifier.js';

export async function notifyTrustedContacts({ contacts = [], incident, streamLinks = {} }) {
  if (!incidentRepository.db || !contacts.length) return { status: 'SKIPPED', notified: [], error: null };
  const rows = await incidentRepository.db('accounts').select('account_id', 'email').whereIn('email', contacts.map((contact) => contact.email));
  const byEmail = new Map(rows.map((account) => [account.email, account.account_id]));
  const notified = [];
  for (const contact of contacts) {
    const accountId = byEmail.get(contact.email);
    if (!accountId) continue;
    if (await sendTrustedContactPush(accountId, { incident_id: incident.incident_id, threat_level: incident.threat_level, summary: incident.summary, url: streamLinks[contact.email] })) notified.push(contact.email);
  }
  return { status: notified.length ? 'SENT' : 'SKIPPED', notified, error: null };
}
