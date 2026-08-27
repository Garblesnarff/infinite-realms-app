import { Elysia, t } from 'elysia';

import { requireAuth } from '../../middleware/auth.js';
import { planRateLimit } from '../../middleware/rate-limit.js';
import { AIUsageService } from '../../services/ai-usage-service.js';

const VOICE_TIMEOUT_MS = 120_000;

type TtsFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

const ttsRequestSchema = t.Object({
  text: t.String({ minLength: 1, maxLength: 5000 }),
  model_id: t.Optional(t.String()),
  voice_settings: t.Optional(t.Record(t.String(), t.Number())),
});

export interface TtsRouteOptions {
  auth?: typeof requireAuth;
  rateLimit?: ReturnType<typeof planRateLimit>;
  usageService?: Pick<typeof AIUsageService, 'checkQuotaAndConsume'>;
  fetchImpl?: TtsFetch;
}

/**
 * Authenticated ElevenLabs proxy.
 *
 * The browser sends only the user's access token and synthesis parameters.
 * The provider credential is read from the Bun process environment and never
 * crosses the HTTP boundary to the client.
 */
export function createTtsRoutes(options: TtsRouteOptions = {}) {
  const auth = options.auth ?? requireAuth;
  const rateLimit = options.rateLimit ?? planRateLimit('voice');
  const usageService = options.usageService ?? AIUsageService;

  return (
    new Elysia({ prefix: '/v1/ai-proxy' })
      // Auth must run before the limiter so planRateLimit can use the user bucket.
      .use(auth)
      .use(rateLimit)
      .post(
        '/voice/:voiceId',
        async ({ params, body, set, user }) => {
          const quota = await usageService.checkQuotaAndConsume({
            userId: user.userId,
            plan: user.plan || 'free',
            type: 'voice',
          });
          if (!quota.allowed) {
            set.status = 429;
            return { error: 'Voice quota exceeded' };
          }

          const apiKey = process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY;
          if (!apiKey) {
            set.status = 503;
            return { error: 'Voice service unavailable' };
          }

          try {
            const response = await (options.fetchImpl ?? globalThis.fetch)(
              `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(params.voiceId)}/stream`,
              {
                method: 'POST',
                headers: {
                  Accept: 'audio/mpeg',
                  'Content-Type': 'application/json',
                  'xi-api-key': apiKey,
                },
                signal: AbortSignal.timeout(VOICE_TIMEOUT_MS),
                body: JSON.stringify(body),
              },
            );

            if (!response.ok) {
              set.status = response.status >= 500 ? 503 : 502;
              return { error: 'Voice request failed' };
            }

            return new Response(response.body, {
              status: 200,
              headers: {
                'Content-Type': response.headers.get('content-type') || 'audio/mpeg',
                'Cache-Control': 'private, max-age=3600',
              },
            });
          } catch {
            set.status = 503;
            return { error: 'Voice service unavailable' };
          }
        },
        { body: ttsRequestSchema },
      )
  );
}

export const ttsRoutes = createTtsRoutes();
