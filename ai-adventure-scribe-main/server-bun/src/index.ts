import { createApp } from './app';
import { logAlertingConfiguration } from './lib/alerting.js';
import { logger } from './lib/logger';
import { logAbandonedMemoryExtractionJobs } from './services/memory-extraction-job.js';
import { startModelHealthChecks, validateConfiguredModels } from './services/model-health.js';

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
    // Extraction jobs run after their 202, so no open request holds them; they die with the process.
    logAbandonedMemoryExtractionJobs(signal);

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

// Validate provider model capabilities before accepting traffic. The health
// check is advisory for availability, but configured structured-output models
// are surfaced as degraded when they lack the required capability flags.
await validateConfiguredModels();

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
  logAlertingConfiguration();
  startModelHealthChecks();
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
