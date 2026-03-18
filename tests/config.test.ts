import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildConfig } from '../src/config.js';

const base = { PORT: '3000', REDIS_URL: 'redis://127.0.0.1:6379' };

test('throws when PORT is missing', () => {
  assert.throws(
    () => buildConfig({ REDIS_URL: 'redis://127.0.0.1:6379' }),
    /PORT/
  );
});

test('throws when REDIS_URL is missing', () => {
  assert.throws(
    () => buildConfig({ PORT: '3000' }),
    /REDIS_URL/
  );
});

test('throws when PORT is not a number', () => {
  assert.throws(
    () => buildConfig({ ...base, PORT: 'notanumber' }),
    /PORT must be a valid number/
  );
});

test('throws when SESSION_TTL_SECONDS is not a number', () => {
  assert.throws(
    () => buildConfig({ ...base, SESSION_TTL_SECONDS: 'bad' }),
    /SESSION_TTL_SECONDS must be a valid number/
  );
});

test('returns frozen config with correct types', () => {
  const cfg = buildConfig(base);
  assert.equal(cfg.PORT, 3000);
  assert.equal(cfg.REDIS_URL, 'redis://127.0.0.1:6379');
  assert.equal(cfg.SESSION_TTL_SECONDS, 3600); // default
  assert.equal(cfg.STRICT_REPLAY_CHECK, false);
  assert.ok(Object.isFrozen(cfg));
});

test('STRICT_REPLAY_CHECK is true only when env var is the string "true"', () => {
  assert.equal(buildConfig({ ...base, STRICT_REPLAY_CHECK: 'true' }).STRICT_REPLAY_CHECK, true);
  assert.equal(buildConfig({ ...base, STRICT_REPLAY_CHECK: 'false' }).STRICT_REPLAY_CHECK, false);
  assert.equal(buildConfig({ ...base, STRICT_REPLAY_CHECK: '1' }).STRICT_REPLAY_CHECK, false);
});
