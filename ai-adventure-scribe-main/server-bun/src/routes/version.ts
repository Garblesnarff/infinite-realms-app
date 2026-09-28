import { Elysia } from 'elysia';

import { createVersionPayloadBuilder, type VersionSources } from '../lib/version-payload.js';
import { planRateLimit } from '../middleware/rate-limit.js';

/**
 * GET /version (#2293): the deployed commit, when it went live, and the client bundle being
 * served. No auth — Playtest opens it in a browser before turn 1, and ops/smoke.sh reads it right
 * after a deploy. `no-store` so a tester never compares against a cached answer. Public by
 * design, so it is listed in security-lint's PUBLIC_ROUTE_FILES; the default per-IP rate limit
 * still applies.
 */
export function createVersionRoutes(sources?: VersionSources) {
  const build = createVersionPayloadBuilder(sources);
  return new Elysia({ name: 'version-routes' }).use(planRateLimit('default')).get(
    '/version',
    ({ set }) => {
      set.headers['Cache-Control'] = 'no-store';
      return build();
    },
    { detail: { tags: ['Health'], description: 'Deployed commit and client bundle' } },
  );
}

export const versionRoutes = createVersionRoutes();
