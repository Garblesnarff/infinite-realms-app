/**
 * LLM Routes for Elysia
 *
 * Provides LLM generation API endpoints:
 * - GET /v1/llm/quota - Get current quota status
 * - POST /v1/llm/generate - Generate text via OpenRouter or Gemini
 *
 * Ported from /server/src/routes/v1/llm.ts
 */

import { Elysia, t } from 'elysia';

import { alert } from '../../lib/alerting.js';
import { authenticateRequest, type AuthUser } from '../../lib/auth.js';
import { logger } from '../../lib/logger.js';
import { isAdmin } from '../../middleware/admin.js';
import { planRateLimit } from '../../middleware/rate-limit.js';
import { AIUsageService, type UsageType } from '../../services/ai-usage-service.js';
import {
  COMBAT_INTENT_VERBS,
  detectDeclaredAttack,
} from '../../services/combat/combat-intent-gate.js';
import { loadCombatIntentActorRoster } from '../../services/combat/combat-intent-roster.js';
import {
  applyCombatEntryGate,
  stripUntargetedInitiativeRollRequests,
  type CombatEntryContext,
} from '../../services/combat-entry-pipeline.js';
import { enforceCombatTransitionContract } from '../../services/combat-transition-enforcement.js';
import {
  parseLlmEnvelope,
  rewriteNarrationSegmentsFromEnvelope,
} from '../../services/dm/dm-response-schema.js';
import { LLMProviderService } from '../../services/llm-provider-service.js';

/**
 * Log the SHAPE of the model envelope on /v1/llm/generate — never its content.
 *
 * Issue #2022 asked a simple question about a live turn ("did the model return
 * combat_actions?") and it was unanswerable: the envelope is not persisted
 * anywhere. `dialogue_history` has no DM row when the turn dead-ends, `ai_usage`
 * stores only token counts, and no column holds the completion. This line makes
 * the next occurrence answerable from the log alone.
 *
 * Keys and array lengths only. No narration, no player input, no option text —
 * nothing that could put player prose or model prose into the log.
 *
 * Note on interpretation: this reflects the envelope AFTER
 * stripUntargetedInitiativeRollRequests and applyCombatEntryGate have run, so
 * `rollRequests` may be lower than what the model emitted. `combatActions` is
 * untouched by both, so it does answer #2022's question directly.
 */
function logEnvelopeShape(
  envelope: Record<string, unknown> | null,
  text: string,
  sessionId: string | undefined,
  degraded = false,
): void {
  // textLength distinguishes an empty completion from non-JSON prose: a
  // `parsed: false` line alone cannot, which cost a diagnosis on #2049 where a
  // 966ms 200 turned out to be an unparseable body. Length only, never text.
  const textLength = typeof text === 'string' ? text.length : 0;
  if (!envelope) {
    logger.info({
      msg: 'LLM_GENERATE_ENVELOPE_SHAPE',
      sessionId,
      parsed: false,
      textLength,
      ...(degraded ? { degraded: true } : {}),
    });
    return;
  }
  const len = (v: unknown): number | null => (Array.isArray(v) ? v.length : null);
  logger.info({
    msg: 'LLM_GENERATE_ENVELOPE_SHAPE',
    sessionId,
    parsed: true,
    textLength,
    keys: Object.keys(envelope).sort(),
    combatActions: len(envelope.combat_actions),
    rollRequests: len(envelope.roll_requests),
  });
}

const MEMORY_EXTRACTION_DEGRADED_REASON = 'memory_extraction_unavailable';
const LLM_GENERATE_DEGRADED_REASON = 'llm_generate_unavailable';
const LLM_GENERATE_DEGRADED_TEXT =
  'The Dungeon Master pauses. The storyteller service did not answer; try your action again.';

const degradedGenerateEnvelope = (): {
  parsed: false;
  degraded: true;
  reason: string;
  text: string;
} => ({
  parsed: false as const,
  degraded: true as const,
  reason: LLM_GENERATE_DEGRADED_REASON,
  text: LLM_GENERATE_DEGRADED_TEXT,
});

const extractPlayerInputFromPrompt = (prompt: string): string | undefined => {
  const match = /<player_input>\s*([\s\S]*?)\s*<\/player_input>\s*$/i.exec(prompt);
  const playerInput = match?.[1]?.trim();
  return playerInput || undefined;
};

