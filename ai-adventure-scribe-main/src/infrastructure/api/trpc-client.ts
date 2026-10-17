/**
 * tRPC Client Configuration
 *
 * This file initializes the tRPC React client with type safety from the backend.
 * It provides the base configuration for making type-safe API calls.
 *
 * @module infrastructure/api/trpc-client
 */

import { createTRPCReact } from '@trpc/react-query';

import type { AppRouter } from './trpc-types';

/**
 * Type-safe tRPC React client
 *
 * This client provides hooks like:
 * - trpc.chronicles.getBySessionId.useQuery()
 * - trpc.chronicles.generate.useMutation()
 *
 * The types are inferred from the backend AppRouter, ensuring
 * compile-time safety for all API calls.
 *
 * @example
 * ```tsx
 * import { trpc } from '@/infrastructure/api';
 *
 * function MyComponent() {
 *   const { data, isLoading } = trpc.chronicles.getBySessionId.useQuery({ sessionId });
 *   return <div>{data?.title}</div>;
 * }
 * ```
 */
export const trpc = createTRPCReact<AppRouter>();
