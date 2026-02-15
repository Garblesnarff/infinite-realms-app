/**
 * API Infrastructure Layer
 *
 * Central export point for all API client configurations.
 * Provides type-safe clients for tRPC and REST services.
 *
 * @module infrastructure/api
 */

// tRPC exports
export { trpc } from './trpc-client';
export { TRPCProvider } from './trpc-provider';
export { useTRPC, useTRPCUtils, useQuery, useMutation } from './trpc-hooks';

// REST API exports
export { llmApiClient } from './rest-client';

// Type exports
export type * from './types';
