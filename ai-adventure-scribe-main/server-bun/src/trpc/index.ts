/**
 * tRPC Public Exports for Elysia/Bun
 *
 * This file re-exports the tRPC router and types from the existing
 * Express server implementation. The routers themselves are framework-agnostic,
 * so we can reuse them by just changing the adapter layer.
 *
 * The appRouter is imported from /server/src/trpc/root.ts
 * Context creation is handled separately in ./context.ts for Elysia compatibility.
 *
 * Note: Bun can import TypeScript files directly, so we use .ts extension
 */

// Re-export the app router from the existing Express implementation
// The routers are framework-agnostic and work with any tRPC adapter
export { appRouter } from '../../../server/src/trpc/root.ts';
export type { AppRouter } from '../../../server/src/trpc/root.ts';

// Export Elysia-specific context creation
export { createContext } from './context.js';
export type { Context, AuthUser } from './context.js';
