import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { buildConfig } from './config.js';
import { logger } from './logger.js';
import x402 from './middleware/x402.js';
import { provisionPeer } from './services/wireguard.js';

const config = buildConfig();

export { logger };
export const app = express();

app.use(helmet());
app.use(express.json());

const vpnLimiter = rateLimit({
  windowMs: 60_000,       // 1 minute
  max: 20,                // 20 requests per IP per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — try again in a minute' },
});

// ─── Routes ──────────────────────────────────────────────────────────────────

app.get('/vpn', vpnLimiter, x402, async (_req, res, next) => {
  try {
    const sessionId = randomUUID();
    const { wireGuardConfig, allowedIP } = await provisionPeer(sessionId);
    res.json({
      sessionId,
      expiresIn: config.SESSION_TTL_SECONDS,
      wireGuardConfig,
      allowedIP,
    });
  } catch (err) {
    next(err);
  }
});

// ─── Global error handler (must be last) ─────────────────────────────────────

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

// Server startup lives in src/main.ts (production) — keeping this file
// import-safe so tests can import { app } without auto-listen side effects.