const COMBAT_INTENT_IDIOMS = ['take a swing', 'swing at', 'go for'] as const;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const combatIntentPrefilter = new RegExp(
  [...COMBAT_INTENT_VERBS, ...COMBAT_INTENT_IDIOMS]
    .sort((left, right) => right.length - left.length)
    .map(
      (term) =>
        `\\b${term
          .split(/\s+/)
          .map((word) => escapeRegExp(word))
          .join('\\s+')}\\b`,
    )
    .join('|'),
  'i',
);

const looksLikeCombatIntent = (playerInput: string): boolean =>
  combatIntentPrefilter.test(playerInput);

const escapeXmlAttribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const appendDeclaredAttackDirective = (prompt: string, actorName: string): string => {
  const escapedActor = escapeXmlAttribute(actorName);
  return `${prompt}\n\n<declared_attack actor="${escapedActor}">The player has declared an attack on ${escapedActor}. Do NOT resolve it. Emit combat_transition:'start' with ${escapedActor} in combatants and narrate only the wind-up.</declared_attack>`;
};

export const llmRoutes = new Elysia({ prefix: '/v1/llm' })
  .use(planRateLimit('llm'))

  /**
   * Get current quota status
   * GET /v1/llm/quota
   */
  .get('/quota', async ({ request, set }) => {
    // Direct auth check - bypasses Elysia plugin context issues
    const { user, error } = await authenticateRequest(request);
    if (error || !user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }

    try {
      const quotaStatus = await AIUsageService.getQuotaStatus({
        userId: user.userId,
        plan: user.plan,
        type: 'llm',
      });
      return quotaStatus;
    } catch (err) {
      logger.error({ msg: 'LLM_QUOTA_ERROR', error: err });
      set.status = 500;
      return { error: 'Failed to fetch quota status' };
    }
  })

  /**
   * Generate text via LLM
   * POST /v1/llm/generate
   */
  .post(
    '/generate',
    async ({ request, body, set }) => {
      // Direct auth check - bypasses Elysia plugin context issues
      const { user, error: authError } = await authenticateRequest(request);
      if (authError || !user) {
        set.status = 401;
        return { error: authError || 'Unauthorized' };
      }

      const {
        prompt,
        model,
        maxTokens = 1000,
        temperature = 0.8,
        history,
        provider = 'openrouter',
        requestType: rawRequestType = 'user',
        responseSchema,
        metrics,
        combatEntry,
        sessionId,
        player_input: requestedPlayerInput,
      } = body || {};

      if (!prompt || typeof prompt !== 'string') {
        set.status = 400;
        return { error: 'Missing prompt' };
      }

      // Phase 0.6 (#1688): per-section prompt token telemetry, log-only. No storage --
      // one structured log line per turn, WARN instead of INFO when the total estimate
      // is large enough to matter for the Phase 4 bounded-prompt work. Absent `metrics`
      // (old clients, or client-side computation failure) is a no-op, by design.
      if (metrics && typeof metrics === 'object') {
        try {
          const metricsRecord = metrics as Record<string, unknown>;
          const total =
            typeof metricsRecord.total === 'number'
              ? metricsRecord.total
              : Object.values(metricsRecord).reduce<number>(
                  (sum: number, value: unknown) => sum + (typeof value === 'number' ? value : 0),
                  0,
                );
          const line = `[PromptMetrics] ${JSON.stringify({ ...metricsRecord, total })}`;
          if (total > 30_000) {
            logger.warn(line);
          } else {
            logger.info(line);
          }
        } catch (metricsError) {
          logger.warn({ msg: 'PROMPT_METRICS_LOG_FAILED', error: metricsError });
        }
      }

      // 🛡️ Sentinel: Restrict 'system' requests to admins to prevent quota bypass.
      const isAdminUser = isAdmin(user as AuthUser);
      const requestType = rawRequestType === 'system' && isAdminUser ? 'system' : 'user';

      const userId = user.userId;
      const plan = user.plan;

      // Quota check
      const quotaType: UsageType = requestType === 'system' ? 'llm_system' : 'llm';
      const quota = await AIUsageService.checkQuotaAndConsume({
        userId,
        plan,
        type: quotaType,
        units: 1,
      });
      if (!quota.allowed) {
        set.status = 402;
        set.headers['Retry-After'] = String(
          Math.max(1, Math.ceil((new Date(quota.resetAt).getTime() - Date.now()) / 1000)),
        );
        return { error: 'AI quota exceeded', remaining: quota.remaining, resetAt: quota.resetAt };
      }

      const playerInput =
        typeof requestedPlayerInput === 'string'
          ? requestedPlayerInput
          : extractPlayerInputFromPrompt(prompt);
      const combatIntentPrefilterMatched =
        typeof playerInput === 'string' && looksLikeCombatIntent(playerInput);
      let declaredAttack: Awaited<ReturnType<typeof detectDeclaredAttack>> = null;
      if (
        combatEntry?.sessionId &&
        typeof playerInput === 'string' &&
        combatIntentPrefilterMatched
      ) {
        const actors = await loadCombatIntentActorRoster(combatEntry.sessionId, userId);
        declaredAttack = detectDeclaredAttack(playerInput, actors);
      }
      if (combatEntry?.sessionId && !declaredAttack) {
        logger.info({
          msg: 'COMBAT_INTENT_NO_DECLARATION',
          sessionId: combatEntry.sessionId,
          prefilter: combatIntentPrefilterMatched,
          detector: declaredAttack,
        });
      }
      const llmPrompt = declaredAttack
        ? appendDeclaredAttackDirective(prompt, declaredAttack.actorName)
        : prompt;

      let result = await LLMProviderService.generate({
        prompt: llmPrompt,
        model,
        maxTokens,
        temperature,
        history,
        provider,
        responseSchema,
      });
      result = stripUntargetedInitiativeRollRequests(result, declaredAttack);
      result = await enforceCombatTransitionContract({
        result,
        prompt: llmPrompt,
        model,
        maxTokens,
        temperature,
        history,
        provider,
        responseSchema,
      });
      result = stripUntargetedInitiativeRollRequests(result, declaredAttack);
      // #1907 PR1: deterministic entry detection. It runs after contract enforcement so it
      // judges the accepted dialect, and returns a pending handoff without seating. The explicit
      // combat entry endpoint owns the encounter, initiative, map, telemetry, and publication.
      result = await applyCombatEntryGate({
        result,
        userId,
        combatEntry: combatEntry as CombatEntryContext | undefined,
        declaredAttack,
      });

      if (result.error) {
        logger.error({
          msg: 'LLM_GENERATE_DEGRADED',
          error: result.error,
          status: result.status,
          provider: result.provider,
          model: result.model,
        });
        const degradedEnvelope = degradedGenerateEnvelope();
        logEnvelopeShape(null, degradedEnvelope.text, sessionId ?? combatEntry?.sessionId, true);
        set.status = 200;
        return degradedEnvelope;
      }

      if (result.usage && result.provider) {
        await AIUsageService.recordProviderUsage({
          userId,
          plan,
          type: quotaType,
          provider: result.provider,
          model: result.model,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
        });
      }

      // One parse, shared by the log line and the narration rewrite. (#2050 G)
      const envelope = parseLlmEnvelope(result.text);
      // sessionId must not come from combatEntry: that is only sent when combat
      // is NOT already active, so in-combat turns logged `sessionId: null` --
      // precisely the turns being debugged. (#2050 C)
      logEnvelopeShape(envelope, result.text, sessionId ?? combatEntry?.sessionId);

      return {
        text: rewriteNarrationSegmentsFromEnvelope(envelope, result.text),
        provider: result.provider,
        model: result.model,
      };
    },
    {
      body: t.Object({
        prompt: t.String(),
        // #2050 C: correlate the envelope log line to a session on every
        // generate, not only on the combat-entry path.
        sessionId: t.Optional(t.String({ maxLength: 255 })),
        player_input: t.Optional(t.String({ maxLength: 20_000 })),
        model: t.Optional(t.String()),
        maxTokens: t.Optional(t.Number()),
        temperature: t.Optional(t.Number()),
        history: t.Optional(
          t.Array(
            t.Object({
              role: t.Union([t.Literal('user'), t.Literal('assistant'), t.Literal('system')]),
              content: t.String(),
            }),
          ),
        ),
        provider: t.Optional(t.Union([t.Literal('openrouter'), t.Literal('gemini')])),
        requestType: t.Optional(t.Union([t.Literal('user'), t.Literal('system')])),
        responseSchema: t.Optional(t.Any()),
        // Phase 0.6 (#1688): optional, numbers-only per-section prompt token telemetry.
        // Permissive on keys (log-only, never stored) so new sections don't require a
        // schema change; values must be numbers.
        metrics: t.Optional(t.Record(t.String(), t.Number())),
        // #1907 PR1: the session and player identity detection needs to build the pending entry
        // handoff. Optional — absent (non-DM generations, older clients) simply means detection
        // does not run for that call.
        combatEntry: t.Optional(
          t.Object({
            sessionId: t.String({ minLength: 1, maxLength: 255 }),
            player: t.Object({
              characterId: t.Optional(t.Nullable(t.String({ maxLength: 255 }))),
              name: t.String({ minLength: 1, maxLength: 200 }),
              initiativeModifier: t.Number({ minimum: -100, maximum: 100 }),
              hpCurrent: t.Optional(t.Nullable(t.Number({ minimum: 0, maximum: 100_000 }))),
              hpMax: t.Optional(t.Nullable(t.Number({ minimum: 0, maximum: 100_000 }))),
            }),
          }),
        ),
      }),
    },
  )

  .post(
    '/generate/stream',
    async ({ request, body, set }) => {
      const { user, error: authError } = await authenticateRequest(request);
      if (authError || !user) {
        set.status = 401;
        return { error: authError || 'Unauthorized' };
      }
      const {
        prompt,
        model,
        maxTokens = 1000,
        temperature = 0.8,
        history,
        provider = 'openrouter',
        responseSchema,
      } = body || {};
      const quota = await AIUsageService.checkQuotaAndConsume({
        userId: user.userId,
        plan: user.plan,
        type: 'llm',
        units: 1,
      });
      if (!quota.allowed) {
        set.status = 402;
        return { error: 'AI quota exceeded', remaining: quota.remaining, resetAt: quota.resetAt };
      }
      try {
        const stream = await LLMProviderService.stream({
          prompt,
          model,
          maxTokens,
          temperature,
          history,
          provider,
          responseSchema,
        });
        return new Response(stream, {
          headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' },
        });
      } catch (error) {
        logger.error({ msg: 'LLM_STREAM_ERROR', error });
        set.status = 200;
        return degradedGenerateEnvelope();
      }
    },
    {
      body: t.Object({
        prompt: t.String(),
        player_input: t.Optional(t.String({ maxLength: 20_000 })),
        model: t.Optional(t.String()),
        maxTokens: t.Optional(t.Number()),
        temperature: t.Optional(t.Number()),
        history: t.Optional(
          t.Array(
            t.Object({
              role: t.Union([t.Literal('user'), t.Literal('assistant'), t.Literal('system')]),
              content: t.String(),
            }),
          ),
        ),
        provider: t.Optional(t.Union([t.Literal('openrouter'), t.Literal('gemini')])),
        responseSchema: t.Optional(t.Any()),
      }),
    },
  )

  /**
   * Extract memories via LLM (uses a live-verified primary with a live-verified fallback)
   * POST /v1/llm/extract
   *
   * Uses OPENROUTER_EXTRACTION_MODEL as primary,
   * falls back to OPENROUTER_EXTRACTION_FALLBACK_MODEL on error.
   */
  .post(
    '/extract',
    async ({ request, body, set }) => {
      // Direct auth check
      const { user, error: authError } = await authenticateRequest(request);
      if (authError || !user) {
        set.status = 401;
        return { error: authError || 'Unauthorized' };
      }

      const { prompt, maxTokens = 1000 } = body || {};

      if (!prompt || typeof prompt !== 'string') {
        set.status = 400;
        return { error: 'Missing prompt' };
      }

      // Use system quota for extraction (doesn't count against user's chat quota)
      const quota = await AIUsageService.checkQuotaAndConsume({
        userId: user.userId,
        plan: user.plan,
        type: 'llm_system',
        units: 1,
      });
      if (!quota.allowed) {
        set.status = 402;
        return { error: 'AI quota exceeded', resetAt: quota.resetAt };
      }

      const result = await LLMProviderService.extract({
        prompt,
        maxTokens,
      });

      if (result.error) {
        alert('llm_extraction_degraded', { error: result.error });
        set.status = 200;
        return { memories: [], degraded: true, reason: MEMORY_EXTRACTION_DEGRADED_REASON };
      }

      if (result.usage && result.provider) {
        await AIUsageService.recordProviderUsage({
          userId: user.userId,
          plan: user.plan,
          type: 'llm_system',
          provider: result.provider,
          model: result.model,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
        });
      }

      return { text: result.text, model: result.model };
    },
    {
      body: t.Object({
        prompt: t.String(),
        maxTokens: t.Optional(t.Number()),
      }),
    },
  );
