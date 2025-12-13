# InfiniteRealms Bun Server

Elysia-based server for InfiniteRealms, migrated from Express to leverage Bun's native performance.

## Tech Stack

- **Runtime**: Bun 1.3+
- **Framework**: Elysia 1.0+
- **Database**: PostgreSQL via postgres.js
- **ORM**: Drizzle ORM
- **Logging**: Pino (structured JSON logging)
- **Metrics**: Prometheus (prom-client)

## Quick Start

```bash
# Install dependencies
bun install

# Copy environment variables
cp .env.example .env
# Edit .env with your actual values

# Development (with hot reload)
bun run dev

# Production
bun run start
```

## Project Structure

```
server-bun/
├── src/
│   ├── index.ts          # Server entry point
│   ├── app.ts            # Elysia application setup
│   └── lib/
│       ├── logger.ts     # Pino logger configuration
│       ├── metrics.ts    # Prometheus metrics
│       ├── env.ts        # Environment validation
│       ├── db.ts         # PostgreSQL client (postgres.js)
│       └── drizzle.ts    # Drizzle ORM setup
├── package.json
├── tsconfig.json
└── .env.example
```

## Features

### Current
- ✅ Health check endpoint (`/health`)
- ✅ Prometheus metrics (`/metrics`)
- ✅ Structured logging with Pino
- ✅ CORS configuration (localhost + production)
- ✅ Static file serving (`/assets`)
- ✅ Request ID tracking
- ✅ Swagger documentation (`/swagger`)
- ✅ Graceful shutdown handling

### Planned
- 🔄 tRPC integration (via @elysiajs/trpc)
- 🔄 WebSocket support for real-time features
- 🔄 Database migrations with Drizzle
- 🔄 Route handlers migration from Express
- 🔄 Blog SSR routes
- 🔄 WorkOS authentication middleware

## API Endpoints

### System
- `GET /health` - Health check with uptime and memory stats
- `GET /metrics` - Prometheus metrics (CPU, memory, HTTP requests)
- `GET /swagger` - Swagger UI documentation

### Planned
- `/api/trpc/*` - tRPC API routes
- `/ws` - WebSocket connection
- `/blog/*` - Blog SSR routes (from Express)

## Environment Variables

See `.env.example` for required variables:

- `PORT` - Server port (default: 8888)
- `DATABASE_URL` - PostgreSQL connection string
- `CORS_ORIGIN` - Allowed CORS origins (comma-separated)
- `WORKOS_API_KEY` - WorkOS authentication key
- `WORKOS_CLIENT_ID` - WorkOS client ID
- `SUPABASE_URL` - Supabase instance URL
- `SUPABASE_SERVICE_KEY` - Supabase service role key

## Migration Status

This is a **work in progress** migration from the Express server at `/server`.

**Migration checklist:**
- [x] Core server setup (Elysia + middleware)
- [x] Logging (Pino replaces Winston)
- [x] Metrics (Prometheus)
- [x] Health checks
- [x] CORS configuration
- [x] Static file serving
- [ ] tRPC integration
- [ ] WebSocket support
- [ ] Blog SSR routes
- [ ] Authentication middleware
- [ ] Database queries migration
- [ ] Route handlers migration

## Development

### Hot Reload
Bun's `--watch` flag provides instant hot reload:

```bash
bun run dev
```

### Type Checking
TypeScript types are checked by Bun automatically. For strict checking:

```bash
bun --bun tsc --noEmit
```

### Testing
```bash
bun test
```

## Performance

Elysia + Bun provides significant performance improvements over Express:

- **Faster startup**: Bun's native TypeScript execution
- **Lower memory**: No transpilation overhead
- **Higher throughput**: Elysia's optimized routing
- **Native PostgreSQL**: postgres.js is faster than node-postgres

## Comparison with Express Server

| Feature | Express (`/server`) | Elysia (`/server-bun`) |
|---------|-------------------|----------------------|
| Runtime | Node.js | Bun |
| Framework | Express | Elysia |
| Logger | Winston | Pino |
| DB Client | pg (node-postgres) | postgres.js |
| WebSocket | ws | Native Bun WS |
| Performance | Baseline | 2-3x faster |

## Notes

- **Path aliases**: Uses `@/*` for `src/*` (configured in `tsconfig.json`)
- **ESM only**: All imports use ESM syntax (`import`, not `require`)
- **Bun APIs**: Can use native Bun APIs (e.g., `Bun.file()`, `Bun.serve()`)
- **Compatibility**: Elysia plugins replace Express middleware

## References

- [Elysia Documentation](https://elysiajs.com)
- [Bun Documentation](https://bun.sh/docs)
- [Drizzle ORM](https://orm.drizzle.team)
- [postgres.js](https://github.com/porsager/postgres)
