import { describe, expect, it } from 'vitest';

import { resolveCliEnvironment } from './env';

describe('CLI environment resolution', () => {
  it('prefers CLI-specific values over browser-compatible fallbacks', () => {
    expect(resolveCliEnvironment({
      CLI_API_URL: 'https://cli-api.example',
      VITE_API_URL: 'https://vite-api.example',
      CLI_SUPABASE_URL: 'https://cli-db.example',
      VITE_SUPABASE_URL: 'https://vite-db.example',
      CLI_SUPABASE_ANON_KEY: 'cli-key',
      VITE_SUPABASE_ANON_KEY: 'vite-key',
    })).toEqual({
      apiUrl: 'https://cli-api.example',
      supabaseUrl: 'https://cli-db.example',
      supabaseAnonKey: 'cli-key',
    });
  });

  it('supports legacy VITE values and the local API default', () => {
    expect(resolveCliEnvironment({
      VITE_SUPABASE_URL: 'https://vite-db.example',
      VITE_SUPABASE_ANON_KEY: 'vite-key',
    })).toEqual({
      apiUrl: 'http://localhost:8888',
      supabaseUrl: 'https://vite-db.example',
      supabaseAnonKey: 'vite-key',
    });
  });
});
