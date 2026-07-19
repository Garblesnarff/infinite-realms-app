/* eslint-disable max-lines */
/* eslint-disable import/order */
import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { staticPlugin } from '@elysiajs/static';
import { swagger } from '@elysiajs/swagger';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { logger } from './lib/logger';
import { register, httpRequestCounter, httpRequestDuration } from './lib/metrics';
import { randomUUID } from 'crypto';
import { appRouter, createContext } from './trpc/index.js';
import { wsPlugin } from './ws';
import { blogRoutes } from './routes/blog.js';
import { chronicleRoutes } from './routes/chronicle.js';
import { landingRoutes } from './routes/landing.js';
import { seoRoutes } from './routes/seo.js';
import { authRoutes } from './routes/v1/auth';
import { charactersRoutes } from './routes/v1/characters';
import { llmRoutes } from './routes/v1/llm';
import { imageRoutes } from './routes/v1/images';
import { aiProxyRoutes } from './routes/v1/ai-proxy';
import { blogAdminAuthRoutes } from './routes/blog-admin-auth';
import { billingRoutes } from './routes/v1/billing';
import { combatRoutes } from './routes/v1/combat';
import { tacticalMapRoutes } from './routes/v1/tactical-maps';
import { handoutRoutes } from './routes/v1/handouts';
import { inventoryRoutes } from './routes/v1/inventory';
import { spellSlotsCharacterRoutes, spellSlotsUtilityRoutes } from './routes/v1/spell-slots';
import { progressionRoutes } from './routes/v1/progression';
import { restRoutes } from './routes/v1/rest';
import { classFeaturesRoutes } from './routes/v1/class-features';
import { observabilityRoutes } from './routes/v1/observability';
import { encountersRoutes } from './routes/v1/encounters';
import { campaignsRoutes } from './routes/v1/campaigns';
import { publicCampaignTemplateRoutes } from './routes/v1/public-campaign-templates';
import { sessionsRoutes } from './routes/v1/sessions';
import { sessionMessageRoutes } from './routes/v1/session-messages';
import { memoryRoutes } from './routes/v1/memories';
import { personalityRoutes } from './routes/v1/personality';
import { adminRoutes } from './routes/v1/admin';
import { spellsRoutes } from './routes/v1/spells';
import { waitlistRoutes } from './routes/v1/waitlist';
import { internalRoutes } from './routes/v1/internal';
import { securedGameDataRoutes } from './routes/v1/secured-game-data';
import { blogApiRoutes } from './routes/v1/blog';
import { llmsRoutes } from './routes/llms.js';
import { getModelHealthStatus } from './services/model-health.js';

