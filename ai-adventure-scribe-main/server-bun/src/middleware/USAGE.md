# Elysia Middleware Usage Guide

This guide shows how to use the converted middleware plugins in your Elysia server.

## Available Middleware

1. **Authentication** (`auth.ts`)
   - `requireAuth` - Requires valid WorkOS authentication
   - `optionalAuth` - Attaches user if authenticated, continues if not

2. **Rate Limiting** (`rate-limit.ts`)
   - `planRateLimit()` - Plan-aware rate limiting (free/pro/enterprise)
   - `createSimpleRateLimit()` - Simple per-IP rate limiting

3. **Metrics** (`metrics.ts`)
   - `metricsPlugin` - Prometheus metrics collection
   - `metricsEndpoint` - Exposes `/metrics` endpoint

4. **Logging** (`logging.ts`)
   - `loggingPlugin` - Request/response logging with request IDs

## Basic Setup

```typescript
import { Elysia } from 'elysia';
import {
  requireAuth,
  optionalAuth,
  planRateLimit,
  metricsPlugin,
  metricsEndpoint,
  loggingPlugin,
} from './middleware/index.js';

const app = new Elysia()
  // Global middleware - applied to all routes
  .use(loggingPlugin)
  .use(metricsPlugin)
  .use(metricsEndpoint)

  // Public routes (no auth)
  .get('/', () => ({ message: 'Hello World' }))

  // Protected routes (require auth)
  .use(requireAuth)
  .get('/protected', ({ user }) => {
    return {
      message: `Hello ${user.email}`,
      plan: user.plan,
    };
  })

  .listen(3000);

console.log(`Server running at http://localhost:3000`);
```

## Authentication Examples

### Required Authentication

```typescript
import { requireAuth } from './middleware/auth.js';

// Single protected route
app.use(requireAuth)
  .get('/api/user/profile', ({ user }) => {
    return {
      userId: user.userId,
      email: user.email,
      plan: user.plan,
    };
  });

// Group of protected routes
app.group('/api/user', (app) =>
  app
    .use(requireAuth)
    .get('/profile', ({ user }) => ({ user }))
    .get('/settings', ({ user }) => ({ userId: user.userId }))
    .post('/update', ({ user, body }) => {
      // Update user with body
      return { success: true };
    })
);
```

### Optional Authentication

```typescript
import { optionalAuth } from './middleware/auth.js';

// Route works for both authenticated and unauthenticated users
app.use(optionalAuth)
  .get('/api/content', ({ user }) => {
    if (user) {
      return { message: `Welcome back, ${user.email}`, premium: user.plan !== 'free' };
    } else {
      return { message: 'Welcome, guest', premium: false };
    }
  });
```

## Rate Limiting Examples

### Plan-Aware Rate Limiting

```typescript
import { planRateLimit } from './middleware/rate-limit.js';
import { optionalAuth } from './middleware/auth.js';

// LLM endpoints with plan-based limits
// Free: 10/min, Pro: 60/min, Enterprise: 300/min
app
  .use(optionalAuth)
  .use(planRateLimit('llm'))
  .post('/api/chat', async ({ body, user }) => {
    // Handle chat request
    return { response: 'AI response here' };
  });

// Image generation with different limits
// Free: 5/min, Pro: 30/min, Enterprise: 150/min
app
  .use(optionalAuth)
  .use(planRateLimit('images'))
  .post('/api/generate-image', async ({ body, user }) => {
    // Handle image generation
    return { imageUrl: 'https://...' };
  });

// Default rate limits
app
  .use(optionalAuth)
  .use(planRateLimit())
  .get('/api/data', () => ({ data: [] }));
```

### Simple Rate Limiting

```typescript
import { createSimpleRateLimit } from './middleware/rate-limit.js';

// Public endpoint: 100 requests per minute per IP
app
  .use(createSimpleRateLimit({ windowMs: 60_000, max: 100 }))
  .get('/api/public', () => ({ data: 'public data' }));

// Strict rate limit: 10 requests per minute
app
  .use(createSimpleRateLimit({ windowMs: 60_000, max: 10, key: 'strict' }))
  .post('/api/expensive-operation', async () => {
    // Expensive operation
    return { result: 'done' };
  });
