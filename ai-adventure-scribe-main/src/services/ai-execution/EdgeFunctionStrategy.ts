import type { AIExecutionStrategy } from './AIExecutionStrategy';

import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';

/**
 * Recursively converts Date objects to ISO strings for JSON serialization.
 * This prevents "[object Object]" serialization errors.
 */
function serializeDatesRecursively(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (obj instanceof Date) {
    return obj.toISOString();
  }

  if (Array.isArray(obj)) {
    return obj.map(serializeDatesRecursively);
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = serializeDatesRecursively(value);
    }
    return result;
  }

  return obj;
}

export class EdgeFunctionStrategy implements AIExecutionStrategy {
  readonly name = 'supabase-edge-function';
  readonly priority: number;

  constructor(priority: number = 10) {
    this.priority = priority;
  }

  canExecute(): boolean {
    return true;
  }

  async execute(functionName: string, payload?: Record<string, unknown>): Promise<any> {
    logger.debug(`[EdgeFunctionStrategy] Calling ${functionName}`, payload);

    // Serialize payload to handle Date objects and other non-JSON-safe values
    const serializedPayload = payload
      ? (serializeDatesRecursively(payload) as Record<string, unknown>)
      : undefined;

    const { data, error } = await supabase.functions.invoke(functionName, {
      body: serializedPayload,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (error) {
      logger.error(`[EdgeFunctionStrategy] ${functionName} failed`, error);
      throw error;
    }

    logger.debug(`[EdgeFunctionStrategy] ${functionName} response`, data);
    return data;
  }
}
