import pino from 'pino';

/** Structured JSON logger shared by the API server and scripts (one JSON object per line). */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: process.env.SERVICE_NAME ?? 'statehouse' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;
