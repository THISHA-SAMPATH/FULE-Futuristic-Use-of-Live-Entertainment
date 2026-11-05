import { useEffect, useState } from 'react';
import { UserPlus, X } from 'lucide-react';
import { API_URL } from '../config.js';

export default function TrustedContacts({ streamerId, connected, accessToken = '', demoMode = false }) {
  const [contacts, setContacts] = useState([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!connected && !demoMode) return;
    const query = demoMode ? `?streamer_id=${encodeURIComponent(streamerId || 'demo-streamer')}` : '';
    fetch(`${API_URL}/api/streamer/trusted-contacts${query}`, { credentials: 'include', headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} })
      .then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not load trusted contacts.'); setContacts(result.contacts || []); })
      .catch((error) => setMessage(error.message));
  }, [streamerId, connected, accessToken, demoMode]);

  async function save(next) {
    setSaving(true); setMessage('');
    try {
      const response = await fetch(`${API_URL}/api/streamer/trusted-contacts`, {
        method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify({ ...(demoMode ? { streamer_id: streamerId || 'demo-streamer' } : {}), contacts: next })
      });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not save trusted contacts.');
      setContacts(result.contacts || []); setMessage('Trusted contacts saved securely on this server.');
    } catch (error) { setMessage(error.message); }
    finally { setSaving(false); }
  }
  async function add(event) {
    event.preventDefault();
    if (contacts.length >= 3) { setMessage('The maximum is three contacts.'); return; }
    const next = [...contacts, { name: name.trim(), phone: phone.trim() }];
    await save(next); setName(''); setPhone('');
  }
  return <details className="trusted-contacts"><summary>Trusted Contacts <span>{contacts.length}/3 · alerted after 30s without guardian acknowledgement</span></summary>
    {!connected && !demoMode ? <p className="trusted-contact-hint">Sign in with a FULE account or connect Twitch to manage your private trusted contacts.</p> : <>
      <p className="trusted-contact-hint">Their name and phone number stay server-side. FULE sends them an alert if guardians have not acknowledged in 30 seconds.</p>
      <ul>{contacts.map((contact, index) => <li key={`${contact.phone}-${index}`}><span><strong>{contact.name}</strong><small>{contact.phone}</small></span><button type="button" aria-label={`Remove ${contact.name}`} disabled={saving} onClick={() => save(contacts.filter((_, itemIndex) => itemIndex !== index))}><X size={15}/></button></li>)}</ul>
      {contacts.length < 3 && <form onSubmit={add}><label>Name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required/></label><label>Phone in international format<input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+14155550123" pattern="\+[1-9]\d{7,14}" required/></label><button type="submit" disabled={saving}><UserPlus size={15}/>{saving ? 'Saving…' : 'Add trusted contact'}</button></form>}
    </>}{message && <p className="trusted-contact-message" role="status">{message}</p>}
  </details>;
}
