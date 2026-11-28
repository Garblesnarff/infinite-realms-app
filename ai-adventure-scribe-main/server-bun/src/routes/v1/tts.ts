import { Elysia, t } from 'elysia';

import { VOICE_REQUEST_TEXT_MAX } from '../../../../shared/voice-request.js';
import { logger } from '../../lib/logger.js';
import { resolveUserPlanStrict } from '../../lib/user-plan.js';
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
  // The client splits longer text into requests of this size (#1348).
  text: t.String({ minLength: 1, maxLength: VOICE_REQUEST_TEXT_MAX }),
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
    | 'assertUsageStoreAvailable'
    | 'checkQuotaAndConsume'
    | 'getQuotaStatus'
    | 'recordProviderUsage'
    | 'refundQuota'
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
          // Fail-fast read before the provider call. The atomic reserve below
          // is the gate: the pre-check alone cannot stop a parallel request
          // (#1789).
          const units = voiceQuotaUnits(characters);
          // #1344: the plan on the request is lenient (authenticateRequest fails open
          // to 'free'). Resolve strictly once, before any quota check or charge: a DB
          // blip is a 503, never a 429/402 against the free limit for a paying player,
          // and never a usage row under plan='free'.
          let plan: string;
          try {
            plan = await resolveUserPlanStrict(user.userId);
          } catch (err) {
            logger.error({ msg: 'TTS_PLAN_LOOKUP_ERROR', error: err });
            set.status = 503;
            return { error: 'Plan lookup unavailable' };
          }
          await usageService.assertUsageStoreAvailable();
          const quota = await usageService.getQuotaStatus({
            userId: user.userId,
            plan,
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

          // #1789: reserve the charge BEFORE the provider call. Two parallel
          // requests can both pass the getQuotaStatus read above, both reach
          // ElevenLabs, and both incur provider cost. checkQuotaAndConsume is
          // the atomic gate (advisory lock + guarded insert in the service):
          // the request that loses the race is refused here, before any
          // provider call. A throw here is ambiguous — the consume may have
          // committed with a lost ack (see memory-extraction-job.ts) — so it
          // is logged for reconciliation and rethrown to 503 (http-pipeline)
          // with no refund and no retry: blindly refunding could grant free
          // units.
          let reservation;
          try {
            reservation = await usageService.checkQuotaAndConsume({
              userId: user.userId,
              plan,
              type: 'voice',
              units,
            });
          } catch (error) {
            logger.error({
              msg: 'TTS_VOICE_RESERVE_AMBIGUOUS',
              error: error instanceof Error ? error.message : error,
              userId: user.userId,
              units,
            });
            throw error;
          }
          if (!reservation.allowed) {
            set.status = 429;
            return { error: 'Voice quota exceeded' };
          }

          // Give the reservation back when the provider call fails, so the
          // user is not charged for a clip that never arrived. A refund
          // failure is logged, never fatal: the response is already degraded
          // (#350 pattern in llm.ts). The guard makes the release at-most-once
          // even if a future edit adds a second call site.
          let released = false;
          const releaseReservation = async (): Promise<void> => {
            if (released) return;
            released = true;
            try {
              await usageService.refundQuota({
                userId: user.userId,
                plan,
                type: 'voice',
                units,
              });
            } catch (error) {
              logger.error({
                msg: 'TTS_VOICE_REFUND_FAILED',
                error: error instanceof Error ? error.message : error,
                userId: user.userId,
              });
            }
          };

          // One upstream call per voice id attempted (a 404 retries once
          // with the fallback id, below). The fetch boundary is injectable
          // (options.fetchImpl) so tests stub the provider without a live call.
          const synthesize = (voiceId: string): Promise<Response> =>
            (options.fetchImpl ?? globalThis.fetch)(
              `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream`,
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
          const fetchFailed = async (
            error: unknown,
            voiceId: string,
          ): Promise<{ error: string }> => {
            // #1789: the provider call never ran, so the reservation goes back.
            await releaseReservation();
            // #1348: the proxy never logged provider failures, so a run of
            // 502s could not be told apart from a quota or a bad voice.
            logger.error({
              msg: 'TTS_UPSTREAM_FETCH_ERROR',
              error: error instanceof Error ? error.message : error,
              userId: user.userId,
              voiceId,
            });
            set.status = 503;
            return { error: 'Voice service unavailable' };
          };

          let attemptedVoiceId = params.voiceId;
          let upstream: Response;
          try {
            upstream = await synthesize(params.voiceId);
          } catch (error) {
            return fetchFailed(error, params.voiceId);
          }

          // #1406: an upstream 404 means the voice id is not on the
          // account's ElevenLabs "My Voices" list, so the server answers
          // 502 and the client falls back to Standard silently. Log the id
          // so the next run is visible, and retry once with the fallback
          // voice when one is configured (and different from the requested
          // id — retrying the same id would repeat the same 404).
          if (upstream.status === 404) {
            logger.error({
              msg: 'TTS_VOICE_NOT_FOUND',
              upstreamStatus: upstream.status,
              userId: user.userId,
              voiceId: params.voiceId,
            });
            const fallbackVoiceId = process.env.ELEVENLABS_FALLBACK_VOICE_ID?.trim();
            if (fallbackVoiceId && fallbackVoiceId !== params.voiceId) {
              attemptedVoiceId = fallbackVoiceId;
              try {
                upstream = await synthesize(fallbackVoiceId);
              } catch (error) {
                return fetchFailed(error, fallbackVoiceId);
              }
              if (upstream.status === 404) {
                logger.error({
                  msg: 'TTS_VOICE_NOT_FOUND',
                  upstreamStatus: upstream.status,
                  userId: user.userId,
                  voiceId: fallbackVoiceId,
                });
              }
            }
          }

          if (!upstream.ok) {
            // #1789: no usable clip, so the reservation goes back.
            await releaseReservation();
            // Upstream 5xx maps to 503, anything else below 500 to 502; log
            // the upstream status either way so the next run of failures
            // says whether it was quota (402), auth (401) or a voice (422).
            const status = upstream.status >= 500 ? 503 : 502;
            logger.error({
              msg: 'TTS_UPSTREAM_ERROR',
              upstreamStatus: upstream.status,
              status,
              userId: user.userId,
              voiceId: attemptedVoiceId,
            });
            set.status = status;
            return { error: 'Voice request failed' };
          }

          // The clip is usable: the reservation made before the provider call
          // stands as the charge (#1789). Nothing more to consume here.

          // Recording is not part of the provider try. A thrown insert must not
          // turn a successful ElevenLabs response into a 503.
          try {
            await usageService.recordProviderUsage({
              userId: user.userId,
              plan,
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
