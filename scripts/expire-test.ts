// Manual peer expiry utility.
//
// Usage: node --import tsx/esm scripts/expire-test.ts <sessionId>
//
// Calls expirePeer(sessionId), then checks `wg show` to confirm the peer
// has been removed from the WireGuard interface.

import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { buildConfig } from '../src/config.js';
import { expirePeer } from '../src/services/wireguard.js';

const config:    ReturnType<typeof buildConfig> = buildConfig();
const sessionId: string | undefined             = process.argv[2];

if (!sessionId) {
  console.error('Usage: node --import tsx/esm scripts/expire-test.ts <sessionId>');
  process.exit(1);
}

console.log(`Expiring session: ${sessionId}`);
const removed = await expirePeer(sessionId);

if (!removed) {
  console.error('Session not found or already expired.');
  process.exit(1);
}

console.log('Peer removed. Checking wg show...');
try {
  const wgStatus = execFileSync('wg', ['show', config.WG_INTERFACE]).toString();
  console.log(wgStatus || '(no peers remaining)');
  console.log('Done.');
} catch {
  console.warn('Could not run wg show — is WireGuard installed and running?');
}
