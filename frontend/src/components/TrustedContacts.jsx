import { useEffect, useState } from 'react';
import { UserPlus, X } from 'lucide-react';
import { API_URL } from '../config.js';

export default function TrustedContacts({ streamerId, connected, accessToken = '', demoMode = false, id = 'trusted-circle', compact = false }) {
  const [contacts, setContacts] = useState([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
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
    const next = [...contacts, { name: name.trim(), email: email.trim().toLowerCase() }];
    await save(next); setName(''); setEmail('');
  }
  return <details className={`trusted-contacts ${compact ? 'is-compact' : ''}`} id={id} open={compact || undefined}><summary>Trusted Contacts <span>{contacts.length}/3 · alerted after 30s without guardian acknowledgement</span></summary>
    {!connected && !demoMode ? <p className="trusted-contact-hint">Sign in with a FULE account to manage your private trusted circle.</p> : <>
      <p className="trusted-contact-hint">Trusted members must have a FULE account and enable Web Push to receive escalation notifications.</p>
      <ul>{contacts.map((contact, index) => <li key={`${contact.email}-${index}`}><span><strong>{contact.name}</strong><small>{contact.email}</small></span><button type="button" aria-label={`Remove ${contact.name}`} disabled={saving} onClick={() => save(contacts.filter((_, itemIndex) => index !== itemIndex))}><X size={15}/></button></li>)}</ul>
      {contacts.length < 3 && <form onSubmit={add}><label>Name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required/></label><label>FULE account email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required/></label><button type="submit" disabled={saving}><UserPlus size={15}/>{saving ? 'Saving…' : 'Add trusted contact'}</button></form>}
    </>}{message && <p className="trusted-contact-message" role="status">{message}</p>}
  </details>;
}