export function createApp() {
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.TRUST_PROXY_HEADERS !== 'true' &&
    process.env.TRUST_PROXY_HEADERS !== '1'
  ) {
    logger.error({
      msg: 'SECURITY_CONFIG_ERROR',
      alert: true,
      setting: 'TRUST_PROXY_HEADERS',
      detail: 'Production rate limiting will collapse all proxied users into one IP bucket',
    });
  }
  const app = new Elysia()
    // Request ID middleware
    .derive(({ request }) => {
      const requestId = request.headers.get('x-request-id') || randomUUID();
      return { requestId };
    })
    // Request logging middleware
    .onRequest(({ request, store }) => {
      const start = performance.now();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (store as any).__startTime = start;

      const requestId = request.headers.get('x-request-id') || randomUUID();
      logger.info({
        requestId,
        method: request.method,
        url: new URL(request.url).pathname,
        msg: 'request.start',
      });
    })
    .onAfterHandle(({ request, response, store, set }) => {
      // Inline legacy auth guards returned this envelope without a status.
      if (
        response &&
        typeof response === 'object' &&
        'error' in response &&
        (response as { error?: unknown }).error === 'Unauthorized'
      ) {
        set.status ??= 401;
        set.headers['www-authenticate'] = 'Bearer realm="Infinite Realms"';
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const start = (store as any).__startTime || performance.now();
      const durationMs = performance.now() - start;
      const url = new URL(request.url);
      // Fix: Read status from set.status first (set by handlers), then response, then default
      const status = set.status || (response instanceof Response ? response.status : 200);
      const requestId = request.headers.get('x-request-id') || 'unknown';

      // Prometheus metrics
      httpRequestCounter.inc({
        method: request.method,
        route: url.pathname,
        status: String(status),
      });

      httpRequestDuration.observe(
        {
          method: request.method,
          route: url.pathname,
          status: String(status),
        },
        durationMs / 1000,
      );

      logger.info({
        requestId,
        method: request.method,
        url: url.pathname,
        status,
        durationMs: Math.round(durationMs * 1000) / 1000,
        msg: 'request.end',
      });
    })
    .onError(({ error, request, set, code }) => {
      const requestId = request.headers.get('x-request-id') || 'unknown';

      logger.error({
        requestId,
        method: request.method,
        url: new URL(request.url).pathname,
        error: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error ? error.name : 'UnknownError',
        stack: error instanceof Error ? error.stack : undefined,
        msg: 'request.error',
      });

      set.status = code === 'NOT_FOUND' ? 404 : code === 'VALIDATION' ? 422 : 500;
      return {
        error: 'Internal Server Error',
        message:
          process.env.NODE_ENV === 'production'
            ? undefined
            : error instanceof Error
              ? error.message
              : String(error),
      };
    })
    // Security headers middleware
    .onBeforeHandle(({ set }) => {
      // Prevent MIME type sniffing
      set.headers['X-Content-Type-Options'] = 'nosniff';

      // Prevent clickjacking
      set.headers['X-Frame-Options'] = 'DENY';

      // XSS protection (legacy but still useful)
      set.headers['X-XSS-Protection'] = '1; mode=block';

      // Referrer policy for privacy
      set.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin';

      // Content Security Policy - allow self and common CDNs
      set.headers['Content-Security-Policy'] = [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: blob: https:",
        "connect-src 'self' https: wss:",
        "frame-ancestors 'none'",
      ].join('; ');

      // HTTPS enforcement (Strict Transport Security)
      // Only set in production to avoid issues with local development
      if (process.env.NODE_ENV === 'production') {
        set.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains; preload';
      }

      // Permissions policy (restrict browser features)
      set.headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()';

      // LLM documentation discovery headers (llms.txt standard)
      set.headers['Link'] = '</llms.txt>; rel="llms-txt", </llms-full.txt>; rel="llms-full-txt"';
      set.headers['X-Llms-Txt'] = '/llms.txt';
    })
    // CORS configuration (matching Express setup)
    // Allow localhost on any port for development, and production origins from env
    .use(
      cors({
        origin: (request: Request) => {
          const originHeader = request.headers.get('origin');

          // Allow requests with no origin
          if (!originHeader) return true;

          // Allow any localhost origin regardless of port
          if (
            originHeader.startsWith('http://localhost:') ||
            originHeader.startsWith('https://localhost:') ||
            originHeader.startsWith('http://127.0.0.1:') ||
            originHeader.startsWith('https://127.0.0.1:')
          ) {
            return true;
          }

          // For production, check against environment variable
          const allowedOrigins = process.env.CORS_ORIGIN?.split(',') || [];
          return allowedOrigins.includes(originHeader);
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: [
          'Content-Type',
          'Authorization',
          'X-Request-Id',
          'x-request-id',
          'X-Release',
          'x-release',
          'X-Environment',
          'x-environment',
        ],
      }),
    )
    // Swagger documentation
    .use(
      swagger({
        documentation: {
          info: {
            title: 'InfiniteRealms API',
            version: '2.0.0',
            description: 'Elysia-based API for InfiniteRealms',
          },
          tags: [
            { name: 'Health', description: 'Health check endpoints' },
            { name: 'Metrics', description: 'Prometheus metrics' },
          ],
        },
      }),
    )
    // Static file serving for /dist/assets
    .use(
      staticPlugin({
        assets: process.env.VITE_CLIENT_DIST || 'dist',
        prefix: '/assets',
        alwaysStatic: true,
      }),
    )
    // Static file serving for blog assets (uses absolute path from project root)
    .use(
      staticPlugin({
        assets: '/var/www/infiniterealms/ai-adventure-scribe-main/dist/blog-assets',
        prefix: '/blog-assets',
        alwaysStatic: true,
      }),
    )
    // Health check endpoint
    .get(
      '/health',
      () => ({
        status: getModelHealthStatus().status,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        modelHealth: getModelHealthStatus(),
      }),
      {
        detail: {
          tags: ['Health'],
          description: 'Health check endpoint',
        },
      },
    )
    // Prometheus metrics endpoint
    .get(
      '/metrics',
      async ({ request, set }) => {
        const metricsToken = process.env.METRICS_TOKEN;
        const allowlistRaw = process.env.METRICS_ALLOWLIST;
        const allowlist = allowlistRaw
          ? allowlistRaw
              .split(',')
              .map((v) => v.trim())
              .filter(Boolean)
          : [];

        const metricsPublic =
          process.env.METRICS_PUBLIC === 'true' || process.env.METRICS_PUBLIC === '1';

        if (
          !metricsPublic &&
          process.env.NODE_ENV === 'production' &&
          !metricsToken &&
          allowlist.length === 0
        ) {
          set.status = 403;
          return { error: 'Metrics endpoint is not configured for public access' };
        }

        if (metricsToken || allowlist.length > 0) {
          const authHeader = request.headers.get('authorization') || '';
          const bearerToken = authHeader.toLowerCase().startsWith('bearer ')
            ? authHeader.slice(7).trim()
            : null;
          const headerToken = request.headers.get('x-metrics-token');
          const suppliedToken = bearerToken || headerToken;

          if (metricsToken && suppliedToken !== metricsToken) {
            set.status = 401;
            return { error: 'Unauthorized' };
          }

          if (allowlist.length > 0) {
            const trustProxy =
              process.env.TRUST_PROXY_HEADERS === 'true' || process.env.TRUST_PROXY_HEADERS === '1';
            const forwardedFor = trustProxy ? request.headers.get('x-forwarded-for') : null;
            const realIp = trustProxy ? request.headers.get('x-real-ip') : null;
            const clientIp = forwardedFor ? forwardedFor.split(',')[0].trim() : realIp || '';

            if (!clientIp || !allowlist.includes(clientIp)) {
              set.status = 403;
              return { error: 'Forbidden' };
            }
          }
        }

        set.headers['Content-Type'] = register.contentType;
        return register.metrics();
      },
      {
        detail: {
          tags: ['Metrics'],
          description: 'Prometheus metrics endpoint',
        },
      },
    );

  // Auth routes (REST API for OAuth flow)
  app.use(authRoutes);

  // Character routes (spell data, etc.)
  app.use(charactersRoutes);

  // LLM routes (AI text generation)
  app.use(llmRoutes);

  // Image routes (AI image generation)
  app.use(imageRoutes);
  app.use(aiProxyRoutes);

  // Blog admin auth routes (separate from WorkOS)
  app.use(blogAdminAuthRoutes);

  // Billing routes (Stripe subscription management)
  app.use(billingRoutes);

  // Combat routes (D&D 5E combat system)
  app.use(combatRoutes);
  app.use(tacticalMapRoutes);
  app.use(handoutRoutes);

  // Inventory routes (D&D 5E inventory management)
  app.use(inventoryRoutes);

  // Spell slots routes (D&D 5E spell slot tracking)
  app.use(spellSlotsCharacterRoutes);
  app.use(spellSlotsUtilityRoutes);

  // Progression routes (D&D 5E XP and leveling)
  app.use(progressionRoutes);

  // Rest routes (D&D 5E short/long rest mechanics)
  app.use(restRoutes);

  // Class features routes (D&D 5E class features and subclasses)
  app.use(classFeaturesRoutes);

  // Observability routes (frontend error/metric logging)
  app.use(observabilityRoutes);

  // Encounters routes (encounter telemetry)
  app.use(encountersRoutes);

  // Campaigns routes (campaign CRUD)
  app.use(campaignsRoutes);
  app.use(publicCampaignTemplateRoutes);

  // Sessions routes (game session management)
  app.use(sessionsRoutes);
  app.use(securedGameDataRoutes);
  app.use(sessionMessageRoutes);
  app.use(memoryRoutes);

  // Personality routes (D&D personality elements)
  app.use(personalityRoutes);

  // Admin routes (system maintenance)
  app.use(adminRoutes);

  // Spells routes (D&D spell data)
  app.use(spellsRoutes);

  // Waitlist routes (landing page signups)
  app.use(waitlistRoutes);

  // Internal routes (CI/CD automation)
  app.use(internalRoutes);

  // Blog API routes (CRUD for blog posts, categories, tags)
  app.use(blogApiRoutes);

  // tRPC integration using native fetch adapter (compatible with tRPC v11)
  // Mount tRPC at /api/trpc/* endpoint with context creation
  app.all('/api/trpc/*', async ({ request }) => {
    return fetchRequestHandler({
      endpoint: '/api/trpc',
      req: request,
      router: appRouter,
      createContext: ({ req, resHeaders }) => createContext({ req, resHeaders }),
    });
  });

  // SSR routes (React Server-Side Rendering with Web Streams)
  app.use(blogRoutes);
  app.use(chronicleRoutes);
  app.use(landingRoutes);
  app.use(seoRoutes);

  // LLM documentation routes (llms.txt standard)
  app.use(llmsRoutes);

  // WebSocket support for real-time Foundry VTT collaboration
  app.use(wsPlugin);

  return app;
}
