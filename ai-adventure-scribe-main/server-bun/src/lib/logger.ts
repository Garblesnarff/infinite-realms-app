import pino from 'pino';

// Pino Logger Configuration
const logLevel = process.env.NODE_ENV === 'production' ? 'info' : 'debug';

export const logger = pino({
  level: logLevel,
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
