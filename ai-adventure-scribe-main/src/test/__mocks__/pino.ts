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

const pino: ((_opts?: unknown) => Record<string, unknown>) & {
  stdSerializers?: Record<string, unknown>;
} = (_opts?: unknown) => createMockLogger();

// server-bun/src/lib/logger.ts reads `pino.stdSerializers` to serialize Errors under
// the `err`/`error` keys. Mirroring the shape here keeps the mock honest instead of
// forcing the real module down its fallback path.
const errSerializer = (error: Error & { cause?: unknown }) => ({
  type: error?.name || 'Error',
  message: error?.message,
  stack: error?.stack,
  ...(error?.cause === undefined ? {} : { cause: String(error.cause) }),
});

pino.stdSerializers = { err: errSerializer, errWithCause: errSerializer };

export default pino;
