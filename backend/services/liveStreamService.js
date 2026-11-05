import { createHash, createHmac } from 'node:crypto';
import { AccessToken, EgressClient, EncodedFileOutput, RoomServiceClient, S3Upload, WebhookReceiver } from 'livekit-server-sdk';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const OPEN_STATUSES = new Set(['PENDING_DISPATCH', 'DISPATCHING', 'ACKNOWLEDGED', 'ESCALATED']);

export class LiveStreamService {
  constructor({ env = process.env, roomService, egressClient, webhookReceiver, s3ObjectReader, s3ObjectDeleter, evidenceVault, evidenceStore, now = () => Date.now() } = {}) {
    this.env = env;
    this.apiUrl = String(env.LIVEKIT_API_URL || env.LIVEKIT_URL || '').replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
    this.websocketUrl = String(env.LIVEKIT_URL || '').replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
    this.evidenceVault = evidenceVault;
    this.evidenceStore = evidenceStore;
    this.roomService = roomService || (this.configured ? new RoomServiceClient(this.apiUrl, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET) : null);
    this.egressClient = egressClient || (this.recordingConfigured ? new EgressClient(this.apiUrl, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET) : null);
    this.webhookReceiver = webhookReceiver;
    this.s3ObjectReader = s3ObjectReader;
    this.s3ObjectDeleter = s3ObjectDeleter;
    this.now = now;
    this.revoked = new Set();
    this.rooms = new Map();
    this.egresses = new Map();
    this.recordingEntries = new Map();
  }
  get configured() { return Boolean(this.env.LIVEKIT_URL && this.env.LIVEKIT_API_KEY && this.env.LIVEKIT_API_SECRET); }
  get recordingConfigured() { return Boolean(this.configured && this.env.LIVEKIT_WEBHOOK_URL && this.env.LIVEKIT_EGRESS_S3_BUCKET && this.env.AWS_ACCESS_KEY_ID && this.env.AWS_SECRET_ACCESS_KEY && this.env.AWS_S3_ENDPOINT && this.evidenceVault); }
  get demoMode() { return this.env.DEMO_MODE === 'true'; }
  roomName(incidentId) { return `fule-${createHash('sha256').update(incidentId).digest('hex').slice(0, 32)}`; }

  async issueToken({ incident, principal, role, authorized = false }) {
    if (!incident || !OPEN_STATUSES.has(incident.status) || incident.dispatch_stage === 'STAND_DOWN') throw Object.assign(new Error('Incident is closed.'), { status: 409 });
    if (!authorized || !principal?.id || !['streamer', 'guardian', 'trusted_contact'].includes(role)) throw Object.assign(new Error('Not authorized for this incident stream.'), { status: 403 });
    if (this.revoked.has(incident.incident_id)) throw Object.assign(new Error('Incident stream access has been revoked.'), { status: 410 });
    if (this.demoMode) return { mode: 'demo', simulated: true, recording_enabled: false, room: this.roomName(incident.incident_id), source: 'generated-test-pattern', expires_at: new Date(this.now() + 60_000).toISOString(), token: null, server_url: null, can_publish: role === 'streamer', can_subscribe: role !== 'streamer' };
    if (!this.configured) throw Object.assign(new Error('LiveKit is not configured.'), { status: 503 });

    const room = this.roomName(incident.incident_id);
    await this.ensureRoom(room);
    const ttlSeconds = Math.max(30, Math.min(600, Number(this.env.LIVEKIT_TOKEN_TTL_SECONDS) || 180));
    const identity = `${role}:${String(principal.id).replace(/[^\w.-]/g, '').slice(0, 100)}`;
    const accessToken = new AccessToken(this.env.LIVEKIT_API_KEY, this.env.LIVEKIT_API_SECRET, {
      identity, name: String(principal.name || role).slice(0, 100), ttl: `${ttlSeconds}s`,
      metadata: JSON.stringify({ incident_id: incident.incident_id, role })
    });
    accessToken.addGrant({ roomJoin: true, room, canPublish: role === 'streamer', canPublishData: false, canSubscribe: role !== 'streamer', canUpdateOwnMetadata: false });
    const token = await accessToken.toJwt();
    let recordingEnabled = false;
    if (role === 'streamer' && this.recordingConfigured) {
      try { await this.startRecording(incident.incident_id, room); recordingEnabled = true; }
      catch { recordingEnabled = false; }
    }
    const turn = this.turnCredentials(principal, role, ttlSeconds);
    return { mode: 'livekit', simulated: false, recording_enabled: recordingEnabled, room, source: null, expires_at: new Date(this.now() + ttlSeconds * 1000).toISOString(), token, server_url: this.websocketUrl, ice_servers: turn, can_publish: role === 'streamer', can_subscribe: role !== 'streamer' };
  }

