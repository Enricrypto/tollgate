// x402 payment gate middleware.
//
// Request flow:
//
//   No X-Payment header
//     └─► 402 + payment requirements JSON (x402Version 1 spec)
//
//   X-Payment: <txHash>
//     └─► verifyPayment(txHash)
//           ├─ valid   → next()  (req.payment set for route handler)
//           └─ invalid → 402 + { error, reason }

import type { Request, Response, NextFunction } from 'express';
import { buildConfig } from '../config.js';
import { logger } from '../logger.js';
import { verifyPayment, type PaymentResult } from '../services/payment.js';

// Extend Express Request to carry verified payment data
declare global {
  namespace Express {
    interface Request {
      payment?: PaymentResult;
    }
  }
}

const config = buildConfig();

export default async function x402(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Guard against duplicate headers — Express may return string[] for repeated headers
  const rawHeader = req.headers['x-payment'];
  const txHash = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

  if (!txHash) {
    const base = config.PUBLIC_HOST
      ? config.PUBLIC_HOST.replace(/\/$/, '')
      : `http://${req.headers.host}`;

    res.status(402).json({
      x402Version: 1,
      error: 'Payment required',
      accepts: [
        {
          scheme: 'exact',
          network: 'base',
          maxAmountRequired: config.PAYMENT_AMOUNT_USDC,
          resource: `${base}/vpn`,
          description: 'Pay-per-use WireGuard VPN access via Tollgate',
          mimeType: 'application/json',
          payTo: config.PAYMENT_RECIPIENT_ADDRESS,
          maxTimeoutSeconds: 300,
          asset: config.USDC_CONTRACT_ADDRESS,
          extra: {
            name: 'USD Coin',
            version: '2',
          },
        },
      ],
    });
    return;
  }

  try {
    const result = await verifyPayment(txHash);

    if (result.valid) {
      req.payment = result;
      return next();
    }

    logger.warn({ txHash, reason: result.reason }, 'payment rejected');
    res.status(402).json({
      error: 'Payment verification failed',
      reason: result.reason,
    });
  } catch (err) {
    logger.error({ err, txHash }, 'verifyPayment threw unexpectedly');
    res.status(402).json({
      error: 'Payment verification failed',
      reason: 'Internal error during payment verification',
    });
  }
}
