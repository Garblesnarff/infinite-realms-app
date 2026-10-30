import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [['list']],
  webServer: [
    {
      command: 'bun run server:start:ci',
      url: 'http://localhost:8891/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        PORT: '8891',
        NODE_ENV: 'test',
        SUPABASE_JWT_SECRET: 'testsecret',
        BLOG_ADMIN_DEV_OVERRIDE: '0',
      },
    },
    {
      command: 'bun run server:start:ci',
      url: 'http://localhost:8892/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        PORT: '8892',
        NODE_ENV: 'test',
        SUPABASE_JWT_SECRET: 'testsecret',
        BLOG_ADMIN_DEV_OVERRIDE: '1',
      },
    },
    {
      command: 'bun x vite --host 127.0.0.1 --port 4173',
      url: 'http://127.0.0.1:4173/e2e/game-panel-layout.html',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        VITE_SUPABASE_URL: 'https://example.supabase.co',
        VITE_SUPABASE_ANON_KEY: 'playwright-layout-harness',
      },
    },
  ],
  use: {
    // Base URL is provided per-project
    extraHTTPHeaders: {
      'Content-Type': 'application/json',
    },
  },
  projects: [
    {
      name: 'api-user',
      use: {
        baseURL: 'http://localhost:8891',
      },
      metadata: { role: 'user' },
    },
    {
      name: 'api-admin',
      use: {
        baseURL: 'http://localhost:8892',
      },
      metadata: { role: 'admin' },
    },
  ],
});
