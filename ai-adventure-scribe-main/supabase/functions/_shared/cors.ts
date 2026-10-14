/**
 * Shared CORS configuration for Deno edge functions.
 *
 * Headers include every value used by any function so that a single
 * import covers clone-template and other functions.
 */

export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': 'https://infiniterealms.app',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-request-id, x-release, x-environment',
};

/**
 * Return a preflight response for OPTIONS requests, or null for all
 * other methods so the caller can continue with normal handling.
 */
export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  return null;
}
