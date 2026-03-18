// Agent simulation (Day 2) — uses Openfort backend wallet for USDC payment.
//
// Flow:
//   1. GET /vpn → 402 with payment requirements
//   2. Ensure USDC contract is registered in Openfort (con_ ID required)
//   3. Send USDC via Openfort backend wallet (returns confirmed tx immediately)
//   4. GET /vpn with X-Payment: <txHash> → WireGuard config
//   5. Save config + structured receipt
//
// Required env vars (add to .env):
//   OPENFORT_SECRET_KEY     — Openfort API secret key (sk_...)
//   OPENFORT_WALLET_SECRET  — backend embedded wallet secret
//   OPENFORT_ACCOUNT_ID     — acc_... backend wallet account identifier
//   TOLLGATE_URL            — e.g. http://138.68.93.190:3002

import 'dotenv/config';
import Openfort from '@openfort/openfort-node';
import { writeFileSync } from 'node:fs';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface X402Offer {
  maxAmountRequired: string;
  payTo: string;
  asset: string;
}

interface X402Body {
  accepts?: X402Offer[];
}

interface VpnBody {
  sessionId: string;
  allowedIP: string;
  expiresIn: number;
  wireGuardConfig: string;
}

interface Receipt {
  timestamp: string;
  intentId: string;
  txHash: string;
  amountUSDC: string;
  payTo: string;
  sessionId: string;
  allowedIP: string;
  expiresIn: number;
  configPath: string;
}

// ─── Env validation ────────────────────────────────────────────────────────────

const {
  OPENFORT_SECRET_KEY,
  OPENFORT_WALLET_SECRET,
  OPENFORT_ACCOUNT_ID,
  TOLLGATE_URL,
} = process.env;

if (!OPENFORT_SECRET_KEY)    throw new Error('OPENFORT_SECRET_KEY not set in .env');
if (!OPENFORT_WALLET_SECRET) throw new Error('OPENFORT_WALLET_SECRET not set in .env');
if (!OPENFORT_ACCOUNT_ID)    throw new Error('OPENFORT_ACCOUNT_ID not set in .env');
if (!TOLLGATE_URL)           throw new Error('TOLLGATE_URL not set in .env');

const VPN_URL = `${TOLLGATE_URL}/vpn`;

// ── Base Sepolia (testnet) ─────────────────────────────────────────────────────
const BASE_CHAIN_ID = 84532;
const USDC_ADDRESS  = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const RPC_URL       = 'https://sepolia.base.org';

// ── Base Mainnet (production) ──────────────────────────────────────────────────
// TODO(mainnet): swap these in and comment out the Sepolia block above when a
// live Openfort key is available and BASE_CHAIN_ID=8453 is set in .env
// const BASE_CHAIN_ID = 8453;
// const USDC_ADDRESS  = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
// const RPC_URL       = 'https://mainnet.base.org';

const USDC_ABI = [
  { inputs:[{internalType:'address',name:'to',type:'address'},{internalType:'uint256',name:'value',type:'uint256'}],
    name:'transfer', outputs:[{internalType:'bool',name:'',type:'bool'}], stateMutability:'nonpayable', type:'function' },
];

const openfort = new Openfort(OPENFORT_SECRET_KEY, { walletSecret: OPENFORT_WALLET_SECRET });

// ─── Step 1: Hit /vpn → 402 ────────────────────────────────────────────────────

console.log(`\n[1] GET ${VPN_URL}`);
const probeRes  = await fetch(VPN_URL);
const probeBody = await probeRes.json() as X402Body;

if (probeRes.status !== 402) {
  console.error('Expected 402, got:', probeRes.status, probeBody);
  process.exit(1);
}

const offer = probeBody.accepts?.[0];
if (!offer) {
  console.error('No payment offer in 402 response:', probeBody);
  process.exit(1);
}

console.log(`[1] 402 received — payment required: ${offer.maxAmountRequired} USDC to ${offer.payTo}`);

// ─── Step 2: Ensure USDC contract is registered in Openfort ──────────────────

console.log('\n[2] Checking USDC contract registration in Openfort...');

let usdcContractId: string;