  turnCredentials(principal, role, ttlSeconds) {
    const urls = String(this.env.LIVEKIT_TURN_URL || '').split(',').map((url) => url.trim()).filter(Boolean);
    const secret = String(this.env.TURN_SHARED_SECRET || '');
    if (!urls.length || !secret) return undefined;
    const username = `${Math.floor(this.now() / 1000) + ttlSeconds}:${role}:${String(principal.id).replace(/[^\w.-]/g, '').slice(0, 80)}`;
    const credential = createHmac('sha1', secret).update(username).digest('base64');
    return { iceServers: [{ urls, username, credential }] };
  }

  async ensureRoom(room) {
    if (this.rooms.has(room)) return;
    try { await this.roomService.createRoom({ name: room, emptyTimeout: 60, departureTimeout: 30, maxParticipants: Number(this.env.LIVEKIT_MAX_PARTICIPANTS) || 12 }); }
    catch (error) {
      if (!/already exists|already_started|conflict/i.test(String(error.message))) throw error;
    }
    this.rooms.set(room, true);
  }

  async startRecording(incidentId, room) {
    if (!this.recordingConfigured || this.egresses.has(incidentId)) return null;
    const bucket = this.env.LIVEKIT_EGRESS_S3_BUCKET;
    const key = `${String(this.env.LIVEKIT_EGRESS_PREFIX || 'fule-evidence').replace(/^\/+|\/+$/g, '')}/${incidentId}/${Date.now()}.mp4`;
    const output = new EncodedFileOutput({ filepath: key, output: { case: 's3', value: new S3Upload({
      accessKey: this.env.AWS_ACCESS_KEY_ID, secret: this.env.AWS_SECRET_ACCESS_KEY,
      region: this.env.AWS_REGION || 'us-east-1', bucket, endpoint: this.env.AWS_S3_ENDPOINT || '', forcePathStyle: this.env.AWS_S3_FORCE_PATH_STYLE === 'true'
    }) } });
    const egress = await this.egressClient.startRoomCompositeEgress(room, { file: output }, { audioOnly: false, webhooks: [{ url: this.env.LIVEKIT_WEBHOOK_URL, signingKey: this.env.LIVEKIT_API_KEY }] });
    this.egresses.set(incidentId, { egress_id: egress.egressId, room, bucket, key });
    return egress.egressId;
  }

  async revokeIncident(incidentId) {
    this.revoked.add(incidentId);
    const room = this.roomName(incidentId);
    if (!this.configured) return;
    try {
      const participants = await this.roomService.listParticipants(room);
      await Promise.allSettled(participants.map(({ identity }) => this.roomService.removeParticipant(room, identity, { revokeTokenTs: BigInt(Math.floor(this.now() / 1000)) })));
      await this.roomService.deleteRoom(room);
    } catch (error) {
      if (!/not found|does not exist/i.test(String(error.message))) throw error;
    } finally { this.rooms.delete(room); }
  }

