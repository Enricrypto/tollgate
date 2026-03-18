// Shared pino logger singleton.
// Import from here in all modules — keeps log format consistent across
// service files, middleware, and the main server.

import pino from 'pino';

export const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
