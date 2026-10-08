/**
 * Rate Limiting Middleware for Elysia
 *
 * Provides plan-aware rate limiting with per-IP and per-user tracking.
 * Uses in-memory sliding window algorithm.
 *
 * Usage:
 * ```typescript
 * import { planRateLimit, createSimpleRateLimit } from './middleware/rate-limit';
 *
 * // Plan-aware rate limiting (different limits for free/pro/enterprise)
 * app.use(planRateLimit('llm')).post('/chat', handler);
 *
 * // Simple per-IP rate limiting
 * app.use(createSimpleRateLimit({ windowMs: 60000, max: 100 }))
 *   .get('/public', handler);
 * ```
 */

import { Elysia } from 'elysia';

import { planHasPaidFeatures } from '../../../shared/plan-features.js';
import { logger } from '../lib/logger.js';

export type PlanName = 'free' | 'pro' | 'enterprise' | string;

export interface PlanRateConfig {
  key: string; // logical route key, e.g. 'llm', 'images'
  perIp: { windowMs: number; maxByPlan: Record<PlanName, number> };
  perUser?: { windowMs: number; maxByPlan: Record<PlanName, number> };
}

interface RateLimitUser {
  userId?: string;
  plan?: string;
}

const RATE_WINDOW_BOUNDS = { min: 1_000, max: 86_400_000 } as const;
const RATE_MAX_BOUNDS = { min: 1, max: 100_000 } as const;

// Read an integer setting without allowing malformed or extreme values to
// disable rate limiting or create unbounded in-memory windows.
export function getBoundedEnvInt(
  key: string,
  fallback: number,
  bounds: { min: number; max: number },
): number {
  const raw = process.env[key];
  if (!raw) return fallback;

  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) return fallback;

  return Math.max(bounds.min, Math.min(parsed, bounds.max));
}

const getRateWindow = (key: string, fallback: number): number =>
  getBoundedEnvInt(key, fallback, RATE_WINDOW_BOUNDS);
const getRateMax = (key: string, fallback: number): number =>
  getBoundedEnvInt(key, fallback, RATE_MAX_BOUNDS);

// Build limits from environment variables with fallback to hardcoded defaults
function buildLimits(): Record<string, PlanRateConfig> {
  return {
    llm: {
      key: 'llm',
      perIp: {
        windowMs: getRateWindow('RATE_LIMIT_LLM_IP_WINDOW', 60_000),
        maxByPlan: {
          free: getRateMax('RATE_LIMIT_LLM_IP_FREE', 20),
          pro: getRateMax('RATE_LIMIT_LLM_IP_PRO', 120),
          enterprise: getRateMax('RATE_LIMIT_LLM_IP_ENTERPRISE', 600),
        },
      },
      perUser: {
        windowMs: getRateWindow('RATE_LIMIT_LLM_USER_WINDOW', 60_000),
        maxByPlan: {
          free: getRateMax('RATE_LIMIT_LLM_USER_FREE', 10),
          pro: getRateMax('RATE_LIMIT_LLM_USER_PRO', 60),
          enterprise: getRateMax('RATE_LIMIT_LLM_USER_ENTERPRISE', 300),
        },
      },
    },
    voice: {
      key: 'voice',
      perIp: {
        windowMs: getRateWindow('RATE_LIMIT_VOICE_IP_WINDOW', 60_000),
        maxByPlan: {
          free: getRateMax('RATE_LIMIT_VOICE_IP_FREE', 20),
          pro: getRateMax('RATE_LIMIT_VOICE_IP_PRO', 120),
          enterprise: getRateMax('RATE_LIMIT_VOICE_IP_ENTERPRISE', 600),
        },
      },
      perUser: {
        windowMs: getRateWindow('RATE_LIMIT_VOICE_USER_WINDOW', 60_000),
        maxByPlan: {
          free: getRateMax('RATE_LIMIT_VOICE_USER_FREE', 10),
          pro: getRateMax('RATE_LIMIT_VOICE_USER_PRO', 60),
          enterprise: getRateMax('RATE_LIMIT_VOICE_USER_ENTERPRISE', 300),
        },
      },
    },
    images: {
      key: 'images',
      perIp: {
        windowMs: getRateWindow('RATE_LIMIT_IMAGES_IP_WINDOW', 60_000),
        maxByPlan: {
          free: getRateMax('RATE_LIMIT_IMAGES_IP_FREE', 10),
          pro: getRateMax('RATE_LIMIT_IMAGES_IP_PRO', 60),
          enterprise: getRateMax('RATE_LIMIT_IMAGES_IP_ENTERPRISE', 300),
        },
      },
      perUser: {
        windowMs: getRateWindow('RATE_LIMIT_IMAGES_USER_WINDOW', 60_000),
        maxByPlan: {
          free: getRateMax('RATE_LIMIT_IMAGES_USER_FREE', 5),
          pro: getRateMax('RATE_LIMIT_IMAGES_USER_PRO', 30),
          enterprise: getRateMax('RATE_LIMIT_IMAGES_USER_ENTERPRISE', 150),
        },
      },
    },
    default: {
      key: 'global',
      perIp: {
        windowMs: getRateWindow('RATE_LIMIT_DEFAULT_IP_WINDOW', 60_000),
        maxByPlan: {
          free: getRateMax('RATE_LIMIT_DEFAULT_IP_FREE', 60),
          pro: getRateMax('RATE_LIMIT_DEFAULT_IP_PRO', 600),
          enterprise: getRateMax('RATE_LIMIT_DEFAULT_IP_ENTERPRISE', 2000),
        },
      },
      perUser: {
        windowMs: getRateWindow('RATE_LIMIT_DEFAULT_USER_WINDOW', 60_000),
        maxByPlan: {
          free: getRateMax('RATE_LIMIT_DEFAULT_USER_FREE', 60),
          pro: getRateMax('RATE_LIMIT_DEFAULT_USER_PRO', 600),
          enterprise: getRateMax('RATE_LIMIT_DEFAULT_USER_ENTERPRISE', 2000),
        },
      },
    },
  };
}

