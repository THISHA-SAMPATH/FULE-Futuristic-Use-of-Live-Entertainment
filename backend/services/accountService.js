import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { incidentRepository } from './incidentStore.js';

const jwtSecret = process.env.JWT_ACCESS_SECRET;
if (process.env.NODE_ENV === 'production' && (!jwtSecret || jwtSecret.length < 32)) throw new Error('JWT_ACCESS_SECRET must be a random value with at least 32 characters.');
const secret = jwtSecret || 'development-only-secret-change-this-before-production';
const db = incidentRepository.db;
const hashToken = (token) => createHash('sha256').update(token).digest('hex');

function accessToken(account) { return jwt.sign({ sub: account.account_id, role: account.role }, secret, { expiresIn: '10m', issuer: 'fule' }); }
async function issueRefresh(account, transaction = db) {
  const token = randomBytes(48).toString('base64url');
  if (transaction) await transaction('refresh_tokens').insert({ token_hash: hashToken(token), account_id: account.account_id, expires_at: new Date(Date.now() + 30 * 86_400_000) });
  return token;
}
export async function registerAccount({ email, password }) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 320) throw new Error('Valid email is required.');
  if (typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) throw new Error('Password must be at least 12 characters and no more than 72 UTF-8 bytes.');
  if (!db) throw new Error('Account persistence requires PostgreSQL.');
  const account = { account_id: `acct-${randomBytes(16).toString('hex')}`, email: normalized, password_hash: await bcrypt.hash(password, 12), role: 'user', guardian_approved: false };
  await db('accounts').insert(account);
  return { account: { account_id: account.account_id, email: normalized, role: account.role }, access_token: accessToken(account), refresh_token: await issueRefresh(account) };
}
export async function loginAccount({ email, password }) {
  if (!db) throw new Error('Account persistence requires PostgreSQL.');
  const account = await db('accounts').where({ email: String(email || '').trim().toLowerCase() }).first();
  if (!account?.password_hash || !await bcrypt.compare(String(password || ''), account.password_hash)) throw new Error('Invalid email or password.');
  return { account: { account_id: account.account_id, email: account.email, role: account.role }, access_token: accessToken(account), refresh_token: await issueRefresh(account) };
}
export async function refreshAccount(token) {
  if (!db || typeof token !== 'string') throw new Error('Refresh session is invalid.');
  const token_hash = hashToken(token);
  return db.transaction(async (transaction) => {
    const row = await transaction('refresh_tokens').join('accounts', 'accounts.account_id', 'refresh_tokens.account_id').where({ token_hash }).whereNull('revoked_at').where('expires_at', '>', new Date()).forUpdate().first('accounts.*');
    if (!row) throw new Error('Refresh session is invalid.');
    const revoked = await transaction('refresh_tokens').where({ token_hash }).whereNull('revoked_at').update({ revoked_at: new Date() });
    if (!revoked) throw new Error('Refresh session is invalid.');
    return { account: { account_id: row.account_id, email: row.email, role: row.role }, access_token: accessToken(row), refresh_token: await issueRefresh(row, transaction) };
  });
}
export function authenticateAccess(token) {
  try { const payload = jwt.verify(String(token || ''), secret, { issuer: 'fule' }); return { account_id: payload.sub, role: payload.role }; }
  catch { return null; }
}

export function createTrustedContactStreamToken({ incidentId, streamerId, phone }) {
  const phoneHash = hashToken(String(phone || ''));
  return jwt.sign({ sub: `trusted-${phoneHash.slice(0, 20)}`, role: 'trusted_contact', incident_id: incidentId, streamer_id: streamerId, phone_hash: phoneHash }, secret, { expiresIn: '10m', issuer: 'fule' });
}

export function authenticateTrustedContactStreamToken(token, incidentId, streamerId) {
  try {
    const payload = jwt.verify(String(token || ''), secret, { issuer: 'fule' });
    return payload.role === 'trusted_contact' && payload.incident_id === incidentId && payload.streamer_id === streamerId && typeof payload.phone_hash === 'string'
      ? { id: payload.sub, role: payload.role }
      : null;
  } catch { return null; }
}
export async function requestGuardianApproval(accountId) {
  if (!db) throw new Error('Account persistence requires PostgreSQL.');
  return db('accounts').where({ account_id: accountId, role: 'user' }).update({ role: 'guardian_pending' });
}
export async function approveGuardian(accountId) {
  if (!db) throw new Error('Account persistence requires PostgreSQL.');
  return db('accounts').where({ account_id: accountId, role: 'guardian_pending' }).update({ role: 'guardian', guardian_approved: true });
}
