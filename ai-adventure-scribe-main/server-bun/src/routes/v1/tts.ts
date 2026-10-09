import { Elysia, t } from 'elysia';

import { logger } from '../../lib/logger.js';
import { requireAuth } from '../../middleware/auth.js';
import { planRateLimit } from '../../middleware/rate-limit.js';
import {
  AIUsageService,
  elevenLabsCharacterCostUsd,
  voiceQuotaUnits,
} from '../../services/ai-usage-service.js';

const VOICE_TIMEOUT_MS = 120_000;
const DEFAULT_ELEVENLABS_MODEL = 'eleven_flash_v2_5';

type TtsFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

const ttsRequestSchema = t.Object({
  text: t.String({ minLength: 1, maxLength: 5000 }),
  // Absent for voices that are not tied to a game session (previews, tools).
  sessionId: t.Optional(t.String({ maxLength: 255 })),
  // Accepted so existing clients keep validating; the server pins the model (#2158).
  model_id: t.Optional(t.String({ maxLength: 100 })),
  voice_settings: t.Optional(
    t.Object({
      stability: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
      similarity_boost: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
      style: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
      use_speaker_boost: t.Optional(t.Boolean()),
    }),
  ),
});

export interface TtsRouteOptions {
  auth?: typeof requireAuth;
  rateLimit?: ReturnType<typeof planRateLimit>;
  usageService?: Pick<
    typeof AIUsageService,
    'checkQuotaAndConsume' | 'getQuotaStatus' | 'recordProviderUsage'
  >;
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
          const characters = body.text.length;
          const { sessionId, model_id: _clientModelId, ...providerBody } = body;
          const modelId = process.env.ELEVENLABS_MODEL?.trim() || DEFAULT_ELEVENLABS_MODEL;
          // Check before the provider call. The charge happens after a usable clip (#2676).
          const units = voiceQuotaUnits(characters);
          const quota = await usageService.getQuotaStatus({
            userId: user.userId,
            plan: user.plan || 'free',
            type: 'voice',
          });
          if (quota.remaining < units) {
            set.status = 429;
            return { error: 'Voice quota exceeded' };
          }

          const apiKey = process.env.ELEVENLABS_API_KEY || process.env.ELEVEN_LABS_API_KEY;
          if (!apiKey) {
            set.status = 503;
            return { error: 'Voice service unavailable' };
          }

          let upstream: Response;
          try {
            upstream = await (options.fetchImpl ?? globalThis.fetch)(
              `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(params.voiceId)}/stream`,
              {
                method: 'POST',
                headers: {
                  Accept: 'audio/mpeg',
                  'Content-Type': 'application/json',
                  'xi-api-key': apiKey,
                },
                signal: AbortSignal.timeout(VOICE_TIMEOUT_MS),
                body: JSON.stringify({ ...providerBody, model_id: modelId }),
              },
            );
          } catch {
            set.status = 503;
            return { error: 'Voice service unavailable' };
          }

          if (!upstream.ok) {
            set.status = upstream.status >= 500 ? 503 : 502;
            return { error: 'Voice request failed' };
          }

          // The clip is usable: charge it now. A second call at limit-1 can pass the check above
          // and still reach the provider; if its charge is refused, that clip is not billed.
          await usageService.checkQuotaAndConsume({
            userId: user.userId,
            plan: user.plan || 'free',
            type: 'voice',
            units,
          });

          // Recording is not part of the provider try. A thrown insert must not
          // turn a successful ElevenLabs response into a 503.
          try {
            await usageService.recordProviderUsage({
              userId: user.userId,
              plan: user.plan || 'free',
              type: 'voice',
              provider: 'elevenlabs',
              model: modelId,
              inputTokens: characters,
              outputTokens: 0,
              costUsd: elevenLabsCharacterCostUsd(characters),
              sessionId,
            });
          } catch (error) {
            logger.warn({
              msg: 'TTS_USAGE_RECORD_FAILED',
              error: error instanceof Error ? error.message : error,
              userId: user.userId,
            });
          }

          return new Response(upstream.body, {
            status: 200,
            headers: {
              'Content-Type': upstream.headers.get('content-type') || 'audio/mpeg',
              'Cache-Control': 'private, max-age=3600',
            },
          });
        },
        { body: ttsRequestSchema },
      )
  );
}

export const ttsRoutes = createTtsRoutes();
