// Integration tests for replay.ts and session.ts.
// Requires Redis running at REDIS_URL (default: redis://127.0.0.1:6379).
// Skipped automatically if Redis is unreachable.

import { test, before, after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { redis } from '../src/services/redis.js';
import { isTxUsed, markTxUsed } from '../src/services/replay.js';
import { storeSession, getSession, deleteSession } from '../src/services/session.js';

const TEST_TX      = '0x' + 'a'.repeat(64);
const TEST_SESSION = 'test-session-' + Date.now();
const TEST_DATA    = { publicKey: 'testkey', allowedIP: '10.0.0.99', wireGuardConfig: '' };

let redisAvailable = false;

before(async () => {
  try {
    await redis.connect();  // explicit connect required with lazyConnect + enableOfflineQueue:false
    await redis.ping();
    redisAvailable = true;
    await redis.del(`tollgate:used_tx:${TEST_TX}`);
    await redis.del(`tollgate:session:${TEST_SESSION}`);
  } catch {
    console.warn('[redis.test] Redis unavailable — all tests will be skipped');
  }
});

after(async () => {
  if (redisAvailable) {
    await redis.del(`tollgate:used_tx:${TEST_TX}`);
    await redis.del(`tollgate:session:${TEST_SESSION}`);
  }
  // Close the connection so the test process can exit cleanly.
  await redis.quit().catch(() => redis.disconnect());
});

// ─── Replay protection ────────────────────────────────────────────────────────

test('isTxUsed returns false for unknown hash', async (t: TestContext) => {
  if (!redisAvailable) return t.skip('Redis unavailable');
  assert.equal(await isTxUsed(TEST_TX), false);
});

test('markTxUsed marks hash as used', async (t: TestContext) => {
  if (!redisAvailable) return t.skip('Redis unavailable');
  await markTxUsed(TEST_TX, 60);
  assert.equal(await isTxUsed(TEST_TX), true);
});

test('marked key has a TTL set', async (t: TestContext) => {
  if (!redisAvailable) return t.skip('Redis unavailable');
  const ttl = await redis.ttl(`tollgate:used_tx:${TEST_TX}`);
  assert.ok(ttl > 0 && ttl <= 60, `expected TTL in (0, 60], got ${ttl}`);
});

// ─── Session store ────────────────────────────────────────────────────────────

test('getSession returns null for unknown session', async (t: TestContext) => {
  if (!redisAvailable) return t.skip('Redis unavailable');
  assert.equal(await getSession(TEST_SESSION), null);
});

test('storeSession and getSession round-trip', async (t: TestContext) => {
  if (!redisAvailable) return t.skip('Redis unavailable');
  await storeSession(TEST_SESSION, TEST_DATA, 60);
  const result = await getSession(TEST_SESSION);
  assert.deepEqual(result, TEST_DATA);
});

test('deleteSession removes the key', async (t: TestContext) => {
  if (!redisAvailable) return t.skip('Redis unavailable');
  await deleteSession(TEST_SESSION);
  assert.equal(await getSession(TEST_SESSION), null);
});
