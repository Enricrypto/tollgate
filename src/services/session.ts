// WireGuard peer session store (Redis).
//
// Stores per-session data after a successful payment:
//   { publicKey, allowedIP, wireGuardConfig }  →  TTL = SESSION_TTL_SECONDS
//
// Key format: tollgate:session:<sessionId>
//
// Replay protection (used TX hashes) lives in replay.ts — separate concern.

import { redis, disconnect } from './redis.js';

export interface SessionData {
  publicKey: string;
  allowedIP: string;
  wireGuardConfig: string;
}

const key = (sessionId: string): string => `tollgate:session:${sessionId}`;

export async function storeSession(
  sessionId: string,
  data: SessionData,
  ttlSeconds: number,
): Promise<boolean> {
  try {
    await redis.set(key(sessionId), JSON.stringify(data), 'EX', ttlSeconds);
    return true;
  } catch (err) {
    console.error('[session] storeSession failed:', (err as Error).message);
    return false;
  }
}

export async function getSession(sessionId: string): Promise<SessionData | null> {
  try {
    const raw = await redis.get(key(sessionId));
    return raw ? (JSON.parse(raw) as SessionData) : null;
  } catch (err) {
    console.error('[session] getSession failed:', (err as Error).message);
    return null;
  }
}

export async function deleteSession(sessionId: string): Promise<boolean> {
  try {
    await redis.del(key(sessionId));
    return true;
  } catch (err) {
    console.error('[session] deleteSession failed:', (err as Error).message);
    return false;
  }
}

// Re-export for graceful shutdown in main.ts
export { disconnect };