// Default limits used by planRateLimit if caller doesn't pass a config
const DEFAULT_LIMITS: Record<string, PlanRateConfig> = buildLimits();

// Internal bucket structure for sliding window counters
interface RateBucket {
  count: number;
  windowStart: number;
}

/**
 * In-memory rate limit store using sliding window algorithm
 */
class MemoryStore {
  private buckets = new Map<string, RateBucket>();

  incr(key: string, windowMs: number): { count: number; resetMs: number } {
    const now = Date.now();
    let b = this.buckets.get(key);

    // Reset window if expired
    if (!b || now - b.windowStart >= windowMs) {
      b = { count: 0, windowStart: now };
      this.buckets.set(key, b);
    }

    b.count += 1;
    const resetMs = b.windowStart + windowMs - now;
    return { count: b.count, resetMs: resetMs > 0 ? resetMs : 0 };
  }
}

const memoryStore = new MemoryStore();

/**
 * Extract client IP from request
 */
function getClientIp(request: Request): string {
  // Only trust proxy-provided IP headers when explicitly enabled.
  // This prevents client-side header spoofing in deployments where
  // proxy sanitization is not guaranteed.
  const trustProxy =
    process.env.TRUST_PROXY_HEADERS === 'true' || process.env.TRUST_PROXY_HEADERS === '1';

  if (trustProxy) {
    const forwardedFor = request.headers.get('x-forwarded-for');
    if (forwardedFor) {
      const firstIp = forwardedFor.split(',')[0]?.trim();
      if (firstIp) return firstIp;
    }

    const realIp = request.headers.get('x-real-ip');
    if (realIp) {
      return realIp;
    }
  }

  // Fallback when no trusted proxy metadata is available.
  return 'unknown';
}

function getUserPlan(user: RateLimitUser | undefined): PlanName {
  return (user?.plan || 'free').toLowerCase();
}

/**
 * Compute max requests for a plan
 */
function computeMax(config: { maxByPlan: Record<PlanName, number> }, plan: PlanName): number {
  if (config.maxByPlan[plan] != null) return config.maxByPlan[plan];
  if (planHasPaidFeatures(plan) && config.maxByPlan['pro'] != null) return config.maxByPlan['pro'];
  if (plan !== 'free' && config.maxByPlan['free'] != null) return config.maxByPlan['free'];
  const first = Object.values(config.maxByPlan)[0];
  return typeof first === 'number' ? first : 60;
}

/**
 * Plan-aware rate limiter plugin
 * Supports per-IP and per-user rate limiting with different limits by plan
 *
 * @param configOrKey - Either a PlanRateConfig object, a string key to lookup in DEFAULT_LIMITS, or undefined for default
 */
