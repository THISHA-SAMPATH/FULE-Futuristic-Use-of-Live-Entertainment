import { Buffer } from 'node:buffer';

export async function notifyTrustedContacts({ contacts, incident, demoMode, env = process.env, fetchImpl = globalThis.fetch }) {
  if (demoMode) return { status: 'MOCKED', notified: contacts.map(({ name }) => ({ name, channel: 'simulated-sms' })) };
  const account = env.TWILIO_ACCOUNT_SID;
  const token = env.TWILIO_AUTH_TOKEN;
  const from = env.TWILIO_FROM_NUMBER;
  if (!account || !token || !from) return { status: 'FAILED', notified: [], error: 'Twilio credentials are not configured.' };
  const message = `FULE safety alert for ${incident.streamer_contact?.display_name || 'your trusted contact'}. ${incident.summary} Area: ${incident.location.address}. Exact pin: ${incident.location.lat}, ${incident.location.lng}. Contact them or emergency services if needed.`;
  const notified = [];
  for (const contact of contacts) {
    const body = new URLSearchParams({ To: contact.phone, From: from, Body: message });
    const response = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(account)}/Messages.json`, {
      method: 'POST', headers: { authorization: `Basic ${Buffer.from(`${account}:${token}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' }, body
    });
    if (!response.ok) throw new Error(`Twilio notification returned HTTP ${response.status}.`);
    notified.push({ name: contact.name, channel: 'sms' });
  }
  return { status: 'SENT', notified };
}
