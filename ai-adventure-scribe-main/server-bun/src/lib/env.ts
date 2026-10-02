/**
 * Environment Variable Validation
 *
 * Validates and exports typed environment variables for the Bun server.
 * Validation runs on the first read of `env` (or a call to `getEnv()`), not on
 * import, so a module that only imports this file can load without a full
 * environment. Throws if required variables are missing.
 */

interface Env {
  // Database
  DATABASE_URL: string;
  PGSSL?: string;
  PGPOOL_MAX?: string;

  // Server
  PORT: string;
  CORS_ORIGIN: string;

  // WorkOS Authentication
  WORKOS_API_KEY: string;
  WORKOS_CLIENT_ID: string;

  // Supabase (optional - only needed for certain features)
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_SERVICE_KEY?: string;

  // Optional: Node environment
  NODE_ENV?: string;

  // Stripe (optional - only needed for billing)
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_ID?: string;
}

/**
 * Validate required environment variables
 * Throws error if any required variable is missing
 */
function validateEnv(): Env {
  const requiredVars = [
    'DATABASE_URL',
    'PORT',
    'CORS_ORIGIN',
    'WORKOS_API_KEY',
    'WORKOS_CLIENT_ID',
  ] as const;

  const missing: string[] = [];

  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables:\n${missing.map((v) => `  - ${v}`).join('\n')}`,
    );
  }

  return {
    DATABASE_URL: process.env.DATABASE_URL!,
    PGSSL: process.env.PGSSL,
    PGPOOL_MAX: process.env.PGPOOL_MAX,
    PORT: process.env.PORT!,
    CORS_ORIGIN: process.env.CORS_ORIGIN!,
    WORKOS_API_KEY: process.env.WORKOS_API_KEY!,
    WORKOS_CLIENT_ID: process.env.WORKOS_CLIENT_ID!,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY:
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY,
    SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
    NODE_ENV: process.env.NODE_ENV || 'development',
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    STRIPE_PRICE_ID: process.env.STRIPE_PRICE_ID,
  };
}

let cached: Env | undefined;

/** Validate once and return the typed environment. Throws on missing variables. */
export function getEnv(): Env {
  cached ??= validateEnv();
  return cached;
}

/**
 * Validated environment variables, checked on first property read.
 * Access via: env.DATABASE_URL, env.PORT, etc.
 */
export const env: Env = new Proxy({} as Env, {
  get: (_target, prop) => getEnv()[prop as keyof Env],
});
