// Mock for pino logger used in server-bun tests running under jsdom/vitest
const noop = () => {};

const createMockLogger = (): Record<string, unknown> => {
  const logger: Record<string, unknown> = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    fatal: noop,
    child: () => createMockLogger(),
    level: 'silent',
  };
  return logger;
};

const pino = (_opts?: unknown): Record<string, unknown> => createMockLogger();

export default pino;
