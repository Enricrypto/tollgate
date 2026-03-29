// Production entry point — used by pm2 and direct server runs.
// Keeps server.ts import-safe for tests (no auto-listen side effects).

import 'dotenv/config';
import { app, logger } from './server.js';
import { disconnect } from './services/session.js';

// config is already built inside server.ts at module load — re-use via app.get('config') pattern
// is unnecessary complexity; instead we read PORT directly from env (already validated by server.ts).
const PORT = parseInt(process.env.PORT!);

app.listen(PORT, () => {
  logger.info({ port: PORT }, 'Tollgate online');
});

const shutdown = async (signal: string) => {
  logger.info(`${signal} received — shutting down gracefully`);
  await disconnect();
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
