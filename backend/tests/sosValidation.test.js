import test from 'node:test';
import assert from 'node:assert/strict';
import { createStreamerRateLimiter, validateSosPayload } from '../services/sosValidation.js';

const validPayload = {
  streamer_id: 'streamer-abc123',
  location: { lat: 12.9716, lng: 77.5946 },
  module_type: 'FULE_PROTECT',
  audio_transcript_snippet: 'Please help.',
  source: 'button'
};

test('SOS validation accepts a valid module and source', () => {
  const result = validateSosPayload(validPayload);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.location, { lat: 12.9716, lng: 77.5946, address: 'Simulated location · address withheld publicly' });
});

test('SOS validation rejects missing streamer and out-of-range coordinates', () => {
  assert.equal(validateSosPayload({ ...validPayload, streamer_id: '' }).ok, false);
  assert.equal(validateSosPayload({ ...validPayload, location: { lat: 91, lng: 0 } }).ok, false);
  assert.equal(validateSosPayload({ ...validPayload, location: { lat: 0, lng: 181 } }).ok, false);
});

test('SOS validation rejects unknown module, source, and non-text transcript', () => {
  assert.equal(validateSosPayload({ ...validPayload, module_type: 'UNKNOWN' }).ok, false);
  assert.equal(validateSosPayload({ ...validPayload, source: 'webhook' }).ok, false);
  assert.equal(validateSosPayload({ ...validPayload, audio_transcript_snippet: {} }).ok, false);
});

test('SOS validation enforces strict field and size limits', () => {
  assert.equal(validateSosPayload({ ...validPayload, extra: true }).ok, false);
  assert.equal(validateSosPayload({ ...validPayload, audio_transcript_snippet: 'x'.repeat(4001) }).ok, false);
  assert.equal(validateSosPayload({ ...validPayload, location: { lat: '12.9', lng: 77.5 } }).ok, false);
  assert.equal(validateSosPayload({ ...validPayload, location: { lat: 0, lng: 0, precise_note: 'secret' } }).ok, false);
});

test('SOS schema fuzzing malformed JSON-shaped inputs never throws', () => {
  let seed = 0xF01E;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x1_0000_0000; };
  const values = [null, true, false, 0, 1, -1, '', 'x'.repeat(5000), [], {}, { lat: null }, { lat: {}, lng: [] }, { lat: 91, lng: 181 }];
  for (let index = 0; index < 1_000; index += 1) {
    const candidate = { streamer_id: random() < 0.5 ? `fuzz-${index}` : values[Math.floor(random() * values.length)], location: values[Math.floor(random() * values.length)], module_type: values[Math.floor(random() * values.length)], source: values[Math.floor(random() * values.length)], audio_transcript_snippet: values[Math.floor(random() * values.length)] };
    assert.doesNotThrow(() => validateSosPayload(candidate));
  }
});

test('rate limit allows three incidents in five minutes per streamer', () => {
  const limit = createStreamerRateLimiter({ limit: 3, windowMs: 300_000 });
  assert.equal(limit('streamer-a', 10).allowed, true);
  assert.equal(limit('streamer-a', 20).allowed, true);
  assert.equal(limit('streamer-a', 30).allowed, true);
  assert.deepEqual(limit('streamer-a', 40), { allowed: false, retryAfterMs: 299_970 });
  assert.equal(limit('streamer-b', 40).allowed, true);
  assert.equal(limit('streamer-a', 300_010).allowed, true);
});
