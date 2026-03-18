// TX hash replay protection (Redis).
//
// Prevents the same payment tx from being used more than once.
//
// Key format: tollgate:used_tx:<txHash>  →  TTL = 7 days (604800s)
//
// STRICT_REPLAY_CHECK (config):
//   false (default) — Redis downtime fails open: logs warning, allows request.
//                     Safe for development; avoids blocking on Redis restarts.
//   true            — Redis downtime throws, caller returns 503. Set in
//                     production to prevent double-spend during outages.

import { redis } from './redis.js';
import { buildConfig } from '../config.js';
import { logger } from '../logger.js';

const config = buildConfig();
const key = (txHash: string): string => `tollgate:used_tx:${txHash}`;

export async function isTxUsed(txHash: string): Promise<boolean> {
  try {
    return (await redis.exists(key(txHash))) === 1;
  } catch (err) {
    if (config.STRICT_REPLAY_CHECK) throw err;
    logger.warn({ err }, '[replay] Redis down — replay check skipped');
    return false;
  }
}

export async function markTxUsed(txHash: string, ttlSeconds = 604800): Promise<boolean> {
  try {
    await redis.set(key(txHash), '1', 'EX', ttlSeconds);
    return true;
  } catch (err) {
    if (config.STRICT_REPLAY_CHECK) throw err;
    logger.warn({ err }, '[replay] Redis down — markTxUsed skipped');
    return false;
  }
}
