// Tests for src/services/payment.ts
//
// These tests run with PAYMENT_STUB=true (set by `npm test`) so they never
// hit Alchemy. They cover:
//   - Format validation (runs in all modes)
//   - Stub mode happy path
//
// Real on-chain verification is covered by the manual steps in Phase 3:
//   curl -H "X-Payment: 0x<real_tx_hash>" http://localhost:3000/vpn

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyPayment } from '../src/services/payment.js';

const VALID_TX   = '0x' + '0'.repeat(63) + '1';
const SHORT_TX   = '0x' + '0'.repeat(62) + '1'; // 65 chars total — too short
const NO_PREFIX  = '0'.repeat(64);
const UPPER_ONLY = '0x' + 'G'.repeat(64);       // invalid hex chars

test('rejects tx hash that is too short', async () => {
  const result = await verifyPayment(SHORT_TX);
  assert.equal(result.valid, false);
  assert.match(result.reason!, /Invalid tx hash format/);
});

test('rejects tx hash with no 0x prefix', async () => {
  const result = await verifyPayment(NO_PREFIX);
  assert.equal(result.valid, false);
  assert.match(result.reason!, /Invalid tx hash format/);
});

test('rejects tx hash with invalid hex chars', async () => {
  const result = await verifyPayment(UPPER_ONLY);
  assert.equal(result.valid, false);
  assert.match(result.reason!, /Invalid tx hash format/);
});

test('rejects empty string', async () => {
  const result = await verifyPayment('');
  assert.equal(result.valid, false);
  assert.match(result.reason!, /Invalid tx hash format/);
});

test('accepts valid hash in stub mode', async () => {
  // PAYMENT_STUB=true is set by the npm test script
  const result = await verifyPayment(VALID_TX);
  assert.equal(result.valid, true);
});
