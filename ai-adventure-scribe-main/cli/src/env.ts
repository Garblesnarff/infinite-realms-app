export interface CliEnvironment {
  apiUrl: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
}

type Environment = Record<string, string | undefined>;

export function resolveCliEnvironment(env: Environment): CliEnvironment {
  return {
    apiUrl: env.CLI_API_URL || env.VITE_API_URL || 'http://localhost:8888',
    supabaseUrl: env.CLI_SUPABASE_URL || env.VITE_SUPABASE_URL,
    supabaseAnonKey: env.CLI_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY,
  };
}

export function applyCliEnvironment(env: Environment = process.env): CliEnvironment {
  const resolved = resolveCliEnvironment(env);
  process.env.VITE_API_URL = resolved.apiUrl;
  if (resolved.supabaseUrl) process.env.VITE_SUPABASE_URL = resolved.supabaseUrl;
  if (resolved.supabaseAnonKey) process.env.VITE_SUPABASE_ANON_KEY = resolved.supabaseAnonKey;
  return resolved;
}
