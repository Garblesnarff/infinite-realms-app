import { createApp } from './app';
import { logAlertingConfiguration } from './lib/alerting.js';
import { getEnv } from './lib/env.js';
import { logger } from './lib/logger';
import { startIdleEncounterSweep } from './services/combat/idle-encounter-sweeper.js';
import { logAbandonedMemoryExtractionJobs } from './services/memory-extraction-job.js';
import { startModelHealthChecks, validateConfiguredModels } from './services/model-health.js';

// Validate the environment at startup. lib/env.ts validates lazily, so the server
// calls this itself to fail before listening rather than on the first request.
getEnv();
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
  // The server's existing scheduled path, same as the model health checks above: hourly in
  // this process rather than a crontab entry, so it needs no host change (#2556).
  startIdleEncounterSweep();
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
