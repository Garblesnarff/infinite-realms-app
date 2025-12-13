# Quick Start Guide

## Prerequisites

- Bun 1.3+ installed
- PostgreSQL running (local Supabase instance)
- Environment variables configured

## Installation

```bash
cd /var/www/infiniterealms/ai-adventure-scribe-main/server-bun

# Install dependencies
bun install
```

## Configuration

1. Copy environment template:
```bash
cp .env.example .env
```

2. Edit `.env` with your actual values:
```bash
# Required for full functionality
DATABASE_URL=postgresql://postgres:your-password@localhost:54321/postgres
WORKOS_API_KEY=your_workos_api_key
WORKOS_CLIENT_ID=your_workos_client_id
SUPABASE_URL=http://localhost:54321
SUPABASE_SERVICE_KEY=your_supabase_service_role_key

# Server config
PORT=8889
NODE_ENV=development
CORS_ORIGIN=http://localhost:5173
```

## Running the Server

### Development Mode (with hot reload)
```bash
bun run dev
```

The server will restart automatically when you edit TypeScript files.

### Production Mode
```bash
bun run start
```

### Custom Port
```bash
PORT=3000 bun run dev
```

## Testing

### Manual Testing
```bash
# Health check
curl http://localhost:8889/health

# Prometheus metrics
curl http://localhost:8889/metrics

# Swagger UI
open http://localhost:8889/swagger
```

### Automated Test Script
```bash
./test-server.sh
```

### Type Checking
```bash
bun --bun tsc --noEmit
```

## Available Endpoints

### System Endpoints
- `GET /health` - Server health check
  - Returns: status, timestamp, uptime, memory usage
- `GET /metrics` - Prometheus metrics
  - Returns: HTTP request metrics, system metrics
- `GET /swagger` - Swagger UI documentation
  - Interactive API documentation

### Static Files
- `GET /assets/*` - Static file serving
  - Serves files from `dist/assets` directory
  - Configured with immutable caching

## Project Structure

```
src/
├── index.ts        # Entry point - server startup and shutdown
├── app.ts          # Elysia app - middleware and routes
└── lib/
    ├── logger.ts   # Pino logger setup
    ├── metrics.ts  # Prometheus metrics
    ├── env.ts      # Environment validation
    ├── db.ts       # PostgreSQL client
    └── drizzle.ts  # Drizzle ORM
```

## Development Tips

### Hot Reload
Bun's `--watch` flag provides instant hot reload. The server will automatically restart when you save TypeScript files.

### Debugging
1. Add `console.log()` or use the logger:
```typescript
import { logger } from '@/lib/logger';
logger.info({ msg: 'Debug info', data: yourData });
```

2. Check logs in the console - Pino outputs structured JSON

### Adding New Routes
Edit `src/app.ts`:
```typescript
export function createApp() {
  const app = new Elysia()
    // ... existing setup ...
    .get('/your-route', () => {
      return { message: 'Hello!' };
    });

  return app;
}
```

### Adding Middleware
Use Elysia hooks in `src/app.ts`:
```typescript
.onBeforeHandle(({ request }) => {
  // Your middleware logic
})
```

## Common Issues

### Port Already in Use
```bash
# Kill existing process on port 8889
lsof -ti:8889 | xargs kill -9

# Or use a different port
PORT=9000 bun run dev
```

### Environment Variables Missing
If you see "Missing required environment variables", check your `.env` file:
```bash
# Validate required variables
cat .env | grep -E "(DATABASE_URL|WORKOS|SUPABASE)"
```

### TypeScript Errors
```bash
# Check for type errors
bun --bun tsc --noEmit

# Most common: missing types
bun add -d @types/package-name
```

### Database Connection Issues
```bash
# Check PostgreSQL is running
psql -h localhost -p 54321 -U postgres -c "SELECT 1"

# Check DATABASE_URL in .env
echo $DATABASE_URL
```

## Performance

Elysia on Bun is significantly faster than Express on Node.js:

- **2-3x faster** request handling
- **Lower memory** usage (no transpilation)
- **Faster startup** (native TypeScript)
- **Better throughput** (optimized routing)

Compare with `/metrics` endpoint:
```bash
# HTTP request duration
curl http://localhost:8889/metrics | grep http_request_duration
```

## Next Steps

1. **Add tRPC integration** - See `MIGRATION.md`
2. **Port API routes** from Express server
3. **Add authentication** middleware
4. **Set up WebSocket** support
5. **Migrate database** queries to Drizzle

## Resources

- [Elysia Documentation](https://elysiajs.com)
- [Bun Documentation](https://bun.sh/docs)
- [Drizzle ORM](https://orm.drizzle.team)
- [Pino Logger](https://getpino.io)

## Getting Help

- Check `README.md` for detailed documentation
- See `MIGRATION.md` for migration progress
- Review Express server at `/server/src` for reference
- Check logs for error messages

---

**Server Location**: `/var/www/infiniterealms/ai-adventure-scribe-main/server-bun`
**Default Port**: 8889
**Swagger UI**: http://localhost:8889/swagger
