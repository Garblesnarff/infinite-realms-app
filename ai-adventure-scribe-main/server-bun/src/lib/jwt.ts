/**
 * JWT Utilities
 *
 * Helper functions for JWT token extraction and parsing.
 * Ported from /server/src/lib/jwt.ts for Bun/Elysia compatibility.
 */

/**
 * Extract bearer token from Authorization header
 *
 * @param authHeader - The Authorization header value
 * @returns The token if present and valid, null otherwise
 *
 * @example
 * const token = getBearerToken('Bearer abc123');
 * // Returns: 'abc123'
 *
 * @example
 * const token = getBearerToken('Invalid header');
 * // Returns: null
 */
export function getBearerToken(authHeader?: string | null): string | null {
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}
