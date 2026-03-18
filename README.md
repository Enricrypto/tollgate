# Tollgate

Pay-per-use WireGuard VPN gateway for autonomous agents. No subscriptions, no pre-auth — each access is gated by a USDC micropayment verified on Base.

**Flow:** agent hits `/vpn` → gets 402 → pays 0.01 USDC on Base Sepolia via Openfort → retries with tx hash → receives WireGuard peer config valid for 1 hour.

---

## How it works

### Payment protocol (x402)

Tollgate implements the [x402](https://x402.org) payment protocol. When an agent hits `GET /vpn` without a payment header, the server returns a `402 Payment Required` with a JSON body describing exactly what to pay, to whom, and on which network. The agent pays, then retries with `X-Payment: <txHash>`. The server verifies on-chain before provisioning access.

### Agent wallet (Openfort)

The agent script uses [Openfort](https://openfort.io) backend wallets to send USDC programmatically — no private keys in env vars, no manual signing. Openfort handles key custody, gas sponsorship, and ERC-4337 account abstraction under the hood.

### On-chain verification

The server uses Alchemy to fetch the transaction receipt from Base Sepolia and parses the ERC-20 `Transfer` event logs to verify:
- Transfer was sent to `PAYMENT_RECIPIENT_ADDRESS`
- Amount ≥ `PAYMENT_AMOUNT_USDC`
- USDC contract matches `USDC_CONTRACT_ADDRESS`

Because Openfort uses a bundler/paymaster, there can be a few seconds of indexing lag between when the UserOperation is confirmed and when Alchemy's RPC node returns the receipt. The server retries up to 4 times with 5s intervals before rejecting.

### Replay protection

Each tx hash is stored in Redis with a 7-day TTL. Submitting the same hash twice returns a 402.

### WireGuard provisioning

On successful payment, the server generates a unique keypair via the `wg` CLI, allocates an IP from `10.0.0.10–10.0.0.209`, adds the peer to the `wg0` interface, stores the session in Redis, and returns the client config string.

---

## Network

Currently running on **Base Sepolia (testnet)** — chainId `84532`, USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`.

Mainnet constants are commented in `scripts/agent-sim.ts` and `src/services/payment.ts` — swap them in when a live Openfort key is available.

---

## Stack

- **Node.js** (ESM, LTS) · **Express** · **TypeScript** · **tsx**
- **ethers.js v6** · **ioredis** · **pino** · **express-rate-limit**
- **WireGuard** (managed via `wg` CLI, no shell — `execFileSync`)
- **Openfort** (`@openfort/openfort-node`) — backend wallet for agent payments
- **Base Sepolia (testnet)** · USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`

---

## Quick start (local dev)

### Prerequisites

- Node.js 20+
- Redis running locally (`brew services start redis` on macOS)
- An [Alchemy](https://alchemy.com) API key (Base Sepolia)
- A Base wallet address to receive payments
- An [Openfort](https://openfort.io) account with a backend wallet configured

### Install

```bash
npm install
```

### Configure

```bash
cp .env.example .env
```

Fill in `.env`. Minimum required to start:

```
PORT=3002
REDIS_URL=redis://127.0.0.1:6379
ALCHEMY_API_KEY=your_key_here
PAYMENT_RECIPIENT_ADDRESS=0xYourWalletAddress
BASE_CHAIN_ID=84532
USDC_CONTRACT_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e
```

### Run

```bash
npm start          # production entry point (src/main.ts)
npm run dev        # auto-restarts on file changes
npm run typecheck  # type check without running
```

### Test

```bash
npm test           # runs all tests (uses PAYMENT_STUB and WG_STUB — no Alchemy or wg needed)
```

---

## Agent simulation (end-to-end test)

Simulates an autonomous agent paying USDC via Openfort and receiving a WireGuard config.

### Prerequisites

- Tollgate server running (`npm start`)
- An [Openfort](https://openfort.io) backend wallet account funded with:
  - Test ETH on Base Sepolia (gas) — [Alchemy faucet](https://www.alchemy.com/faucets/base-sepolia)
  - Test USDC on Base Sepolia — [Circle faucet](https://faucet.circle.com)

### Set up Openfort backend wallet

Create a backend wallet account (one-time setup):

```bash
node --input-type=module << 'EOF'
import 'dotenv/config';
import Openfort from '@openfort/openfort-node';
const of = new Openfort(process.env.OPENFORT_SECRET_KEY, { walletSecret: process.env.OPENFORT_WALLET_SECRET });
const account = await of.accounts.evm.backend.create({ chainId: 84532 });
console.log('OPENFORT_ACCOUNT_ID=' + account.id);
console.log('Wallet address:      ' + account.address);
EOF
```

Fund the printed wallet address via the faucets above, then add the account ID to `.env`.

### Configure

Add to `.env`:

```
OPENFORT_SECRET_KEY=sk_...
OPENFORT_WALLET_SECRET=...
OPENFORT_ACCOUNT_ID=acc_...
TOLLGATE_URL=http://your-server:3002
```

### Run

```bash
node --import tsx/esm scripts/agent-sim.ts
```

Expected output:

```
[1] GET http://your-server:3002/vpn
[1] 402 received — payment required: 0.01 USDC to 0x...

[2] Checking USDC contract registration in Openfort...
[2] USDC already registered: con_...

[3] Sending 0.01 USDC → 0x... via Openfort...
[3] Confirmed — tx: 0x...

[4] GET http://your-server:3002/vpn with X-Payment: 0x...
[4] 200 received — WireGuard config provisioned
    Session ID : <uuid>
    Allowed IP : 10.0.0.x
    Expires in : 3600s

[5] Tollgate access provisioned.
    WireGuard config : /tmp/tollgate-client.conf
    Receipt          : /tmp/tollgate-receipt.json

    Connect with: sudo wg-quick up /tmp/tollgate-client.conf

── Openfort ────────────────────────────────────────────────────────────
    Intent ID      : tin_...
    Account        : acc_...
```

### Connect the tunnel

```bash
sudo wg-quick up /tmp/tollgate-client.conf

# Disconnect
sudo wg-quick down /tmp/tollgate-client.conf
```

### Expire a session manually

```bash
node --import tsx/esm scripts/expire-test.ts <sessionId>
```

---

## Production deployment (Ubuntu VPS)

### Install dependencies

```bash
sudo apt update && sudo apt install wireguard redis-server -y
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
npm install -g pm2
```

### WireGuard server setup

```bash
# Generate server keypair
wg genkey | tee /etc/wireguard/server_private.key | wg pubkey > /etc/wireguard/server_public.key

# Create interface config (replace YOUR_PRIVATE_KEY and eth0 if needed)
cat > /etc/wireguard/wg0.conf << EOF
[Interface]
Address = 10.0.0.1/24
ListenPort = 51820
PrivateKey = YOUR_PRIVATE_KEY

PostUp   = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE
EOF

# Enable IP forwarding
echo "net.ipv4.ip_forward=1" | tee -a /etc/sysctl.conf && sysctl -p

# Start WireGuard
systemctl enable wg-quick@wg0 && systemctl start wg-quick@wg0
```

### Deploy and run

```bash
# Copy project to server
scp -r /path/to/tollgate user@your-server:~/tollgate

# On the server
cd ~/tollgate
cp .env.example .env && nano .env   # fill in all values
npm install

pm2 start src/main.ts --name tollgate --cwd ~/tollgate --interpreter tsx
pm2 save
pm2 startup
```

### Firewall

```bash
ufw allow 22/tcp
ufw allow 3002/tcp
ufw allow 51820/udp
ufw enable
```

### Production security checklist

Before going live, make sure these are set in your production `.env`:

| Setting | Production value | Why |
|---|---|---|
| `STRICT_REPLAY_CHECK` | `true` | Prevents replay attacks if Redis restarts — fails closed (503) instead of open |
| `PUBLIC_HOST` | `https://your-domain.com` | Ensures the 402 `resource` URL is correct behind a reverse proxy |
| `PAYMENT_AMOUNT_USDC` | your chosen price | Default `0.01` — adjust for mainnet economics |

Additional hardening in place out of the box:

- **Rate limiting** — `/vpn` is limited to 20 requests per IP per minute via `express-rate-limit`. Tune `max` in `src/server.ts` for your expected traffic.
- **No shell execution** — all `wg` CLI calls use `execFileSync` with explicit argument arrays, eliminating shell injection surface.
- **API key redaction** — Alchemy RPC errors are sanitised before being returned to clients; the API key is never exposed in 402 responses.
- **Peer lifecycle safety** — if Redis is unavailable when storing a new session, the WireGuard peer is rolled back (`wg set … remove`) before the 500 is returned, preventing zombie peers.

---

## Architecture

```
Agent
  │
  ▼
GET /vpn
  │
  ├─ Rate limit exceeded ───► 429 + retry message  (express-rate-limit)
  │
  ├─ No X-Payment ──────────► 402 + payment JSON   (x402 middleware)
  │
  └─ X-Payment: <txHash>
       │
       ▼
  payment.ts ──► Alchemy ──► Base Sepolia (retry up to 4×5s)
       │
       ├─ invalid ───────────► 402 + reason
       │
       └─ valid
             │
             ▼
        replay.ts ──► Redis (replay check + mark used)
             │
             ▼
        wireguard.ts (genkey, allocateIP, addPeer)
             │
             ▼
        session.ts ──► Redis (store session, TTL = SESSION_TTL_SECONDS)
             │
             ▼
        200 + WireGuard config string
```

---

## Environment variables

| Variable | Description |
|---|---|
| `BASE_CHAIN_ID` | Chain ID for payment verification. Default `84532` (Base Sepolia). Set to `8453` for mainnet. |
| `USDC_CONTRACT_ADDRESS` | USDC contract address for the configured chain. Default `0x036CbD...` (Base Sepolia). |
| `PAYMENT_RECIPIENT_ADDRESS` | Wallet address that receives USDC payments. |
| `PAYMENT_AMOUNT_USDC` | Price per access in USDC. Default `0.01`. |
| `SESSION_TTL_SECONDS` | How long a provisioned WireGuard peer stays active. Default `3600` (1 hour). |
| `STRICT_REPLAY_CHECK` | `true` = fail closed if Redis is down (prevents replay attacks). Default `false`. **Set to `true` in production.** |
| `PUBLIC_HOST` | Set to your public URL when behind a reverse proxy — used in the 402 resource field. |
