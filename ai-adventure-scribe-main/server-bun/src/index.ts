import { createApp } from './app';
import { logAlertingConfiguration } from './lib/alerting.js';
import { getEnv } from './lib/env.js';
import { logger } from './lib/logger';
import { startIdleEncounterSweep } from './services/combat/idle-encounter-sweeper.js';
import { startNpcTurnSweep } from './services/combat/npc-turn-drain.js';
import {
  resumePendingMemoryExtractionJobs,
  settleInFlightMemoryExtractionJobs,
} from './services/memory-extraction-job.js';
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
    // Extraction jobs run after their 202, so no open request holds them. They are persisted
    // (#846): give in-flight executions up to 3 s to finish on their own. Rows still running
    // at exit are NOT released — a released row is claimable by the handoff process while
    // this process's model call is still live, and two live executors can write duplicate
    // memories. The stale-running reclaim picks the leftovers up; they are never dropped.
    await Promise.race([
      settleInFlightMemoryExtractionJobs(signal).catch((error: unknown) => {
        logger.error({
          msg: 'Failed to settle in-flight memory extraction jobs',
          error: error instanceof Error ? error.message : String(error),
        });
      }),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);

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

// A deploy hands :PORT off to a standby copy of the new code while this process
// restarts (#422), so the socket is opened with SO_REUSEPORT: two processes can
// listen on the port at once and the kernel spreads new connections between
// them. The standby (IR_STANDBY=1) only serves requests; it starts none of the
// background sweeps below, so the handoff never runs a sweep twice.
const IS_STANDBY = process.env.IR_STANDBY === '1';

// Start server
app.listen({ port: PORT, reusePort: true }, () => {
  logger.info({
    msg: `InfiniteRealms Elysia server listening on http://localhost:${PORT}`,
    port: PORT,
    env: process.env.NODE_ENV || 'development',
  });
  logger.info({
    msg: `Swagger documentation available at http://localhost:${PORT}/swagger`,
  });
  logAlertingConfiguration();
  if (IS_STANDBY) {
    logger.info({ msg: 'Standby process (deploy handoff): background sweeps not started' });
    return;
  }
  startModelHealthChecks();
  // Extraction jobs are persisted before their 202 (#846), so the ones a restart
  // interrupted are still in the table: resume them now. Fire-and-forget with the
  // failure logged — serving traffic matters more than the backlog draining first.
  void resumePendingMemoryExtractionJobs().catch((error: unknown) => {
    logger.error({
      msg: 'Failed to resume pending memory extraction jobs',
      error: error instanceof Error ? error.message : String(error),
    });
  });
  // The server's existing scheduled path, same as the model health checks above: hourly in
  // this process rather than a crontab entry, so it needs no host change (#2556).
  startIdleEncounterSweep();
  // A restart or a failed drain must not strand a creature holding the turn (#2658).
  startNpcTurnSweep();
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
