import { createApp } from './app';
import { logger } from './lib/logger';

// Note: Environment validation is done in lib/env.ts
// For development without full env setup, comment out the env import in app.ts
const app = createApp();

const PORT = Number(process.env.PORT || 8888);

// Graceful shutdown handler
function shutdown(signal: string) {
  logger.info({ msg: `Received ${signal}, shutting down gracefully...` });

  // Stop accepting new connections
  app.stop();

  // Give ongoing requests time to complete
  setTimeout(() => {
    logger.info({ msg: 'Server stopped' });
    process.exit(0);
  }, 5000);
}

// Register shutdown handlers
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

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