export function planRateLimit(configOrKey?: Partial<PlanRateConfig> | string) {
  let cfg: PlanRateConfig;
  const defaultCfg = DEFAULT_LIMITS.default!;

  if (!configOrKey) {
    cfg = defaultCfg;
  } else if (typeof configOrKey === 'string') {
    const found = DEFAULT_LIMITS[configOrKey];
    cfg = found || { ...defaultCfg, key: configOrKey };
  } else {
    const baseKey = configOrKey.key || 'default';
    const base = DEFAULT_LIMITS[baseKey] || defaultCfg;
    cfg = {
      key: configOrKey.key || base.key,
      perIp: configOrKey.perIp || base.perIp,
      perUser: configOrKey.perUser !== undefined ? configOrKey.perUser : base.perUser,
    };
  }

  return (
    new Elysia({ name: `rate-limit-${cfg.key}` })
      // 'scoped' is REQUIRED: Elysia plugin hooks are local by default, meaning a
      // hook-only plugin never applies to the routes of the instance that .use()s
      // it. Without this, the limiter silently never fires (prod bug, 2026-07-14).
      .onBeforeHandle({ as: 'scoped' }, (context) => {
        try {
          const { request, set } = context;
          // `user` is supplied by requireAuth when this plugin is attached to a protected route.
          const user = (context as unknown as { user?: RateLimitUser }).user;
          const ip = getClientIp(request);
          const userId = user?.userId || null;
          const plan = getUserPlan(user);

          // Per-IP rate limiting
          const ipKey = `${cfg.key}:ip:${ip}`;
          const ipRes = memoryStore.incr(ipKey, cfg.perIp.windowMs);
          const ipMax = computeMax(cfg.perIp, plan);

          if (ipRes.count > ipMax) {
            const retryAfterSec = Math.ceil(ipRes.resetMs / 1000);
            set.status = 429;
            set.headers['Retry-After'] = String(Math.max(retryAfterSec, 1));

            logger.warn(`Rate limit exceeded for IP ${ip}: ${ipRes.count}/${ipMax}`);

            return {
              error: {
                name: 'RateLimitError',
                message: 'Too many requests from this IP, please try again later',
                code: 'RATE_LIMIT_EXCEEDED',
                statusCode: 429,
                details: {
                  scope: 'ip',
                  limit: ipMax,
                  window: cfg.perIp.windowMs / 1000,
                  retryAfter: Math.max(retryAfterSec, 1),
                },
              },
            };
          }

          // Per-user rate limiting (if configured and user is authenticated)
          if (cfg.perUser && userId) {
            const userKey = `${cfg.key}:user:${userId}`;
            const uRes = memoryStore.incr(userKey, cfg.perUser.windowMs);
            const uMax = computeMax(cfg.perUser, plan);

            if (uRes.count > uMax) {
              const retryAfterSec = Math.ceil(uRes.resetMs / 1000);
              set.status = 429;
              set.headers['Retry-After'] = String(Math.max(retryAfterSec, 1));

              logger.warn(`Rate limit exceeded for user ${userId}: ${uRes.count}/${uMax}`);

              return {
                error: {
                  name: 'RateLimitError',
                  message: 'Too many requests from this user, please try again later',
                  code: 'RATE_LIMIT_EXCEEDED',
                  statusCode: 429,
                  details: {
                    scope: 'user',
                    limit: uMax,
                    window: cfg.perUser.windowMs / 1000,
                    retryAfter: Math.max(retryAfterSec, 1),
                  },
                },
              };
            }
          }

          // Rate limit passed, continue
          return;
        } catch (error) {
          // Fail-open on limiter errors
          logger.error({ error: error }, 'Rate limiter error, failing open:');
          return;
        }
      })
  );
}

/**
 * Simple per-IP rate limiter (backward compatible)
 * Single limit for all users, no plan awareness
 *
 * @param options - windowMs and max requests
 */
export function createSimpleRateLimit(options: { windowMs: number; max: number; key?: string }) {
  const { windowMs, max, key = 'simple' } = options;

  return (
    new Elysia({ name: `simple-rate-limit-${key}` })
      // 'scoped' is REQUIRED — see comment in planRateLimit above.
      .onBeforeHandle({ as: 'scoped' }, ({ request, set }) => {
        try {
          const ip = getClientIp(request);
          const bucketKey = `${key}:${ip}`;
          const result = memoryStore.incr(bucketKey, windowMs);

          if (result.count > max) {
            const retryAfterSec = Math.ceil(result.resetMs / 1000);
            set.status = 429;
            set.headers['Retry-After'] = String(Math.max(retryAfterSec, 1));

            logger.warn(`Simple rate limit exceeded for IP ${ip}: ${result.count}/${max}`);

            return {
              error: {
                name: 'RateLimitError',
                message: 'Too many requests, please try again later',
                code: 'RATE_LIMIT_EXCEEDED',
                statusCode: 429,
                details: {
                  scope: 'ip',
                  limit: max,
                  window: windowMs / 1000,
                  retryAfter: Math.max(retryAfterSec, 1),
                },
              },
            };
          }

          return;
        } catch (error) {
          // Fail-open on errors
          logger.error({ error: error }, 'Simple rate limiter error, failing open:');
          return;
        }
      })
  );
}
