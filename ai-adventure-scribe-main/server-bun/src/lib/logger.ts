import pino from 'pino';

// Pino Logger Configuration
const logLevel = process.env.NODE_ENV === 'production' ? 'info' : 'debug';

/**
 * `Error` owns `message`/`stack` as non-enumerable properties, so `JSON.stringify`
 * — and therefore pino's default object serializer — renders a thrown error as
 * `{}`. Every `logger.error({ ..., error: e })` call in this codebase was silently
 * discarding the only information that identifies the failure (production logged
 * 31 consecutive `"Start combat error","error":{}` lines while a real exception
 * went unnamed). Serializing here fixes every call site at once, under BOTH the
 * pino-conventional `err` key and the `error` key this codebase actually uses.
 */
const serializeErrorValue = (value: unknown): unknown => {
  const isError =
    value instanceof Error ||
    (typeof value === 'object' &&
      value !== null &&
      typeof (value as { message?: unknown }).message === 'string' &&
      typeof (value as { stack?: unknown }).stack === 'string');
  if (!isError) return value;

  // pino's own serializer keeps `cause` chains and aggregate errors intact. It is
  // absent from the jsdom/vitest pino mock, hence the hand-rolled equivalent.
  const stdSerializers = (pino as unknown as { stdSerializers?: Record<string, unknown> })
    .stdSerializers;
  const serializer = (stdSerializers?.errWithCause ?? stdSerializers?.err) as
    | ((error: Error) => unknown)
    | undefined;
  if (serializer) return serializer(value as Error);

  const error = value as Error & { code?: unknown; cause?: unknown };
  return {
    type: error.name || 'Error',
    message: error.message,
    stack: error.stack,
    ...(error.code === undefined ? {} : { code: error.code }),
    ...(error.cause === undefined ? {} : { cause: serializeErrorValue(error.cause) }),
  };
};

/** Exported so tests can assert the exact serializers the production logger runs with. */
export const errorLogSerializers = {
  err: serializeErrorValue,
  error: serializeErrorValue,
  cause: serializeErrorValue,
};

export const logger = pino({
  level: logLevel,
  serializers: errorLogSerializers,
  // Simple console logging for development (pino-pretty requires separate install)
  base: {
    service: 'infiniterealms-bun',
  },
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
  // Redact known-sensitive fields wherever they appear in logged objects so
  // secrets never reach log output/aggregators, regardless of which module
  // logged them.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.apiKey',
      '*.api_key',
      '*.token',
      '*.accessToken',
      '*.refreshToken',
      '*.password',
      '*.secret',
    ],
    censor: '[REDACTED]',
  },
});

// Create child loggers for different modules (matching Winston interface)
export const combatLogger = logger.child({ module: 'combat' });
export const spellLogger = logger.child({ module: 'spells' });
export const progressionLogger = logger.child({ module: 'progression' });

// Extend Logger with convenience methods matching Winston interface
export type Logger = typeof logger;
