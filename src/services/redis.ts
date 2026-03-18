// Shared ioredis client.
//
// enableOfflineQueue: false — commands fail immediately when Redis is
// disconnected rather than queuing. Required for STRICT_REPLAY_CHECK to
// fail fast instead of hanging until Redis reconnects.

import { Redis } from 'ioredis';
import { buildConfig } from '../config.js';
import { logger } from '../logger.js';

const config = buildConfig();

export const redis = new Redis(config.REDIS_URL, {
  lazyConnect: true,            // connect on first command, not on import
  enableOfflineQueue: false,    // fail immediately when disconnected — required for STRICT_REPLAY_CHECK
  maxRetriesPerRequest: 1,      // fail fast if Redis is persistently down
  retryStrategy(times: number) {
    // Exponential backoff capped at 5s
    return Math.min(times * 200, 5000);
  },
});

redis.on('error', (err: Error) => {
  // Log but never crash — services handle Redis downtime individually
  logger.error({ err }, '[redis] error');
});

redis.on('connect', () => {
  logger.info('[redis] connected');
});

redis.on('reconnecting', () => {
  logger.warn('[redis] reconnecting...');
});

export async function disconnect(): Promise<void> {
  await redis.quit();
}
