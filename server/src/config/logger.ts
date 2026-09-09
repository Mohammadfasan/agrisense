import winston from 'winston';

import { env } from './env';

const { combine, timestamp, printf, colorize, errors, json, splat } = winston.format;

/** Human-readable single-line output for local development. */
const developmentFormat = combine(
  colorize({ level: true }),
  timestamp({ format: 'HH:mm:ss.SSS' }),
  errors({ stack: true }),
  splat(),
  printf((info) => {
    const { level, message, timestamp: ts, stack, requestId, ...meta } = info;
    const scope = typeof requestId === 'string' ? ` [${requestId}]` : '';
    const rest = Object.keys(meta).filter((key) => !key.startsWith('Symbol('));
    const extra = rest.length > 0 ? ` ${JSON.stringify(pick(meta, rest))}` : '';
    const trace = typeof stack === 'string' ? `\n${stack}` : '';
    return `${String(ts)} ${level}${scope}: ${String(message)}${extra}${trace}`;
  }),
);

/** Structured JSON for anything that ships logs to a collector. */
const productionFormat = combine(timestamp(), errors({ stack: true }), splat(), json());

const usePretty = env.LOG_PRETTY ?? !env.isProduction;

export const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  defaultMeta: { service: 'agrisense-server', env: env.NODE_ENV },
  format: usePretty ? developmentFormat : productionFormat,
  transports: [
    new winston.transports.Console({
      handleExceptions: false,
      handleRejections: false,
    }),
  ],
  // Never let a logging failure take the process down; index.ts owns exit paths.
  exitOnError: false,
  silent: env.isTest,
});

/** A logger bound to a request id, so every line in a request correlates. */
export function childLogger(requestId: string): winston.Logger {
  return logger.child({ requestId });
}

function pick(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    result[key] = source[key];
  }
  return result;
}
