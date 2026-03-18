// Central configuration with tiered validation.
//
// Validation tiers — only REQUIRED_NOW throws at startup:
//
//   Phase 1 (now):  PORT, REDIS_URL
//   Phase 3:        ALCHEMY_API_KEY, PAYMENT_RECIPIENT_ADDRESS
//   Phase 5:        WG_SERVER_PUBLIC_KEY, WG_SERVER_ENDPOINT
//
// Later services validate their own required vars on initialisation,
// so the server can start without every var filled in during development.

const REQUIRED_NOW = ['PORT', 'REDIS_URL'];

export interface AppConfig {
  // Phase 1
  PORT: number;
  REDIS_URL: string;
  // Phase 2
  PUBLIC_HOST: string;
  // Phase 3
  ALCHEMY_API_KEY: string;
  BASE_CHAIN_ID: number;
  USDC_CONTRACT_ADDRESS: string;
  PAYMENT_RECIPIENT_ADDRESS: string;
  PAYMENT_AMOUNT_USDC: string;
  // Phase 4
  SESSION_TTL_SECONDS: number;
  STRICT_REPLAY_CHECK: boolean;
  // Phase 5
  WG_INTERFACE: string;
  WG_SERVER_PUBLIC_KEY: string;
  WG_SERVER_ENDPOINT: string;
  WG_SERVER_PORT: number;
  WG_DNS: string;
}

/**
 * Build and validate a frozen config object from an env map.
 */
export function buildConfig(env: NodeJS.ProcessEnv = process.env): Readonly<AppConfig> {
  const missing = REQUIRED_NOW.filter(k => !env[k]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const port = parseInt(env.PORT!);
  if (isNaN(port)) throw new Error('PORT must be a valid number');

  const sessionTTL = parseInt(env.SESSION_TTL_SECONDS ?? '3600');
  if (isNaN(sessionTTL)) throw new Error('SESSION_TTL_SECONDS must be a valid number');

  return Object.freeze({
    // Phase 1
    PORT: port,
    REDIS_URL: env.REDIS_URL!,

    // Phase 2
    PUBLIC_HOST: env.PUBLIC_HOST ?? '',

    // Phase 3
    ALCHEMY_API_KEY:           env.ALCHEMY_API_KEY ?? '',
    BASE_CHAIN_ID:             parseInt(env.BASE_CHAIN_ID ?? '84532'),
    USDC_CONTRACT_ADDRESS:     env.USDC_CONTRACT_ADDRESS ?? '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    PAYMENT_RECIPIENT_ADDRESS: env.PAYMENT_RECIPIENT_ADDRESS ?? '',
    PAYMENT_AMOUNT_USDC:       env.PAYMENT_AMOUNT_USDC ?? '0.01',

    // Phase 4
    SESSION_TTL_SECONDS: sessionTTL,
    STRICT_REPLAY_CHECK: env.STRICT_REPLAY_CHECK === 'true',

    // Phase 5
    WG_INTERFACE:         env.WG_INTERFACE ?? 'wg0',
    WG_SERVER_PUBLIC_KEY: env.WG_SERVER_PUBLIC_KEY ?? '',
    WG_SERVER_ENDPOINT:   env.WG_SERVER_ENDPOINT ?? '',
    WG_SERVER_PORT:       parseInt(env.WG_SERVER_PORT ?? '51820'),
    WG_DNS:               env.WG_DNS ?? '1.1.1.1',
  });
}
