/**
 * Middleware Index
 *
 * Central export point for all Elysia middleware plugins.
 */

// Authentication
export { requireAuth } from './auth.js';
export type { AuthTokenPayload } from './auth.js';

// Rate Limiting
export { planRateLimit, createSimpleRateLimit } from './rate-limit.js';
export type { PlanName, PlanRateConfig } from './rate-limit.js';

// Logging
export { loggingPlugin } from './logging.js';
