/**
 * API Key Middleware for Elysia
 *
 * Provides API key authentication for internal/automated endpoints.
 * Keys are stored hashed in blog_api_keys table.
 *
 * Ported from /server/src/middleware/api-key.ts
 */

import { Elysia } from 'elysia';
import crypto from 'crypto';
import { supabaseService } from '../lib/supabase.js';
import { logger } from '../lib/logger.js';

export interface ApiKeyPayload {
  keyId: string;
  name: string;
  permissions: string[];
}

/**
 * Verify API key from Authorization header
 */
async function verifyApiKey(authHeader: string | null): Promise<ApiKeyPayload | null> {
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  const apiKey = authHeader.slice(7);
  if (!apiKey) {
    return null;
  }

  try {
    // Hash the provided key to compare with stored hash
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

    const { data, error } = await supabaseService
      .from('blog_api_keys')
      .select('id, name, permissions, expires_at, disabled')
      .eq('key_hash', keyHash)
      .maybeSingle();

    if (error) {
      logger.error({ msg: 'API key lookup error', error });
      return null;
    }

    if (!data) {
      return null;
    }

    if (data.disabled) {
      return null;
    }

    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return null;
    }

    return {
      keyId: data.id,
      name: data.name,
      permissions: data.permissions || [],
    };
  } catch (err) {
    logger.error({ msg: 'API key verification error', error: err });
    return null;
  }
}

/**
 * Required API key plugin
 * Returns 401 if API key is missing or invalid
 */
export const requireApiKey = new Elysia({ name: 'require-api-key' })
  .derive(async ({ request, set }) => {
    const authHeader = request.headers.get('authorization');
    const apiKey = await verifyApiKey(authHeader);

    if (!apiKey) {
      set.status = 401;
      return {
        apiKey: null,
        error: { error: 'Missing or invalid API key' },
      };
    }

    return { apiKey, error: null };
  })
  .onBeforeHandle(({ apiKey, error, set }) => {
    if (error) {
      set.status = 401;
      return error;
    }
  });

/**
 * Check if API key has a specific permission
 */
export function hasPermission(permission: string) {
  return new Elysia({ name: `has-permission-${permission}` })
    .onBeforeHandle(({ apiKey, set }) => {
      if (!apiKey) {
        set.status = 401;
        return { error: 'Unauthorized' };
      }

      if (!apiKey.permissions.includes(permission) && !apiKey.permissions.includes('*')) {
        set.status = 403;
        return { error: 'Forbidden' };
      }
    });
}

/**
 * Generate a new API key (returns the raw key - store this securely!)
 */
export function generateApiKey(): { key: string; hash: string } {
  // Generate a secure random key with prefix for identification
  const rawKey = `ir_blog_${crypto.randomBytes(32).toString('base64url')}`;
  const hash = crypto.createHash('sha256').update(rawKey).digest('hex');
  return { key: rawKey, hash };
}
