import crypto from 'crypto';
import { supabaseService } from '../lib/supabase.js';
import type { Request, Response, NextFunction } from 'express';

export interface ApiKeyPayload {
  keyId: string;
  name: string;
  permissions: string[];
}

declare global {
  namespace Express {
    interface Request {
      apiKey?: ApiKeyPayload;
    }
  }
}

/**
 * Middleware to verify API keys for internal/automated endpoints.
 * Expects header: Authorization: Bearer <api-key>
 *
 * Keys are stored hashed in blog_api_keys table.
 */
export async function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid API key' });
  }

  const apiKey = authHeader.slice(7);

  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
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
      console.error('API key lookup error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (!data) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    if (data.disabled) {
      return res.status(401).json({ error: 'API key is disabled' });
    }

    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      return res.status(401).json({ error: 'API key has expired' });
    }

    req.apiKey = {
      keyId: data.id,
      name: data.name,
      permissions: data.permissions || [],
    };

    next();
  } catch (err) {
    console.error('API key verification error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Check if API key has a specific permission
 */
export function hasPermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.apiKey) {
      return res.status(401).json({ error: 'API key required' });
    }

    if (!req.apiKey.permissions.includes(permission) && !req.apiKey.permissions.includes('*')) {
      return res.status(403).json({ error: `Missing permission: ${permission}` });
    }

    next();
  };
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
