import pino, { type Logger } from 'pino';
import type { OrbitEnv } from '@orbit/config';

/**
 * `NODE_ENV !== 'production'` gets `pino-pretty` (human-readable local
 * logs, per docs/ORBIT_UNIFIED_EVOLUTION_CONCEPT.md §63) — production
 * gets plain newline-delimited JSON (the standard pino default, no
 * transport), matching every log-aggregation tool's expectation.
 * `redact` strips the Authorization header (Bearer JWTs) that
 * `pino-http`'s default request serializer would otherwise log in full
 * on every request — §63's "never log ... tokens ... authorization
 * headers" applied literally, not just as an intention.
 */
export function createPinoLogger(env: Pick<OrbitEnv, 'NODE_ENV' | 'LOG_LEVEL'>): Logger {
  return pino({
    level: env.LOG_LEVEL,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      censor: '[redacted]',
    },
    transport:
      env.NODE_ENV === 'production'
        ? undefined
        : { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } },
  });
}
