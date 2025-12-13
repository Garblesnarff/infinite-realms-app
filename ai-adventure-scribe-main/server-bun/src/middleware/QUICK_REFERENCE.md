# Middleware Quick Reference

One-page reference for Elysia middleware usage.

## Import

```typescript
import {
  requireAuth,        // Required authentication
  optionalAuth,       // Optional authentication
  planRateLimit,      // Plan-aware rate limiting
  createSimpleRateLimit, // Simple rate limiting
  metricsPlugin,      // Prometheus metrics
  metricsEndpoint,    // /metrics endpoint
  loggingPlugin,      // Request/response logging
} from './middleware/index.js';
```

## Authentication

```typescript
// Required auth (401 if missing)
app.use(requireAuth).get('/api/user/profile', ({ user }) => {
  return { userId: user.userId, email: user.email, plan: user.plan };
});

// Optional auth (guest allowed)
app.use(optionalAuth).get('/api/content', ({ user }) => {
  return { premium: user?.plan !== 'free' };
});
```

## Rate Limiting

```typescript
// Plan-aware (llm, images, default)
app.use(optionalAuth)
   .use(planRateLimit('llm'))
   .post('/api/chat', handler);

// Simple (per-IP)
app.use(createSimpleRateLimit({ windowMs: 60_000, max: 100 }))
   .get('/api/public', handler);

// Custom config
const config = {
  key: 'custom',
  perIp: { windowMs: 60_000, maxByPlan: { free: 5, pro: 50 } },
  perUser: { windowMs: 60_000, maxByPlan: { free: 3, pro: 30 } },
};
app.use(optionalAuth).use(planRateLimit(config)).post('/api/custom', handler);
```

## Metrics & Logging

```typescript
// Global middleware
app.use(loggingPlugin)   // Logs all requests
   .use(metricsPlugin)   // Tracks metrics
   .use(metricsEndpoint) // Adds /metrics endpoint
   .get('/api/data', handler);
```

## Route Groups

```typescript
app.group('/api/user', (app) =>
  app.use(requireAuth)
     .use(planRateLimit())
     .get('/profile', ({ user }) => ({ user }))
     .put('/settings', ({ user, body }) => ({ updated: true }))
);
```

## Complete Example

```typescript
import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import {
  requireAuth,
  optionalAuth,
  planRateLimit,
  metricsPlugin,
  loggingPlugin,
} from './middleware/index.js';

const app = new Elysia()
  // Global
  .use(cors())
  .use(loggingPlugin)
  .use(metricsPlugin)

  // Public
  .get('/health', () => ({ status: 'ok' }))

  // LLM (plan-aware)
  .use(optionalAuth)
  .use(planRateLimit('llm'))
  .post('/api/chat', ({ user, body }) => ({ response: 'AI' }))

  // Protected
  .use(requireAuth)
  .use(planRateLimit())
  .group('/api/user', (app) =>
    app.get('/profile', ({ user }) => ({ user }))
       .put('/profile', ({ user, body }) => ({ updated: true }))
  )

  .listen(3000);
```

## Testing

```typescript
import { describe, it, expect } from 'bun:test';
import { requireAuth } from './middleware/auth';

describe('Auth', () => {
  it('returns 401 without token', async () => {
    const app = new Elysia()
      .use(requireAuth)
      .get('/test', ({ user }) => ({ user }));

    const res = await app.handle(new Request('http://localhost/test'));
    expect(res.status).toBe(401);
  });
});

// Run: bun test src/middleware/test-example.ts
```

## Environment Variables

```bash
# Rate limits (per user)
RATE_LIMIT_LLM_USER_FREE=10
RATE_LIMIT_LLM_USER_PRO=60
RATE_LIMIT_IMAGES_USER_FREE=5
RATE_LIMIT_DEFAULT_USER_FREE=60

# Auth
WORKOS_API_KEY=sk_test_...
WORKOS_CLIENT_ID=client_...
DATABASE_URL=postgresql://...
```

## Context Properties

```typescript
app.get('/example', ({
  user,       // AuthTokenPayload | null (from auth middleware)
  requestId,  // string (from logging middleware)
  request,    // Request (Web API)
  body,       // Parsed body
  query,      // Query params
  params,     // Path params
  set,        // Response setter (status, headers)
  store,      // Request-scoped storage
}) => {
  return { data: 'response' };
});
```

## Rate Limit Plans

| Endpoint | Free | Pro | Enterprise |
|----------|------|-----|------------|
| LLM (user) | 10/min | 60/min | 300/min |
| Images (user) | 5/min | 30/min | 150/min |
| Default (user) | 60/min | 600/min | 2000/min |

## Status Codes

| Code | Meaning | Middleware |
|------|---------|-----------|
| 200 | Success | - |
| 401 | Unauthorized | requireAuth |
| 429 | Rate Limit | planRateLimit, createSimpleRateLimit |
| 500 | Server Error | - |

## Headers

**Request**:
- `Authorization: Bearer <token>` - WorkOS access token
- `X-Plan: free|pro|enterprise` - Plan override (testing)

**Response**:
- `X-Request-Id: req_abc123_xyz789` - Unique request ID
- `Retry-After: 60` - Seconds until rate limit resets (429 only)

## Metrics

Access at `http://localhost:3000/metrics`:

```
http_requests_total{method="POST",route="/api/chat",status="200"} 42
http_request_duration_seconds_bucket{method="POST",route="/api/chat",status="200",le="0.1"} 38
```

## Logs

```json
{
  "level": "info",
  "time": 1702400000000,
  "service": "infiniterealms-bun",
  "type": "request",
  "requestId": "req_abc123",
  "method": "POST",
  "path": "/api/chat",
  "ip": "192.168.1.1",
  "msg": "→ POST /api/chat"
}
```

## Common Patterns

**Optional auth + rate limit**:
```typescript
app.use(optionalAuth).use(planRateLimit('llm')).post('/chat', handler);
```

**Required auth + default rate limit**:
```typescript
app.use(requireAuth).use(planRateLimit()).get('/profile', handler);
```

**Public endpoint with simple rate limit**:
```typescript
app.use(createSimpleRateLimit({ windowMs: 60000, max: 100 })).get('/public', handler);
```

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| User undefined | Auth not applied | Add `.use(requireAuth)` or `.use(optionalAuth)` |
| Rate limit not working | Auth before rate limit | Ensure auth middleware comes first |
| 401 on public route | Used requireAuth | Use `optionalAuth` instead |
| Metrics not showing | Plugin not applied | Add `.use(metricsPlugin)` globally |

## Documentation

- [README.md](./README.md) - Overview
- [USAGE.md](./USAGE.md) - Detailed examples
- [MIGRATION.md](./MIGRATION.md) - Express → Elysia guide
- [test-example.ts](./test-example.ts) - Test patterns

## Cheat Sheet

```typescript
// Minimal app
const app = new Elysia()
  .use(loggingPlugin)
  .use(metricsPlugin)
  .get('/', () => 'Hello')
  .listen(3000);

// Protected app
const app = new Elysia()
  .use(loggingPlugin)
  .use(metricsPlugin)
  .use(requireAuth)
  .use(planRateLimit())
  .get('/api/data', ({ user }) => ({ user }))
  .listen(3000);

// Mixed app
const app = new Elysia()
  .use(loggingPlugin)
  .use(metricsPlugin)
  .get('/public', () => 'public')
  .use(requireAuth)
  .get('/private', ({ user }) => ({ user }))
  .listen(3000);
```

---

**Print this page for quick reference during development!**
