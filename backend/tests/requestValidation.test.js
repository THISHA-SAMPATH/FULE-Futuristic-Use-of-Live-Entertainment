import test from 'node:test';
import assert from 'node:assert/strict';
import { validateJsonValue } from '../services/requestValidation.js';

test('request JSON validator enforces nested sizes and rejects prototype keys', () => {
  assert.deepEqual(validateJsonValue({ safe: ['bounded'] }), { valid: true });
  assert.equal(validateJsonValue({ text: 'x'.repeat(8193) }).valid, false);
  assert.equal(validateJsonValue({ nested: { deep: true } }, { maxDepth: 1 }).valid, false);
  assert.equal(validateJsonValue(JSON.parse('{"constructor":{"prototype":{"polluted":true}}}')).valid, false);
  assert.equal(validateJsonValue({ values: Array(201).fill('x') }).valid, false);
});

test('request JSON validator fuzzes malformed value shapes without throwing', () => {
  let state = 0x1badb002;
  const next = () => { state = (state * 1664525 + 1013904223) >>> 0; return state; };
  for (let index = 0; index < 2000; index += 1) {
    const shape = next() % 6;
    const value = shape === 0 ? null : shape === 1 ? next() : shape === 2 ? 'text'.repeat(next() % 3000) : shape === 3 ? Array.from({ length: next() % 220 }, () => next() % 10) : shape === 4 ? { nested: { value: next() } } : { ['key'.repeat(next() % 50)]: true };
    assert.doesNotThrow(() => validateJsonValue(value));
  }
});
