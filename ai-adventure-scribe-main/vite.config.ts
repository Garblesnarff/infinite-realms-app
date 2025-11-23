import path from "path";

import react from "@vitejs/plugin-react-swc";
import { componentTagger } from "lovable-tagger";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
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
    mode === 'production' && visualizer({
      filename: './dist/stats.html',
      open: false,
      gzipSize: true,
      brotliSize: true,
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Stub out Node.js modules for browser compatibility
      "node:async_hooks": path.resolve(__dirname, "./src/lib/stubs/async-hooks.ts"),
    },
  },
  optimizeDeps: {
    exclude: ['@langchain/langgraph', '@langchain/core', 'langsmith'],
    include: [
      'camelcase',
      'decamelize',
      'p-queue',
      'p-retry',
      'sanitize-html',
      'howler',
      'uuid'
    ],
    esbuildOptions: {
      mainFields: ['module', 'main'],
    }
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
      },
      output: {
        manualChunks(id) {
          // Only split out the largest dependencies to keep chunks manageable
          if (id.includes('node_modules')) {
            // 3D Graphics (very large - ~700KB) - safe to split as it has no React deps
            if (id.includes('three')) {
              return 'three';
            }

            // Audio libraries - safe to split as standalone
            if (id.includes('howler')) {
              return 'audio';
            }

            // Everything else stays together to avoid dependency issues
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
