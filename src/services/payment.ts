// On-chain USDC verification via Alchemy (chain configured by BASE_CHAIN_ID env var).
//
// Verification steps:
//   1. Validate tx hash format (0x + 64 hex chars)
//   2. Fetch receipt via Alchemy with 10s timeout
//   3. Receipt must exist and status === 1
//   4. Parse Transfer event logs — match to === PAYMENT_RECIPIENT_ADDRESS,
//      value >= PAYMENT_AMOUNT_USDC (6 decimals)
//   5. Replay protection: reject if txHash already used (replay.ts)
//   6. Mark txHash as used, return { valid: true, from }
//
// PAYMENT_STUB=true  — skips Alchemy and accepts any well-formed hash.
//                      Set automatically via `npm test` for offline testing.

import { ethers } from 'ethers';
import { buildConfig } from '../config.js';
import { isTxUsed, markTxUsed } from './replay.js';

const config = buildConfig();

const TX_HASH_RE   = /^0x[0-9a-fA-F]{64}$/;
const TRANSFER_ABI = ['event Transfer(address indexed from, address indexed to, uint256 value)'];
const RPC_RETRY_ATTEMPTS = 4;
const RPC_RETRY_DELAY_MS = 5_000;

export interface PaymentResult {
  valid: boolean;
  reason?: string;
  from?: string;
}

// Lazy provider — only initialised when a real verification is needed.
let provider: ethers.JsonRpcProvider | undefined;
function getProvider(): ethers.JsonRpcProvider {
  if (!provider) {
    if (!config.ALCHEMY_API_KEY) {
      throw new Error('ALCHEMY_API_KEY is required for payment verification');
    }
    const subdomain = config.BASE_CHAIN_ID === 84532 ? 'base-sepolia' : 'base-mainnet';
    provider = new ethers.JsonRpcProvider(
      `https://${subdomain}.g.alchemy.com/v2/${config.ALCHEMY_API_KEY}`
    );
  }
  return provider;
}

export async function verifyPayment(txHash: string): Promise<PaymentResult> {
  // 1. Format check (applies in all modes)
  if (!TX_HASH_RE.test(txHash)) {
    return { valid: false, reason: 'Invalid tx hash format' };
  }

  // Stub mode: used by `npm test` to avoid hitting Alchemy
  if (process.env.PAYMENT_STUB === 'true') {
    return { valid: true };
  }

  // 2. Phase 3 config guard
  if (!config.PAYMENT_RECIPIENT_ADDRESS) {
    return { valid: false, reason: 'Server misconfigured: PAYMENT_RECIPIENT_ADDRESS not set' };
  }

  try {
    // 3. Fetch receipt with retries — Sepolia RPC nodes may lag behind bundler confirmation
    let receipt: ethers.TransactionReceipt | null = null;
    for (let attempt = 1; attempt <= RPC_RETRY_ATTEMPTS; attempt++) {
      receipt = await getProvider().getTransactionReceipt(txHash);
      if (receipt) break;
      if (attempt < RPC_RETRY_ATTEMPTS) {
        await new Promise(r => setTimeout(r, RPC_RETRY_DELAY_MS));
      }
    }

    // 4. Receipt must exist
    if (!receipt) {
      return { valid: false, reason: `Transaction not found after ${RPC_RETRY_ATTEMPTS} attempts` };
    }

    // 5. TX must have succeeded
    if (receipt.status !== 1) {
      return { valid: false, reason: 'Transaction failed on-chain' };
    }

    // 6. Find a matching USDC Transfer log
    const iface = new ethers.Interface(TRANSFER_ABI);
    const expectedAmount = BigInt(Math.round(parseFloat(config.PAYMENT_AMOUNT_USDC) * 1e6));
    let senderAddress: string | undefined;

    const matched = receipt.logs.some((log: ethers.Log) => {
      if (log.address.toLowerCase() !== config.USDC_CONTRACT_ADDRESS.toLowerCase()) return false;
      try {
        const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
        if (
          parsed &&
          (parsed.args['to'] as string).toLowerCase() === config.PAYMENT_RECIPIENT_ADDRESS.toLowerCase() &&
          (parsed.args['value'] as bigint) >= expectedAmount
        ) {
          senderAddress = parsed.args['from'] as string;
          return true;
        }
      } catch {
        // Not a Transfer log — skip
      }
      return false;
    });

    if (!matched) {
      return { valid: false, reason: 'No matching USDC transfer found in transaction' };
    }

    // 7. Replay protection
    if (await isTxUsed(txHash)) {
      return { valid: false, reason: 'Transaction already used' };
    }
    await markTxUsed(txHash);

    return { valid: true, from: senderAddress };

  } catch (err) {
    const raw = (err as Error).message.replace(/\/v2\/[^/\s"]+/g, '/v2/[redacted]');
    return { valid: false, reason: `RPC error: ${raw}` };
  }
}