```

### Custom Rate Limit Configuration

```typescript
import { planRateLimit } from './middleware/rate-limit.js';

// Custom limits for specific endpoint
const customConfig = {
  key: 'custom',
  perIp: {
    windowMs: 60_000, // 1 minute
    maxByPlan: {
      free: 5,
      pro: 50,
      enterprise: 500,
    },
  },
  perUser: {
    windowMs: 60_000,
    maxByPlan: {
      free: 3,
      pro: 30,
      enterprise: 300,
    },
  },
};

app
  .use(optionalAuth)
  .use(planRateLimit(customConfig))
  .post('/api/custom-endpoint', async () => {
    return { success: true };
  });
```

## Metrics Examples

### Enable Metrics Collection

```typescript
import { metricsPlugin, metricsEndpoint } from './middleware/metrics.js';

// Global metrics - tracks all routes
app.use(metricsPlugin);

// Expose metrics endpoint for Prometheus scraping
app.use(metricsEndpoint);

// Now all routes are automatically tracked:
// - http_requests_total (counter)
// - http_request_duration_seconds (histogram)
```

### Access Metrics

```bash
# Prometheus scrapes this endpoint
curl http://localhost:3000/metrics

# Example output:
# http_requests_total{method="GET",route="/api/chat",status="200"} 42
# http_request_duration_seconds_bucket{method="POST",route="/api/chat",status="200",le="0.1"} 38
```

## Logging Examples

### Enable Request Logging

```typescript
import { loggingPlugin, createModuleLogger } from './middleware/logging.js';

// Global logging - logs all requests/responses
app.use(loggingPlugin);

// Now all requests are logged with:
// - Unique request ID
// - Method, path, query params
// - Client IP, user agent
// - Response status, duration
// - Response size

// Use module logger in route handlers
const chatLogger = createModuleLogger('chat');

app.post('/api/chat', async ({ body }) => {
  chatLogger.info('Processing chat request', { messageCount: body.messages.length });
  // ... handle request
  chatLogger.info('Chat request completed');
  return { response: 'AI response' };
});
```

### Log Output Format

```json
{
  "level": "info",
  "time": 1702400000000,
  "service": "infiniterealms-bun",
  "type": "request",
  "requestId": "req_abc123_xyz789",
  "method": "POST",
  "path": "/api/chat",
  "ip": "192.168.1.1",
  "userAgent": "Mozilla/5.0...",
  "msg": "→ POST /api/chat"
}

{
  "level": "info",
  "time": 1702400000123,
  "service": "infiniterealms-bun",
  "type": "response",
  "requestId": "req_abc123_xyz789",
  "method": "POST",
  "path": "/api/chat",
  "statusCode": 200,
  "duration": 123,
  "responseSize": 456,
  "msg": "← POST /api/chat 200 123ms"
}
```

## Complete Example

```typescript
import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import {
  requireAuth,
  optionalAuth,
  planRateLimit,
  createSimpleRateLimit,
  metricsPlugin,
  metricsEndpoint,
  loggingPlugin,
} from './middleware/index.js';

const app = new Elysia()
  // Global middleware (order matters!)
  .use(cors())
  .use(loggingPlugin)      // 1. Log all requests
  .use(metricsPlugin)      // 2. Track metrics
  .use(metricsEndpoint)    // 3. Expose /metrics

  // Health check (no auth, no rate limit)
  .get('/health', () => ({ status: 'ok' }))

  // Public API (rate limited, no auth)
  .group('/api/public', (app) =>
    app
      .use(createSimpleRateLimit({ windowMs: 60_000, max: 100 }))
      .get('/status', () => ({ status: 'online' }))
      .get('/info', () => ({ name: 'InfiniteRealms API' }))
  )

  // LLM endpoints (plan-aware rate limiting, optional auth for plan detection)
  .group('/api/llm', (app) =>
    app
      .use(optionalAuth)
      .use(planRateLimit('llm'))
      .post('/chat', async ({ body, user }) => {
        return {
          response: 'AI response',
          plan: user?.plan || 'free',
        };
      })
  )

  // Image endpoints (plan-aware rate limiting)
  .group('/api/images', (app) =>
    app
      .use(optionalAuth)
      .use(planRateLimit('images'))
      .post('/generate', async ({ body, user }) => {
        return { imageUrl: 'https://...' };
      })
  )

  // Protected user endpoints (require authentication)
  .group('/api/user', (app) =>
    app
      .use(requireAuth)
      .use(planRateLimit())
      .get('/profile', ({ user }) => ({
        userId: user.userId,
        email: user.email,
        plan: user.plan,
      }))
      .put('/profile', async ({ user, body }) => {
        // Update profile
        return { success: true };
      })
      .get('/campaigns', async ({ user }) => {
        // Get user's campaigns
        return { campaigns: [] };
      })
  )

  .listen(3000);

