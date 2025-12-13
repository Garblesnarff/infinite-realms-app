# Express to Elysia Migration Checklist

## Overview
This document tracks the migration from Express (`/server`) to Elysia (`/server-bun`).

## Core Setup ✅

- [x] Package.json with Elysia dependencies
- [x] TypeScript configuration (tsconfig.json)
- [x] Elysia app setup (src/app.ts)
- [x] Server entry point (src/index.ts)
- [x] Logger (Pino replacing Winston)
- [x] Metrics (Prometheus/prom-client)
- [x] Health check endpoint
- [x] CORS configuration
- [x] Static file serving
- [x] Swagger documentation
- [x] Request ID middleware
- [x] Request/error logging
- [x] Graceful shutdown handlers
- [x] Environment variable setup

## Database Layer ✅

- [x] PostgreSQL client (postgres.js)
- [x] Drizzle ORM setup
- [x] Environment validation (lib/env.ts)

## Routes to Migrate 🔄

### API Routes
- [ ] `/api/trpc/*` - tRPC routes
  - [ ] Set up @elysiajs/trpc adapter
  - [ ] Port tRPC router
  - [ ] Port tRPC context
- [ ] Other API endpoints (if any)

### Blog Routes (SSR)
- [ ] `/blog` - Blog listing page
- [ ] `/blog/:slug` - Individual blog post
- [ ] Blog admin routes
- [ ] SEO routes (sitemap.xml, robots.txt, rss.xml)

### Landing Page Routes
- [ ] `/` - Landing page SSR

## Middleware to Port 🔄

- [x] CORS ✅
- [x] Request ID ✅
- [x] Request logging ✅
- [x] Error logging ✅
- [x] Metrics ✅
- [ ] Authentication (WorkOS)
- [ ] Rate limiting (if present)
- [ ] Caching headers

## Services to Port 🔄

- [ ] Blog service (server/src/services/blog-service.ts)
- [ ] Blog scheduler (server/src/services/blog-scheduler.ts)
- [ ] Blog content generator (server/src/services/blog-content-generator.ts)
- [ ] Other services (TBD)

## WebSocket Support 🔄

- [ ] WebSocket server setup
- [ ] Port existing WS handlers from Express
- [ ] Register WS routes in Elysia

## Testing 🔄

- [ ] Unit tests for services
- [ ] Integration tests for API routes
- [ ] E2E tests for critical paths
- [ ] Load testing comparison (Express vs Elysia)

## Deployment 🔄

- [ ] Production environment variables
- [ ] Docker configuration (if needed)
- [ ] nginx configuration updates
- [ ] Health check integration with load balancer
- [ ] Metrics integration with monitoring
- [ ] Logging integration with aggregation service

## Performance Optimization 🔄

- [ ] Benchmark current Express performance
- [ ] Benchmark Elysia performance
- [ ] Optimize database queries with Drizzle
- [ ] Add caching where appropriate
- [ ] Profile memory usage

## Documentation 📝

- [x] README.md ✅
- [x] MIGRATION.md ✅
- [ ] API documentation (via Swagger)
- [ ] Deployment guide
- [ ] Troubleshooting guide

## Rollout Plan 📋

1. **Phase 1: Core Setup** ✅ COMPLETE
   - Server setup, logging, metrics, health checks
   - TypeScript compilation passing
   - Dependencies installed

2. **Phase 2: Database & Auth** (CURRENT)
   - Database migrations
   - Authentication middleware
   - User context

3. **Phase 3: API Routes**
   - tRPC integration
   - Port API endpoints
   - Testing

4. **Phase 4: SSR Routes**
   - Blog SSR
   - Landing page SSR
   - SEO routes

5. **Phase 5: WebSocket**
   - WS server setup
   - Port WS handlers
   - Real-time features

6. **Phase 6: Production**
   - Production testing
   - Performance validation
   - Gradual rollout
   - Monitor metrics

## Key Differences: Express vs Elysia

| Feature | Express | Elysia |
|---------|---------|--------|
| Runtime | Node.js | Bun |
| Middleware | `app.use()` | `app.use()` (plugins) |
| Routes | `app.get/post/etc` | `app.get/post/etc` |
| Context | `req, res, next` | Elysia context object |
| Error Handling | Error middleware | `.onError()` hook |
| Request Logging | Middleware | `.onRequest()` hook |
| CORS | `cors` package | `@elysiajs/cors` |
| Static Files | `express.static` | `@elysiajs/static` |
| Swagger | `swagger-ui-express` | `@elysiajs/swagger` |
| WebSocket | `ws` package | Native Bun WS |
| Performance | Baseline | 2-3x faster |

## Notes

- **Path Aliases**: Both use `@/*` for `src/*`
- **ESM**: Both use ESM imports (not CommonJS)
- **TypeScript**: Both use TypeScript (Elysia has better inference)
- **Request ID**: Implemented via `.derive()` in Elysia
- **Logging**: Pino is faster than Winston, better structured logs
- **Database**: postgres.js is faster than pg, Bun-optimized

## Testing the Current Setup

```bash
# Install dependencies
cd /var/www/infiniterealms/ai-adventure-scribe-main/server-bun
bun install

# Set up environment
cp .env.example .env
# Edit .env with actual values

# Run development server
bun run dev

# Test endpoints
curl http://localhost:8889/health
curl http://localhost:8889/metrics
open http://localhost:8889/swagger

# Type checking
bun --bun tsc --noEmit

# Or use the test script
./test-server.sh
```

## Next Steps

1. **Set up full environment variables** in `.env`
2. **Port tRPC integration** for API routes
3. **Migrate database queries** to use postgres.js + Drizzle
4. **Port authentication middleware** for WorkOS
5. **Begin migrating API routes** one by one
6. **Add tests** as routes are migrated

## Questions/Issues

- Should we run both servers in parallel during migration?
- How to handle sessions/cookies between servers?
- What's the rollout strategy (feature flag, gradual traffic shift, etc.)?
- Do we need backward compatibility layer?

---

**Last Updated**: 2025-12-13
**Current Phase**: Phase 1 Complete, Phase 2 Starting
**Status**: Core setup complete, ready for database and auth migration
