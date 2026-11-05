import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { incidentRepository } from './incidentStore.js';
import { redis } from './runtimeInfrastructure.js';

const db = incidentRepository.db;
const nodeId = randomUUID();
const leasePrefix = 'fule:twitch:eventsub:';
function encryptionKey() {
  const raw = process.env.TWITCH_TOKEN_ENCRYPTION_KEY || '';
  const key = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('TWITCH_TOKEN_ENCRYPTION_KEY must encode exactly 32 random bytes.');
  return key;
}
if (process.env.NODE_ENV === 'production' && process.env.TWITCH_CLIENT_ID && !process.env.TWITCH_TOKEN_ENCRYPTION_KEY) throw new Error('TWITCH_TOKEN_ENCRYPTION_KEY is required when Twitch OAuth is enabled in production.');
if (process.env.NODE_ENV === 'production' && process.env.TWITCH_CLIENT_ID) encryptionKey();
function encrypt(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { token_ciphertext: ciphertext.toString('base64'), token_iv: iv.toString('base64'), token_tag: cipher.getAuthTag().toString('base64') };
}
function decrypt(row) {
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(row.token_iv, 'base64'));
  decipher.setAuthTag(Buffer.from(row.token_tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(row.token_ciphertext, 'base64')), decipher.final()]).toString('utf8'));
}
function fromRow(row) {
  return { ...decrypt(row), id: row.streamer_id, login: row.login, displayName: row.display_name, avatarUrl: row.avatar_url, scopes: row.scopes || [], rewardId: row.reward_id, authVersion: Number(row.auth_version) || 0 };
}

const memoryAccounts = new Map();
export const twitchAccountStore = {
  durable: Boolean(db),
  ownerId: nodeId,
  async loadAccounts() {
    if (!db) return [...memoryAccounts.values()];
    return (await db('twitch_accounts').select('*')).map(fromRow);
  },
  async loadAccount(id) {
    if (!db) return memoryAccounts.get(id) || null;
    const row = await db('twitch_accounts').where({ streamer_id: id }).first();
    return row ? fromRow(row) : null;
  },
  async saveAccount(account) {
    if (!db) { memoryAccounts.set(account.id, { ...account }); return; }
    const secrets = encrypt({ accessToken: account.accessToken, refreshToken: account.refreshToken, expiresAt: account.expiresAt });
    await db('twitch_accounts').insert({ streamer_id: account.id, login: account.login, display_name: account.displayName, avatar_url: account.avatarUrl, ...secrets, token_expires_at: new Date(account.expiresAt), scopes: JSON.stringify(account.scopes || []), reward_id: account.rewardId, auth_version: account.authVersion || 0, updated_at: new Date() }).onConflict('streamer_id').merge();
    memoryAccounts.set(account.id, { ...account });
  },
  async removeAccount(id) {
    memoryAccounts.delete(id);
    if (db) await db('twitch_accounts').where({ streamer_id: id }).del();
  },
  async claimEventSub(id) {
    if (!redis) return true;
    return (await redis.set(`${leasePrefix}${id}`, nodeId, 'PX', 30_000, 'NX')) === 'OK';
  },
  async ownsEventSub(id) { return redis ? (await redis.get(`${leasePrefix}${id}`)) === nodeId : true; },
  async renewEventSub(id) {
    if (!redis) return true;
    return Number(await redis.eval("if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('PEXPIRE',KEYS[1],ARGV[2]) else return 0 end", 1, `${leasePrefix}${id}`, nodeId, 30_000)) === 1;
  },
  async releaseEventSub(id) {
    if (!redis) return;
    await redis.eval("if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end", 1, `${leasePrefix}${id}`, nodeId);
  },
  async releaseAllEventSub(identifiers) { await Promise.allSettled(identifiers.map((id) => this.releaseEventSub(id))); },
  async claimEventSubMessage(streamerId, messageId, ttlMs = 10 * 60_000) {
    const key = createHash('sha256').update(`${streamerId}:${messageId}`).digest('hex');
    if (redis) return (await redis.set(`fule:twitch:event-id:${key}`, '1', 'PX', ttlMs, 'NX')) === 'OK';
    if (!db) return null;
    await db('twitch_event_dedup').where('expires_at', '<=', new Date()).del();
    const inserted = await db('twitch_event_dedup').insert({ event_id: key, expires_at: new Date(Date.now() + ttlMs) }).onConflict('event_id').ignore().returning('event_id');
    return inserted.length > 0;
  },
  async saveOAuthState(state) {
    if (!redis) return false;
    return (await redis.set(`fule:twitch:oauth-state:${state}`, '1', 'EX', 600, 'NX')) === 'OK';
  },
  async consumeOAuthState(state) {
    if (!redis) return false;
    return Number(await redis.del(`fule:twitch:oauth-state:${state}`)) === 1;
  }
};
