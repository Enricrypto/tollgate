import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { app } from '../src/server.js';
import { redis } from '../src/services/redis.js';

// Valid stub tx hash: 0x + 64 hex chars
const VALID_TX   = '0x' + '0'.repeat(63) + '1';
const INVALID_TX = 'badvalue';

let server: Server;
let baseUrl: string;

before(async () => {
  await new Promise<void>(resolve => {
    server = createServer(app);
    server.listen(0, () => {
      const addr = server.address();
      baseUrl = `http://localhost:${typeof addr === 'object' && addr ? addr.port : 0}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
  // Close the shared Redis connection opened by server.ts → session.ts → redis.ts
  redis.disconnect();
});

// ─── Phase 1 ─────────────────────────────────────────────────────────────────

test('GET /vpn returns JSON content-type', async () => {
  const res = await fetch(`${baseUrl}/vpn`);
  assert.ok(res.headers.get('content-type')?.includes('application/json'));
});

test('unknown routes return 404', async () => {
  const res = await fetch(`${baseUrl}/notaroute`);
  assert.equal(res.status, 404);
});

// ─── Phase 2: no payment header ──────────────────────────────────────────────

test('GET /vpn with no X-Payment returns 402', async () => {
  const res = await fetch(`${baseUrl}/vpn`);
  assert.equal(res.status, 402);
});

test('402 body has correct x402Version and shape', async () => {
  const res  = await fetch(`${baseUrl}/vpn`);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body['x402Version'], 1);
  assert.equal(body['error'], 'Payment required');
  assert.ok(Array.isArray(body['accepts']));
  assert.equal((body['accepts'] as unknown[]).length, 1);

  const offer = (body['accepts'] as Record<string, unknown>[])[0];
  assert.equal(offer['scheme'], 'exact');
  assert.equal(offer['network'], 'base');
  assert.ok(typeof offer['maxAmountRequired'] === 'string');
  assert.ok(typeof offer['resource'] === 'string');
  assert.ok(typeof offer['payTo'] === 'string');
  assert.ok(typeof offer['asset'] === 'string');
  assert.equal((offer['extra'] as Record<string, string>)['name'], 'USD Coin');
  assert.equal((offer['extra'] as Record<string, string>)['version'], '2');
});

// ─── Phase 2 + 5: with payment header ────────────────────────────────────────

test('GET /vpn with valid tx hash returns 200 with WireGuard config', async () => {
  const res  = await fetch(`${baseUrl}/vpn`, {
    headers: { 'X-Payment': VALID_TX },
  });
  assert.equal(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assert.ok(typeof body['sessionId'] === 'string');
  assert.ok(typeof body['wireGuardConfig'] === 'string');
  assert.ok(typeof body['allowedIP'] === 'string');
  assert.ok(typeof body['expiresIn'] === 'number');
});

test('GET /vpn with invalid tx hash returns 402 with reason', async () => {
  const res  = await fetch(`${baseUrl}/vpn`, {
    headers: { 'X-Payment': INVALID_TX },
  });
  assert.equal(res.status, 402);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body['error'], 'Payment verification failed');
  assert.ok(typeof body['reason'] === 'string');
});
