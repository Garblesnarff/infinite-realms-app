import { Elysia, t } from 'elysia';

import { NotFoundError } from '../../lib/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { planRateLimit } from '../../middleware/rate-limit.js';
import { AIUsageService } from '../../services/ai-usage-service.js';
import { startMemoryExtractionJob } from '../../services/memory-extraction-job.js';
import { SessionService } from '../../services/session-service.js';

/**
 * Largest prompt accepted (#2186). The largest the client builds:
 * - memories: ~1.1k template + player input (≤ 20k, the /v1/llm player_input cap) + one DM
 *   reply (≤ 8192 tokens, ~33k chars), so ≤ ~54k.
 * - summary: the client trims its transcript to SUMMARY_TRANSCRIPT_MAX_CHARS (70k) in
 *   world-update-processor.ts, plus a ~200-char instruction.
 * 80k leaves headroom over both. Keep the client budget below it.
 */
export const MEMORY_EXTRACTION_PROMPT_MAX_CHARS = 80_000;

/**
 * POST /v1/memory-extraction/jobs — accept a memory extraction and return 202 at once (#2148).
 *
 * Replaces the browser's wait on /v1/llm/extract, which could never succeed in production: the
 * browser aborted at 10 s and the model took 13–44 s. Here the server owns the whole job and
 * writes the memories itself when the model finishes; see services/memory-extraction-job.ts.
 *
 * Everything that can be refused is refused before the 202 — auth, session ownership, quota —
 * so an accepted job only fails on the model or the write, and both are logged by job id.
 *
 * The per-minute limit is the same 'llm' bucket /v1/llm/extract sat behind, and the bucket is
 * shared with it: a burst of extractions and chat turns draw on one budget, as before (#2186).
 * requireAuth comes first so the limiter sees the user and applies the per-user, per-plan limit.
 */
export const memoryExtractionRoutes = new Elysia({ prefix: '/v1/memory-extraction' })
  .use(requireAuth)
  .use(planRateLimit('llm'))
  .post(
    '/jobs',
    async ({ body, user, set }) => {
      // The campaign is taken from the session row rather than the request so a job cannot be
      // pointed at someone else's campaign.
      let session: Awaited<ReturnType<typeof SessionService.getSessionById>>;
      try {
        session = await SessionService.getSessionById(body.session_id, user!.userId);
      } catch (error) {
        if (!(error instanceof NotFoundError)) throw error;
        set.status = 404;
        return { error: 'Session not found' };
      }

      // System quota, as /v1/llm/extract used: extraction does not count against chat quota.
      const quota = await AIUsageService.checkQuotaAndConsume({
        userId: user!.userId,
        plan: user!.plan ?? 'free',
        type: 'llm_system',
        units: 1,
      });
      if (!quota.allowed) {
        set.status = 402;
        return { error: 'AI quota exceeded', resetAt: quota.resetAt };
      }

      const { jobId } = startMemoryExtractionJob({
        userId: user!.userId,
        plan: user!.plan ?? 'free',
        sessionId: session.id,
        campaignId: session.campaignId ?? undefined,
        characterId: body.character_id,
        kind: body.kind,
        prompt: body.prompt,
        maxTokens: body.max_tokens ?? (body.kind === 'summary' ? 1200 : 1000),
        turn: body.turn,
      });

      set.status = 202;
      return { jobId, status: 'accepted' as const };
    },
    {
      body: t.Object({
        session_id: t.String({ format: 'uuid' }),
        character_id: t.Optional(t.String()),
        kind: t.Union([t.Literal('memories'), t.Literal('summary')]),
        prompt: t.String({ minLength: 1, maxLength: MEMORY_EXTRACTION_PROMPT_MAX_CHARS }),
        max_tokens: t.Optional(t.Number({ minimum: 1, maximum: 2000 })),
        turn: t.Optional(t.Number({ minimum: 0 })),
      }),
    },
  );
