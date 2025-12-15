import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { staticPlugin } from '@elysiajs/static';
import { swagger } from '@elysiajs/swagger';
import { trpc } from '@elysiajs/trpc';
import { logger } from './lib/logger';
import { register, httpRequestCounter, httpRequestDuration } from './lib/metrics';
import { randomUUID } from 'crypto';
import { appRouter, createContext } from './trpc/index.js';
import { wsPlugin } from './ws';
import { blogRoutes } from './routes/blog.js';
import { landingRoutes } from './routes/landing.js';
import { seoRoutes } from './routes/seo.js';
import { authRoutes } from './routes/v1/auth';

export function createApp() {
  const app = new Elysia()
    // Request ID middleware
    .derive(({ request }) => {
      const requestId = request.headers.get('x-request-id') || randomUUID();
      return { requestId };
    })
    // Request logging middleware
    .onRequest(({ request, store }) => {
      const start = performance.now();
      (store as any).__startTime = start;

      const requestId = request.headers.get('x-request-id') || randomUUID();
      logger.info({
        requestId,
        method: request.method,
        url: new URL(request.url).pathname,
        msg: 'request.start',
      });
    })
    .onAfterHandle(({ request, response, store }) => {
      const start = (store as any).__startTime || performance.now();
      const durationMs = performance.now() - start;
      const url = new URL(request.url);
      const status = response instanceof Response ? response.status : 200;
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
        durationMs / 1000
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
    .onError(({ error, request }) => {
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

      return {
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'production' ? undefined : (error instanceof Error ? error.message : String(error)),
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
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com",
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
      })
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
      })
    )
    // Static file serving for /dist/assets
    .use(
      staticPlugin({
        assets: process.env.VITE_CLIENT_DIST || 'dist',
        prefix: '/assets',
        alwaysStatic: true,
      })
    )
    // Health check endpoint
    .get(
      '/health',
      () => ({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
      }),
      {
        detail: {
          tags: ['Health'],
          description: 'Health check endpoint',
        },
      }
    )
    // Prometheus metrics endpoint
    .get(
      '/metrics',
      async ({ set }) => {
        set.headers['Content-Type'] = register.contentType;
        return register.metrics();
      },
      {
        detail: {
          tags: ['Metrics'],
          description: 'Prometheus metrics endpoint',
        },
      }
    );

  // Auth routes (REST API for OAuth flow)
  app.use(authRoutes);

  // tRPC integration
  // Mount tRPC at /api/trpc endpoint with context creation
  app.use(
    trpc(appRouter, {
      endpoint: '/api/trpc',
      createContext: async ({ req, resHeaders }) => {
        return createContext({ req, resHeaders });
      },
    })
  );

  // SSR routes (React Server-Side Rendering with Web Streams)
  app.use(blogRoutes);
  app.use(landingRoutes);
  app.use(seoRoutes);

  // WebSocket support for real-time Foundry VTT collaboration
  app.use(wsPlugin);

  return app;
}
