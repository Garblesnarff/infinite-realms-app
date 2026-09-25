import { execFileSync } from 'node:child_process';
import path from 'path';

import react from '@vitejs/plugin-react-swc';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig, loadEnv } from 'vite';

const BUILD_VERSION_PLACEHOLDER = '__APP_BUILD_VERSION__';

function escapeHtmlAttribute(value: string): string {
  const replacements: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };

  return value.replace(/[&<>"']/g, (character) => replacements[character] ?? character);
}

function resolveBuildVersion(mode: string): string {
  const env = loadEnv(mode, process.cwd(), '');
  const configuredVersion =
    env.VITE_RELEASE ||
    env.VITE_APP_VERSION ||
    env.GITHUB_SHA ||
    env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA;

  if (configuredVersion?.trim()) return configuredVersion.trim();

  try {
    return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'dev';
  }
}

function injectBuildVersion(buildVersion: string): {
  name: string;
  transformIndexHtml: (html: string) => string;
} {
  return {
    name: 'inject-build-version',
    transformIndexHtml(html: string) {
      return html.replaceAll(BUILD_VERSION_PLACEHOLDER, escapeHtmlAttribute(buildVersion));
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    __APP_BUILD_VERSION__: JSON.stringify(resolveBuildVersion(mode)),
  },
  server: {
    host: '::',
    port: 3000, // Changed port to avoid conflicts
    hmr: {
      protocol: 'ws',
      host: 'localhost',
      port: 3000,
    },
  },
  plugins: [
    injectBuildVersion(resolveBuildVersion(mode)),
    react(),
    mode === 'production' &&
      visualizer({
        filename: './dist/stats.html',
        open: false,
        gzipSize: true,
        brotliSize: true,
      }),
  ].filter(Boolean),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Stub out Node.js modules for browser compatibility
      'node:async_hooks': path.resolve(__dirname, './src/lib/stubs/async-hooks.ts'),
    },
  },
  worker: {
    // Workers are created with { type: 'module' }. The Kokoro voice worker
    // (#2162) lazy-imports kokoro-js, which needs code-split (ES) output;
    // Vite's default 'iife' rejects that.
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['@langchain/langgraph', '@langchain/core', 'langsmith'],
    include: ['camelcase', 'decamelize', 'sanitize-html', 'howler', 'uuid'],
    esbuildOptions: {
      mainFields: ['module', 'main'],
    },
  },
  build: {
    manifest: true,
    minify: 'esbuild', // esbuild is faster and default for Vite
    cssCodeSplit: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        'blog-client': path.resolve(__dirname, 'src/blog-client.ts'),
        'landing-client': path.resolve(__dirname, 'src/landing-client.ts'),
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // React core — isolated chunk so vendor and react-query both
            // import React from here, eliminating cross-chunk init cycles
            // that otherwise leave React undefined when react-query evaluates.
            if (
              id.includes('node_modules/react/') ||
              id.includes('node_modules/react-dom/') ||
              id.includes('node_modules/scheduler/')
            ) {
              return 'react';
            }

            // 3D Graphics (~800KB) - standalone, no React deps
            if (id.includes('three') || id.includes('@react-three')) {
              return 'three';
            }

            // Audio - standalone
            if (id.includes('howler')) {
              return 'audio';
            }

            // AI SDKs - only loaded on game/AI pages
            if (
              id.includes('openai') ||
              id.includes('@anthropic-ai') ||
              id.includes('@google/generative-ai')
            ) {
              return 'ai-sdk';
            }

            // Animations - large, only needed when components mount
            if (id.includes('framer-motion')) {
              return 'animations';
            }

            // Supabase client - loaded on most pages but cacheable separately
            if (id.includes('@supabase')) {
              return 'supabase';
            }

            // Radix UI primitives - large set of components
            if (id.includes('@radix-ui')) {
              return 'radix-ui';
            }

            // Data fetching layer
            if (id.includes('@tanstack')) {
              return 'react-query';
            }

            return 'vendor';
          }
          return undefined;
        },
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
    chunkSizeWarningLimit: 1000,
  },
}));
