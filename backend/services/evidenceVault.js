import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { createEvidenceEntry, verifyEvidenceChain } from './safetyFeatures.js';

export class EvidenceVault {
  constructor({ directory = process.env.EVIDENCE_STORAGE_DIR || './data/evidence', store }) {
    this.directory = resolve(directory);
    this.store = store;
    const configuredKey = process.env.EVIDENCE_ENCRYPTION_KEY;
    this.encryptionKey = configuredKey ? Buffer.from(configuredKey, 'base64') : createHash('sha256').update(process.env.JWT_ACCESS_SECRET || 'local-demo-only-evidence-key').digest();
    if (this.encryptionKey.length !== 32) throw new Error('EVIDENCE_ENCRYPTION_KEY must be base64 encoded 32 random bytes.');
  }

  #encrypt(bytes) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
    return Buffer.concat([Buffer.from('FULEEV1'), iv, cipher.getAuthTag(), ciphertext]);
  }

  #decrypt(bytes) {
    if (bytes.subarray(0, 7).toString() !== 'FULEEV1' || bytes.length < 35) throw new Error('Evidence encryption envelope is invalid.');
    const iv = bytes.subarray(7, 19);
    const tag = bytes.subarray(19, 35);
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(bytes.subarray(35)), decipher.final()]);
  }

  async appendChunk(incidentId, bytes, { contentType = 'application/octet-stream', recordedAt = new Date().toISOString() } = {}) {
    if (!/^[a-zA-Z0-9_.-]{1,160}$/.test(incidentId)) throw new Error('Invalid incident id.');
    if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > 5 * 1024 * 1024) throw new Error('Evidence chunks must be 1 byte to 5 MB.');
    if (!/^(audio|video)\/(webm|mp4|ogg|mpeg)$/.test(contentType)) throw new Error('Evidence must use a supported audio/video content type.');
    const chunkId = `ev-${randomBytes(16).toString('hex')}`;
    const storageKey = `${incidentId}/${chunkId}`;
    const path = resolve(this.directory, storageKey);
    const pathFromRoot = relative(this.directory, path);
    if (isAbsolute(pathFromRoot) || pathFromRoot.startsWith('..')) throw new Error('Invalid storage key.');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, this.#encrypt(bytes), { flag: 'wx', mode: 0o600 });
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    try {
      const entry = await this.store.appendEvidence({
        incident_id: incidentId,
        build: (sequence, previousHash) => createEvidenceEntry({ chunk_id: chunkId, incident_id: incidentId, sequence, recorded_at: recordedAt, storage_key: storageKey, sha256, previous_hash: previousHash, metadata: { content_type: contentType, bytes: bytes.length, encryption: 'AES-256-GCM' } })
      });
      return entry;
    } catch (error) {
      await unlink(path).catch(() => {});
      throw error;
    }
  }

  async appendExternalHash(incidentId, { sha256, storageKey, recordedAt = new Date().toISOString(), metadata = {} } = {}) {
    if (!/^[a-zA-Z0-9_.-]{1,160}$/.test(incidentId) || !/^[a-f0-9]{64}$/.test(sha256) || typeof storageKey !== 'string' || storageKey.length > 1024) throw new Error('External evidence hash metadata is invalid.');
    const chunkId = `ev-${randomBytes(16).toString('hex')}`;
    return this.store.appendEvidence({
      incident_id: incidentId,
      build: (sequence, previousHash) => createEvidenceEntry({ chunk_id: chunkId, incident_id: incidentId, sequence, recorded_at: recordedAt, storage_key: storageKey, sha256, previous_hash: previousHash, metadata: { encryption: 'S3 server-side encryption required', ...metadata } })
    });
  }

  async appendRetentionTombstone(targetEntry, recordedAt = new Date().toISOString()) {
    const chunkId = `ev-retention-${randomBytes(12).toString('hex')}`;
    return this.store.appendEvidence({
      incident_id: targetEntry.incident_id,
      build: (sequence, previousHash) => createEvidenceEntry({ chunk_id: chunkId, incident_id: targetEntry.incident_id, sequence, recorded_at: recordedAt, storage_key: `expired:${targetEntry.chunk_id}`, sha256: targetEntry.sha256, previous_hash: previousHash, metadata: { source: 'retention_tombstone', target_chunk_id: targetEntry.chunk_id, action: 'S3_OBJECT_DELETED' } })
    });
  }

  async readChunk(entry) {
    const path = resolve(this.directory, entry.storage_key);
    const pathFromRoot = relative(this.directory, path);
    if (isAbsolute(pathFromRoot) || pathFromRoot.startsWith('..')) throw new Error('Invalid evidence storage key.');
    return this.#decrypt(await readFile(path));
  }

  async removeStorageKeys(keys) {
    for (const key of keys) {
      const path = resolve(this.directory, key);
      const pathFromRoot = relative(this.directory, path);
      if (isAbsolute(pathFromRoot) || pathFromRoot.startsWith('..')) continue;
      await unlink(path).catch(() => {});
    }
  }

  async createCaseFile(incident, { walks = [] } = {}) {
    const evidence = await this.store.listEvidence(incident.incident_id);
    const verification = verifyEvidenceChain(evidence);
    const expiredRecordings = new Set(evidence.filter((entry) => entry.metadata?.source === 'retention_tombstone').map((entry) => entry.metadata.target_chunk_id));
    const fileChecks = await Promise.all(evidence.filter((entry) => !expiredRecordings.has(entry.chunk_id) && !entry.metadata?.s3_key && entry.metadata?.source !== 'retention_tombstone').map(async (entry) => {
      try { return createHash('sha256').update(await this.readChunk(entry)).digest('hex') === entry.sha256; }
      catch { return false; }
    }));
    return {
      format: 'FULE_CASE_FILE_V1',
      incident: { ...incident },
      timeline: [
        { at: incident.created_at, event: 'SOS_CREATED' },
        ...(incident.acknowledged_at ? [{ at: incident.acknowledged_at, event: 'GUARDIAN_ACKNOWLEDGED', actor_id: incident.acknowledged_by }] : []),
        ...(incident.contacts_notified_at ? [{ at: incident.contacts_notified_at, event: 'TRUSTED_CONTACTS_NOTIFIED' }] : []),
        ...(incident.dispatch_record?.sent_at ? [{ at: incident.dispatch_record.sent_at, event: 'DISPATCH_SENT' }] : [])
      ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)),
      clips: incident.clip_url ? [{ url: incident.clip_url, source: 'Twitch clip' }] : [],
      location_trail: walks.flatMap((walk) => walk.location_trail || []).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)),
      evidence: evidence.map(({ chunk_id, sequence, recorded_at, sha256, previous_hash, chain_hash, metadata }) => ({ chunk_id, sequence, recorded_at, sha256, previous_hash, chain_hash, metadata, expired: expiredRecordings.has(chunk_id), download_path: `/api/incidents/${incident.incident_id}/evidence/${chunk_id}` })),
      integrity: { algorithm: 'SHA-256 hash chain', ...verification, files_valid: fileChecks.every(Boolean), files_checked: fileChecks.length, recordings_expired: expiredRecordings.size }
    };
  }
}
