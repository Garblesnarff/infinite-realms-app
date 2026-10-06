import { Elysia } from 'elysia';

import { createVersionPayloadBuilder, type VersionSources } from '../lib/version-payload.js';
import { planRateLimit } from '../middleware/rate-limit.js';

/**
 * Does this request ask for plain text? An explicit `?format=text` always wins; otherwise the
 * Accept header has to actually *prefer* text/plain over every other type it names. A browser
 * sends text/html first, so the default stays JSON for anything a person opens in a browser
 * (#2583).
 */
function wantsTextPlain(request: Request): boolean {
  const url = new URL(request.url);
  if (url.searchParams.get('format') === 'text') return true;

  const accept = request.headers.get('accept') ?? '';
  if (!accept) return false;

  /** Best qvalue the header gives a media range, or null when it never names it. */
  const quality = (type: string): number | null => {
    let best: number | null = null;
    for (const part of accept.split(',')) {
      const [rawType, ...params] = part.trim().split(';');
      if (rawType?.trim().toLowerCase() !== type) continue;
      const q = params
        .map((param) => param.trim().match(/^q\s*=\s*([\d.]+)$/i)?.[1])
        .find((value) => value !== undefined);
      const parsed = q === undefined ? 1 : Number.parseFloat(q);
      best = best === null ? parsed : Math.max(best, parsed);
    }
    return best;
  };

  const textPlain = quality('text/plain');
  if (textPlain === null || textPlain <= 0) return false;

  // Any type the client names on its own, at equal or better quality, outranks text/plain. A
  // bare wildcard is not such a type: RFC 7231 gives the more specific `text/plain` precedence
  // over `*/*`, which is what curl, fetch and ops/smoke.sh all send — they keep getting JSON
  // because they never name text/plain at all.
  return ['text/html', 'application/json', 'application/xhtml+xml'].every((other) => {
    const q = quality(other);
    return q === null || q < textPlain;
  });
}

/**
 * GET /version (#2293): the deployed commit, when it went live, and the client bundle being
 * served. No auth — Playtest opens it in a browser before turn 1, and ops/smoke.sh reads it right
 * after a deploy. `no-store` so a tester never compares against a cached answer. Public by
 * design, so it is listed in security-lint's PUBLIC_ROUTE_FILES; the default per-IP rate limit
 * still applies.
 *
 * `?format=text`, or an Accept header that prefers text/plain, answers with the one line a
 * build gate needs — "<full sha> <bundle filename>" — as text/plain (#2583). This route is served
 * by the API host only: https://api.infiniterealms.app/version?format=text works. On the app host
 * https://infiniterealms.app/version nginx falls through to the SPA shell (no `location` for it),
 * which is the page run D6 saw; that needs a prod nginx change, not this route. Browsers keep the
 * JSON payload.
 */
export function createVersionRoutes(sources?: VersionSources) {
  const build = createVersionPayloadBuilder(sources);
  return new Elysia({ name: 'version-routes' }).use(planRateLimit('default')).get(
    '/version',
    ({ request, set }) => {
      set.headers['Cache-Control'] = 'no-store';

      const payload = build();
      if (wantsTextPlain(request)) {
        set.headers['content-type'] = 'text/plain; charset=utf-8';
        return `${payload.commit} ${payload.bundle ?? 'unknown'}`;
      }
      return payload;
    },
    { detail: { tags: ['Health'], description: 'Deployed commit and client bundle' } },
  );
}

export const versionRoutes = createVersionRoutes();
