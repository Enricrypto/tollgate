// Production entry point — used by pm2 and direct server runs.
// Keeps server.ts import-safe for tests (no auto-listen side effects).

import 'dotenv/config';
import { app, logger } from './server.js';
import { buildConfig } from './config.js';
import { disconnect } from './services/session.js';

const config = buildConfig();

app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, 'Tollgate online');
});

const shutdown = async (signal: string) => {
  logger.info(`${signal} received — shutting down gracefully`);
  await disconnect();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
