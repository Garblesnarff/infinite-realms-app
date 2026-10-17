/**
 * tRPC Convenience Hooks and Utilities
 *
 * This file exports typed hooks and utilities for making tRPC calls.
 * All exports are fully type-safe based on the backend AppRouter.
 *
 * @module infrastructure/api/trpc-hooks
 */

import { trpc } from './trpc-client';

/**
 * Export the main tRPC client for use in components
 *
 * @example
 * ```tsx
 * import { useTRPC } from '@/infrastructure/api';
 *
 * function BlogList() {
 *   const { data, isLoading } = useTRPC().chronicles.getBySessionId.useQuery({ sessionId });
 *   // ...
 * }
 * ```
 */
export const useTRPC = () => trpc;

/**
 * Export tRPC utils for direct API calls and cache manipulation
 *
 * @example
 * ```tsx
 * import { useTRPCUtils } from '@/infrastructure/api';
 *
 * function MyComponent() {
 *   const utils = useTRPCUtils();
 *
 *   const handleRefresh = () => {
 *     // Invalidate cache to refetch
 *     utils.chronicles.getBySessionId.invalidate();
 *   };
 *
 *   const handleOptimisticUpdate = async (newPost) => {
 *     // Optimistically update cache
 *     await utils.chronicles.getBySessionId.cancel();
 *     utils.chronicles.getBySessionId.setData(undefined, (old) => old);
 *   };
 * }
 * ```
 */
export const useTRPCUtils = () => trpc.useUtils();

/**
 * Type-safe wrapper for queries
 * Provides additional utilities and consistent error handling
 *
 * @example
 * ```tsx
 * import { useQuery } from '@/infrastructure/api';
 *
 * function BlogPost({ id }: { id: string }) {
 *   const { data, error, isLoading } = useQuery(
 *     ['chronicles.getBySessionId', { sessionId }],
 *     () => trpc.chronicles.getBySessionId.query({ sessionId })
 *   );
 * }
 * ```
 */
export { useQuery, useMutation } from '@tanstack/react-query';

/**
 * Re-export the trpc client for direct access
 * Use this for component-level queries and mutations
 */
export { trpc };
