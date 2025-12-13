/**
 * Middleware Index
 *
 * Central export point for all Elysia middleware plugins.
 */

// Authentication
export { requireAuth, optionalAuth } from './auth.js';
export type { AuthTokenPayload } from './auth.js';

// Rate Limiting
export { planRateLimit, createSimpleRateLimit } from './rate-limit.js';
export type { PlanName, PlanRateConfig } from './rate-limit.js';

// Metrics
export { metricsPlugin, metricsEndpoint } from './metrics.js';

// Logging
export { loggingPlugin, createModuleLogger } from './logging.js';
