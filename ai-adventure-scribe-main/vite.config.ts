import path from 'path';

import react from '@vitejs/plugin-react-swc';
import { componentTagger } from 'lovable-tagger';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig } from 'vite';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
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
    react(),
    mode === 'development' && process.env.ENABLE_COMPONENT_TAGGER === 'true'
      ? componentTagger()
      : null,
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
  optimizeDeps: {
    exclude: ['@langchain/langgraph', '@langchain/core', 'langsmith'],
    include: ['camelcase', 'decamelize', 'p-queue', 'p-retry', 'sanitize-html', 'howler', 'uuid'],
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
