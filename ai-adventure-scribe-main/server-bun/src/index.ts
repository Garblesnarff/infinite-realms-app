import { createApp } from './app';
import { logger } from './lib/logger';

// Note: Environment validation is done in lib/env.ts
// For development without full env setup, comment out the env import in app.ts
const app = createApp();

const PORT = Number(process.env.PORT || 8888);
const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 5000;

// Graceful shutdown handler
let shutdownPromise: Promise<void> | undefined;

function shutdown(signal: string): Promise<void> {
  if (shutdownPromise) {
    logger.warn({ msg: `Received ${signal} while shutdown is already in progress` });
    return shutdownPromise;
  }

  shutdownPromise = (async () => {
    logger.info({ msg: `Received ${signal}, shutting down gracefully...` });

    const server = app.server;
    const forceCloseTimer = setTimeout(() => {
      logger.warn({
        msg: 'Graceful shutdown timed out; closing active connections',
        timeoutMs: GRACEFUL_SHUTDOWN_TIMEOUT_MS,
      });
      void server?.stop(true).catch((error) => {
        logger.error({
          msg: 'Failed to force-close active connections',
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);

    try {
      // Bun closes the listening socket immediately, then resolves once
      // in-flight requests and WebSockets have finished.
      await app.stop();
      logger.info({ msg: 'Server stopped' });
      process.exit(0);
    } catch (error) {
      logger.error({
        msg: 'Server shutdown failed',
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    } finally {
      clearTimeout(forceCloseTimer);
    }
  })();

  return shutdownPromise;
}

// Register shutdown handlers
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// Start server
app.listen(PORT, () => {
  logger.info({
    msg: `InfiniteRealms Elysia server listening on http://localhost:${PORT}`,
    port: PORT,
    env: process.env.NODE_ENV || 'development',
  });
  logger.info({
    msg: `Swagger documentation available at http://localhost:${PORT}/swagger`,
  });
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error({
    msg: 'Uncaught exception',
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error({
    msg: 'Unhandled rejection',
    reason,
    promise,
  });
});