  async handleWebhook(rawBody, authorization) {
    if (!this.configured) throw new Error('LiveKit webhook verification is not configured.');
    const receiver = this.webhookReceiver || new WebhookReceiver(this.env.LIVEKIT_API_KEY, this.env.LIVEKIT_API_SECRET);
    const event = await receiver.receive(rawBody, authorization);
    if (event.event !== 'egress_ended') return { handled: false, event: event.event };
    const info = event.egressInfo;
    const incidentId = info?.roomName && [...this.egresses.entries()].find(([, record]) => record.room === info.roomName)?.[0];
    const record = incidentId && this.egresses.get(incidentId);
    const file = info?.fileResults?.[0];
    if (!record || !file?.filename) return { handled: false, event: event.event };
    const key = file.filename || record.key;
    const { sha256, bytes } = await this.hashS3Object(record.bucket, key);
    const entry = await this.evidenceVault.appendExternalHash(incidentId, {
      sha256, storageKey: `s3://${record.bucket}/${key}`,
      recordedAt: file.endedAt ? new Date(Number(file.endedAt) / 1_000_000).toISOString() : new Date(this.now()).toISOString(),
      metadata: { source: 'livekit_egress', bytes, s3_bucket: record.bucket, s3_key: key }
    });
    this.recordingEntries.set(incidentId, entry);
    return { handled: true, incident_id: incidentId, evidence: { sequence: entry.sequence, sha256: entry.sha256, chain_hash: entry.chain_hash } };
  }

  async hashS3Object(bucket, key) {
    if (this.s3ObjectReader) {
      const body = await this.s3ObjectReader(bucket, key);
      const hash = createHash('sha256'); let bytes = 0;
      if (Buffer.isBuffer(body) || body instanceof Uint8Array) { hash.update(body); bytes = body.byteLength; }
      else for await (const chunk of body) { hash.update(chunk); bytes += chunk.length; }
      return { sha256: hash.digest('hex'), bytes };
    }
    if (!this.env.AWS_S3_ENDPOINT) throw new Error('Self-hosted object storage endpoint is required.');
    const client = new S3Client({ region: this.env.AWS_REGION || 'us-east-1', endpoint: this.env.AWS_S3_ENDPOINT, forcePathStyle: this.env.AWS_S3_FORCE_PATH_STYLE === 'true', credentials: { accessKeyId: this.env.AWS_ACCESS_KEY_ID, secretAccessKey: this.env.AWS_SECRET_ACCESS_KEY } });
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const digest = createHash('sha256'); let bytes = 0;
    for await (const chunk of response.Body) { digest.update(chunk); bytes += chunk.length; }
    return { sha256: digest.digest('hex'), bytes };
  }

  async pruneRecordings({ deleteObject, maxAgeDays = Number(this.env.LIVEKIT_RECORDING_RETENTION_DAYS) || 30, now = this.now() } = {}) {
    const cutoff = now - Math.max(1, maxAgeDays) * 86_400_000;
    const removed = [];
    const expired = await this.evidenceStore.listExpiredStreamRecordings(new Date(cutoff));
    for (const entry of expired) {
      if (deleteObject || this.s3ObjectDeleter) await (deleteObject || this.s3ObjectDeleter)(entry.metadata.s3_bucket, entry.metadata.s3_key);
      else {
        if (!this.env.AWS_S3_ENDPOINT) throw new Error('Self-hosted object storage endpoint is required for retention cleanup.');
        const { S3Client, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
        const client = new S3Client({ region: this.env.AWS_REGION || 'us-east-1', endpoint: this.env.AWS_S3_ENDPOINT, forcePathStyle: this.env.AWS_S3_FORCE_PATH_STYLE === 'true', credentials: { accessKeyId: this.env.AWS_ACCESS_KEY_ID, secretAccessKey: this.env.AWS_SECRET_ACCESS_KEY } });
        await client.send(new DeleteObjectCommand({ Bucket: entry.metadata.s3_bucket, Key: entry.metadata.s3_key }));
      }
      await this.evidenceVault.appendRetentionTombstone(entry, new Date(now).toISOString());
      removed.push({ incident_id: entry.incident_id, evidence_sequence: entry.sequence });
    }
    return removed;
  }
}

export function createLiveStreamService(options) { return new LiveStreamService(options); }
