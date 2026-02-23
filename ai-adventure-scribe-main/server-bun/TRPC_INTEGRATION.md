# tRPC Integration with Elysia

This document describes how tRPC has been integrated with Elysia for the Bun migration.

## Overview

The tRPC integration reuses the existing router definitions from `/server/src/trpc/` while providing an Elysia-compatible adapter layer. This allows us to migrate to Bun/Elysia without rewriting any of the existing tRPC procedures.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Existing tRPC Routers (Framework-Agnostic)         │
│  /server/src/trpc/routers/                          │
│  - auth.ts, blog.ts, scenes.ts, etc.                │
└─────────────────────────────────────────────────────┘
                        ↑
                        │ imported by
                        │
┌─────────────────────────────────────────────────────┐
│  Bun/Elysia Adapter Layer                           │
│  /server-bun/src/trpc/                              │
│  - index.ts: Re-exports appRouter                   │
│  - context.ts: Elysia-compatible context creation   │
└─────────────────────────────────────────────────────┘
                        ↑
                        │ used by
                        │
┌─────────────────────────────────────────────────────┐
│  Elysia App                                         │
│  /server-bun/src/app.ts                             │
│  - Mounts tRPC at /api/trpc                         │
└─────────────────────────────────────────────────────┘
```

## Files Created

### 1. `/server-bun/src/services/workos.ts`
- Provides WorkOS JWT token verification
- Uses `jose` library for JWT signature validation
- Ported from `/server/src/services/workos.ts`

### 2. `/server-bun/src/lib/jwt.ts`
- Helper function to extract Bearer tokens from Authorization headers
- Simple utility used by context creation

### 3. `/server-bun/src/trpc/context.ts`
- Creates tRPC context for each request
- Compatible with Elysia's Fetch API (Request/Headers)
- Includes:
  - Database client (Drizzle ORM)
  - Authenticated user from WorkOS token
  - User's subscription plan (from database or headers)

### 4. `/server-bun/src/trpc/index.ts`
- Re-exports `appRouter` from existing Express implementation
- Exports Elysia-specific `createContext` function
- Central export point for tRPC integration

### 5. `/server-bun/src/app.ts` (updated)
- Imports `@elysiajs/trpc` plugin
- Mounts tRPC router at `/api/trpc` endpoint
- Wires up context creation

## Key Differences from Express Adapter

### Express (Original)
```typescript
import { createExpressMiddleware } from '@trpc/server/adapters/express';

app.use('/api/trpc', createExpressMiddleware({
  router: appRouter,
  createContext({ req, res }) {
    // Express req/res objects
  }
}));
```

### Elysia (New)
```typescript
import { trpc } from '@elysiajs/trpc';

app.use(trpc(appRouter, {
  endpoint: '/api/trpc',
  createContext({ req, resHeaders }) {
    // Fetch API Request/Headers
  }
}));
```

## Context Shape

The context maintains the same shape as the Express version to ensure router compatibility:

```typescript
{
  req: Request,              // Fetch API Request (vs Express req)
  resHeaders: Headers,       // Fetch API Headers (vs Express res)
  db: DrizzleDb,            // Same Drizzle ORM instance
  user: AuthUser | null     // Same user object structure
}
```

## Environment Variables Required

See `.env.example` for required environment variables:

- `DATABASE_URL` - PostgreSQL connection string
- `WORKOS_API_KEY` - WorkOS API key for token verification
- `WORKOS_CLIENT_ID` - WorkOS client ID (used in JWKS URL)
- `WORKOS_REDIRECT_URI` - OAuth redirect URI

## Testing the Integration

1. Ensure environment variables are set in `.env`
2. Build TypeScript files (required for imports):
   ```bash
   bun run server:build  # Builds /server/src
   bunx tsc db/schema/*.ts --module esnext --moduleResolution bundler --target esnext
   ```
3. Start the Bun server:
   ```bash
   cd server-bun
   bun src/index.ts
   ```
4. tRPC endpoints will be available at `http://localhost:8889/api/trpc`

## Build Requirements

**Important**: The existing tRPC routers import from compiled JavaScript files (`.js` extensions). Before running the Bun server, you must compile:

1. **Database schema**: `db/schema/*.ts` → `db/schema/*.js`
2. **Server code**: `server/src/**/*.ts` → `server/dist/**/*.js`

This can be automated in a build script or pre-start hook.

## Router Compatibility

All existing routers work without modification:
- ✅ Auth router (`/server/src/trpc/routers/auth.ts`)
- ✅ Blog router (`/server/src/trpc/routers/blog.ts`)
- ✅ Scenes router (`/server/src/trpc/routers/scenes.ts`)
- ✅ Tokens router (`/server/src/trpc/routers/tokens.ts`)
- ✅ Drawings router (`/server/src/trpc/routers/drawings.ts`)
- ✅ Measurements router (`/server/src/trpc/routers/measurements.ts`)
- ✅ Characters router (`/server/src/trpc/routers/characters.ts`)
- ✅ Character Folders router (`/server/src/trpc/routers/character-folders.ts`)
- ✅ Fog of War router (`/server/src/trpc/routers/fog-of-war.ts`)
- ✅ Vision Blockers router (`/server/src/trpc/routers/vision-blockers.ts`)

## Next Steps

1. Add build automation (compile TypeScript before server start)
2. Add tRPC client setup in frontend
3. Test all routers with real requests
4. Add WebSocket support for subscriptions
5. Performance testing and optimization

## Troubleshooting

### "Export named 'X' not found in module"
This means the TypeScript files haven't been compiled to JavaScript. Run the build commands above.

### "Missing API key" error
Ensure `WORKOS_API_KEY` is set in your `.env` file.

### Context type errors
The context shape must match between Elysia adapter and existing routers. Check that `AuthUser` interface is identical.

## References

- [Elysia tRPC Plugin](https://elysiajs.com/plugins/trpc.html)
- [tRPC Documentation](https://trpc.io/docs)
- [WorkOS JWT Verification](https://workos.com/docs/reference/sso/jwt-verification)