console.log('🚀 Server running at http://localhost:3000');
console.log('📊 Metrics available at http://localhost:3000/metrics');
```

## Environment Variables

Rate limiting can be configured via environment variables:

```bash
# LLM rate limits
RATE_LIMIT_LLM_IP_WINDOW=60000
RATE_LIMIT_LLM_IP_FREE=20
RATE_LIMIT_LLM_IP_PRO=120
RATE_LIMIT_LLM_IP_ENTERPRISE=600

RATE_LIMIT_LLM_USER_WINDOW=60000
RATE_LIMIT_LLM_USER_FREE=10
RATE_LIMIT_LLM_USER_PRO=60
RATE_LIMIT_LLM_USER_ENTERPRISE=300

# Image rate limits
RATE_LIMIT_IMAGES_IP_WINDOW=60000
RATE_LIMIT_IMAGES_IP_FREE=10
RATE_LIMIT_IMAGES_IP_PRO=60
RATE_LIMIT_IMAGES_IP_ENTERPRISE=300

# Default rate limits
RATE_LIMIT_DEFAULT_IP_WINDOW=60000
RATE_LIMIT_DEFAULT_IP_FREE=60
RATE_LIMIT_DEFAULT_IP_PRO=600
RATE_LIMIT_DEFAULT_IP_ENTERPRISE=2000
```

## Testing Authentication

```bash
# Get WorkOS token (from your frontend auth flow)
export TOKEN="your-workos-access-token"

# Protected endpoint (requires auth)
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/user/profile

# Test with invalid token (should return 401)
curl -H "Authorization: Bearer invalid" \
  http://localhost:3000/api/user/profile

# Test plan override (for testing)
curl -H "Authorization: Bearer $TOKEN" \
  -H "X-Plan: enterprise" \
  http://localhost:3000/api/llm/chat
```

## Migration from Express

### Before (Express)

```typescript
import { requireAuth } from './middleware/auth';
import { planRateLimit } from './middleware/rate-limit';

app.post('/api/chat', requireAuth, planRateLimit('llm'), async (req, res) => {
  const user = req.user;
  const body = req.body;
  res.json({ response: 'AI response' });
});
```

### After (Elysia)

```typescript
import { requireAuth, planRateLimit } from './middleware/index';

app
  .use(requireAuth)
  .use(planRateLimit('llm'))
  .post('/api/chat', async ({ user, body }) => {
    return { response: 'AI response' };
  });
```

## Key Differences from Express

1. **Middleware as Plugins**: Middleware are Elysia plugins, not functions
2. **Context Object**: Single context object instead of `req, res, next`
3. **Return vs res.json()**: Return values directly instead of `res.json()`
4. **Chaining**: Use `.use()` to apply middleware, supports chaining
5. **Groups**: Use `.group()` for route grouping instead of Express Router
6. **Type Safety**: Full TypeScript support, context is typed
7. **Error Handling**: Return from `onBeforeHandle` to short-circuit, use `onError` for errors

## Troubleshooting

### Rate limit not working

- Make sure `optionalAuth` or `requireAuth` is used before `planRateLimit()` for per-user limits
- Check that `X-Plan` header or database plan is set correctly
- Verify environment variables are loaded

### Metrics not showing

- Ensure `metricsPlugin` is used before routes
- Check `/metrics` endpoint is accessible
- Verify `prom-client` is installed

### Authentication failing

- Check WorkOS API key and Client ID in `.env`
- Verify token is valid and not expired
- Check JWKS endpoint is accessible
- Look for errors in logs

### Logging not working

- Ensure `loggingPlugin` is first in middleware chain
- Check log level (`NODE_ENV=development` for debug logs)
- Verify Pino is installed and configured