const contracts = await openfort.contracts.list();
const existing  = contracts.data?.find(
  (c: { address?: string; chainId?: number; id: string }) =>
    c.address?.toLowerCase() === USDC_ADDRESS.toLowerCase() && c.chainId === BASE_CHAIN_ID
);

if (existing) {
  usdcContractId = existing.id;
  console.log(`[2] USDC already registered: ${usdcContractId}`);
} else {
  console.log('[2] Registering USDC contract with Openfort...');
  const created = await openfort.contracts.create({
    name:    'USDC Base Sepolia',
    chainId: BASE_CHAIN_ID,
    address: USDC_ADDRESS,
    abi:     USDC_ABI,
  });
  usdcContractId = created.id as string;
  console.log(`[2] Registered: ${usdcContractId}`);
}

// ─── Step 3: Send USDC via Openfort backend wallet ────────────────────────────

const amountUnits = String(Math.round(parseFloat(offer.maxAmountRequired) * 1e6));

console.log(`\n[3] Sending ${offer.maxAmountRequired} USDC → ${offer.payTo} via Openfort...`);

const account = await openfort.accounts.evm.backend.get({ id: OPENFORT_ACCOUNT_ID });

const result = await openfort.accounts.evm.backend.sendTransaction({
  account,
  chainId:      BASE_CHAIN_ID,
  rpcUrl:       RPC_URL,
  interactions: [
    {
      contract:     usdcContractId,
      functionName: 'transfer',
      functionArgs: [offer.payTo, amountUnits],
    },
  ],
});

// SDK blocks until confirmed — txHash should be present.
// If not (e.g. bundler lag), poll the intent until it appears.
let txHash = (result as { response?: { transactionHash?: string } }).response?.transactionHash;

if (!txHash) {
  const intentId = (result as { id: string }).id;
  console.log(`[3] Waiting for on-chain confirmation (intent: ${intentId})...`);
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const intent = await openfort.transactionIntents.get(intentId) as {
      response?: { transactionHash?: string };
    };
    txHash = intent.response?.transactionHash;
    if (txHash) break;
    console.log(`[3] Still waiting... (${(i + 1) * 5}s)`);
  }
}

if (!txHash) {
  console.error('[3] Transaction not confirmed after 5 minutes.');
  process.exit(1);
}

console.log(`[3] Confirmed — tx: ${txHash}`);

// ─── Step 4: Retry /vpn with X-Payment ────────────────────────────────────────

console.log(`\n[4] GET ${VPN_URL} with X-Payment: ${txHash}`);
const payRes  = await fetch(VPN_URL, { headers: { 'X-Payment': txHash } });
const payBody = await payRes.json() as VpnBody;

if (payRes.status !== 200) {
  console.error('[4] Payment rejected:', payBody);
  process.exit(1);
}

console.log('[4] 200 received — WireGuard config provisioned');
console.log(`    Session ID : ${payBody.sessionId}`);
console.log(`    Allowed IP : ${payBody.allowedIP}`);
console.log(`    Expires in : ${payBody.expiresIn}s`);

// ─── Step 5: Save config + receipt ────────────────────────────────────────────

const configPath  = '/tmp/tollgate-client.conf';
const receiptPath = '/tmp/tollgate-receipt.json';

writeFileSync(configPath, payBody.wireGuardConfig);

const receipt: Receipt = {
  timestamp:  new Date().toISOString(),
  intentId:   (result as { id: string }).id,
  txHash,
  amountUSDC: offer.maxAmountRequired,
  payTo:      offer.payTo,
  sessionId:  payBody.sessionId,
  allowedIP:  payBody.allowedIP,
  expiresIn:  payBody.expiresIn,
  configPath,
};

writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));

console.log(`\n[5] Tollgate access provisioned.`);
console.log(`    WireGuard config : ${configPath}`);
console.log(`    Receipt          : ${receiptPath}`);
console.log(`\n    Connect with: sudo wg-quick up ${configPath}`);

// ─── Openfort reference ────────────────────────────────────────────────────────

console.log(`\n── Openfort ────────────────────────────────────────────────────────────`);
console.log(`    Intent ID      : ${(result as { id: string }).id}`);
console.log(`    Account        : ${OPENFORT_ACCOUNT_ID}`);
