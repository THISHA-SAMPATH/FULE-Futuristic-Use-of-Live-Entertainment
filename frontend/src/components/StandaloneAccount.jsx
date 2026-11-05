import { useState } from 'react';
import { LogIn, LogOut, UserRound } from 'lucide-react';
import { API_URL } from '../config.js';

export default function StandaloneAccount({ account, onAccount }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch(`${API_URL}/api/auth/${mode === 'register' ? 'register' : 'login'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'FULE account authentication failed.');
      sessionStorage.setItem('fuleAccessToken', result.access_token);
      const profile = { ...result.account, access_token: result.access_token };
      sessionStorage.setItem('fuleAccount', JSON.stringify({ account_id: profile.account_id, email: profile.email, role: profile.role }));
      onAccount(profile); setOpen(false); setPassword('');
    } catch (requestError) { setError(requestError.message); }
    finally { setBusy(false); }
  }

  function disconnect() { sessionStorage.removeItem('fuleAccessToken'); sessionStorage.removeItem('fuleAccount'); onAccount(null); }
  return <div className="standalone-account">
    {account ? <button type="button" className="standalone-account-button" onClick={disconnect} aria-label={`Sign out ${account.email}`}><UserRound size={15}/><span>{account.email}</span><LogOut size={14}/></button> : <button type="button" className="standalone-account-button" onClick={() => setOpen((value) => !value)} aria-expanded={open}><LogIn size={15}/>Use FULE account</button>}
    {open && !account && <form className="standalone-account-form" onSubmit={submit}>
      <strong>{mode === 'register' ? 'Create your FULE account' : 'Sign in without Twitch'}</strong>
      <label>Email<input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)}/></label>
      <label>Password<input type="password" required minLength={mode === 'register' ? 12 : 1} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)}/></label>
      <button type="submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'}</button>
      <button type="button" className="standalone-account-switch" onClick={() => setMode((current) => current === 'login' ? 'register' : 'login')}>{mode === 'register' ? 'Already have an account? Sign in' : 'New here? Create an account'}</button>
      {error && <span role="alert">{error}</span>}
      <small>FULE accounts can start private streams without connecting Twitch.</small>
    </form>}
  </div>;
}
