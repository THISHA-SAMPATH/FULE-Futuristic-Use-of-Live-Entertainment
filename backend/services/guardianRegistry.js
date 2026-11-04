import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { authenticateAccess } from './accountService.js';

const dataDirectory = resolve(process.env.FULE_DATA_DIR || fileURLToPath(new URL('../data/', import.meta.url)));
const registryPath = resolve(dataDirectory, 'guardians.json');
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const sessions = new Map();

function hash(value) {
  return createHash('sha256').update(value).digest();
}

function readRegistry() {
  mkdirSync(dataDirectory, { recursive: true });
  if (!existsSync(registryPath)) writeFileSync(registryPath, '[]\n', { flag: 'wx' });
  try {
    const content = JSON.parse(readFileSync(registryPath, 'utf8'));
    return Array.isArray(content) ? content : [];
  } catch {
    return [];
  }
}

function writeRegistry(guardians) {
  mkdirSync(dataDirectory, { recursive: true });
  writeFileSync(registryPath, `${JSON.stringify(guardians, null, 2)}\n`, 'utf8');
}

export function seedDemoInvite(inviteCode) {
  if (!inviteCode) return;
  const codeHash = hash(inviteCode).toString('hex');
  const guardians = readRegistry();
  if (guardians.some((guardian) => guardian.invite_code_hash === codeHash)) return;
  guardians.push({
    guardian_id: `demo-${codeHash.slice(0, 10)}`,
    invite_code_hash: codeHash,
    active: true,
    demo: true,
    created_at: new Date().toISOString()
  });
  writeRegistry(guardians);
}

export function verifyGuardianInvite(inviteCode, { allowDemo = false } = {}) {
  if (typeof inviteCode !== 'string' || inviteCode.length < 8 || inviteCode.length > 256) return null;
  const candidate = hash(inviteCode);
  const guardian = readRegistry().find((entry) => {
    if (!entry.active || (entry.demo && !allowDemo) || !/^[a-f0-9]{64}$/i.test(entry.invite_code_hash || '')) return false;
    return timingSafeEqual(candidate, Buffer.from(entry.invite_code_hash, 'hex'));
  });
  if (!guardian) return null;
  const accessToken = randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + SESSION_TTL_MS;
  sessions.set(accessToken, { guardian_id: guardian.guardian_id, expires_at: expiresAt });
  if (sessions.size > 10_000) {
    const now = Date.now();
    for (const [token, session] of sessions) if (session.expires_at <= now) sessions.delete(token);
  }
  return { guardian_id: guardian.guardian_id, access_token: accessToken, expires_at: new Date(expiresAt).toISOString() };
}

export function authenticateGuardian(token) {
  if (typeof token !== 'string') return null;
  const account = authenticateAccess(token);
  if (account?.role === 'guardian' || account?.role === 'admin') return { guardian_id: account.account_id, expires_at: Date.now() + 10 * 60_000, role: account.role };
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expires_at <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return { guardian_id: session.guardian_id, expires_at: session.expires_at };
}

export function addGuardianInvite({ guardianId, inviteCode }) {
  const guardians = readRegistry();
  const normalizedId = String(guardianId || '').trim();
  if (!/^[\w-]{3,100}$/.test(normalizedId)) throw new Error('guardian id must be 3–100 letters, numbers, underscores, or hyphens');
  if (typeof inviteCode !== 'string' || inviteCode.length < 16) throw new Error('invite code must be at least 16 characters');
  if (guardians.some((guardian) => guardian.guardian_id === normalizedId)) throw new Error('guardian id already exists');
  guardians.push({
    guardian_id: normalizedId,
    invite_code_hash: hash(inviteCode).toString('hex'),
    active: true,
    demo: false,
    created_at: new Date().toISOString()
  });
  writeRegistry(guardians);
}
