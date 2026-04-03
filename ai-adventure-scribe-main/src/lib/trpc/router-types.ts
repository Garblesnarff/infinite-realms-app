/**
 * AppRouter type — sourced from the real backend tRPC router.
 *
 * Re-exports the actual AppRouter type from server-bun so all frontend
 * tRPC calls are fully type-safe end-to-end.
 */
export type { AppRouter } from '../../../server-bun/src/trpc/root';
