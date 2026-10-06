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
import { loadSessionEncounterContext } from '../../services/combat/combat-entry-campaign-index.js';
import {
  detectDeclaredAttack,
  detectUntargetedAttackSpell,
  looksLikeCombatIntent,
} from '../../services/combat/combat-intent-gate.js';
import { loadCombatIntentActorRoster } from '../../services/combat/combat-intent-roster.js';
import {
  buildEncounterSizeDirective,
  expandDerivedCombatants,
} from '../../services/combat/encounter-sizing.js';
import {
  applyCombatEntryGate,
  stripUntargetedInitiativeRollRequests,
  type CombatEntryContext,
} from '../../services/combat-entry-pipeline.js';
import { enforceCombatTransitionContract } from '../../services/combat-transition-enforcement.js';
import {
  persistGeneratedDmReply,
  scheduleDmReplyWatchdog,
} from '../../services/dm/dm-reply-persistence.js';
import {
  parseLlmEnvelope,
  rewriteNarrationSegmentsFromEnvelope,
} from '../../services/dm/dm-response-schema.js';
import {
  getConfiguredGeminiModels,
  getConfiguredOpenRouterModels,
} from '../../services/llm-model-config.js';
import { LLMProviderService } from '../../services/llm-provider-service.js';
import { countPromptSections } from '../../services/prompt-section-counter.js';

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
 * nothing that could put player prose or model prose into the log. The one
 * exception is `roll_requests[].type`/`.dc` (#2525): the type is reduced to a
 * known enum name and the dc to a number before either is logged.
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
    // #2525: counts alone could not answer "what kind of roll was requested, at
    // what DC" during a hidden-roll investigation. Enum names and numbers only —
    // `type` passes through the known-type allowlist in rollRequestTypesOf and
    // `dc` is copied only when it is a finite number, never model prose.
    rollRequestTypes: rollRequestTypesOf(envelope),
    rollRequestDcs: rollRequestDcsOf(envelope),
  });
}

const LOGGABLE_ROLL_TYPES = new Set([
  'attack',
  'save',
  'check',
  'damage',
  'damage_taken',
  'initiative',
  'skill_check',
]);

/**
 * The `type` of each roll request in the envelope (at most 10), for the log line that says why a
 * reply was held. The model writes this field, so only a known type is copied into the log;
 * anything else is reported as `other`.
 */
function rollRequestTypesOf(envelope: Record<string, unknown> | null): string[] {
  const requests = Array.isArray(envelope?.roll_requests) ? envelope.roll_requests : [];
  return requests.slice(0, 10).map((request) => {
    const type = (request as { type?: unknown } | null)?.type;
    return typeof type === 'string' && LOGGABLE_ROLL_TYPES.has(type) ? type : 'other';
  });
}

/**
 * The `dc` of each roll request in the envelope (at most 10, aligned with
 * `rollRequestTypesOf`), for `LLM_GENERATE_ENVELOPE_SHAPE` (#2525). Numbers
 * only: anything that is not a finite number logs as `null`, never raw model
 * output.
 */
function rollRequestDcsOf(envelope: Record<string, unknown> | null): Array<number | null> {
  const requests = Array.isArray(envelope?.roll_requests) ? envelope.roll_requests : [];
  return requests.slice(0, 10).map((request) => {
    const dc = (request as { dc?: unknown } | null)?.dc;
    return typeof dc === 'number' && Number.isFinite(dc) ? dc : null;
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

// #2533: one structured, numbers-only log line per generate with the token
// count of each prompt section, counted server-side from the prompt the
// server actually received (see services/prompt-section-counter.ts). This
// is independent of the client-sent `metrics` record logged above as
// [PromptMetrics]: that record lumps memory/rules/character into
// campaign_and_canon, so it cannot price the canon cut. Log-only; a
// counting failure must never block a turn.
// `dm` is true only for the turn's main DM generate (the request carrying
// `dmReply`): /generate also serves non-DM calls and the narration-contract
// regeneration, which carry no dmReply, so the flag lets readers filter the
// per-turn table down to DM turns.
function logPromptSections(
  prompt: string,
  history: Array<{ content?: unknown }> | undefined,
  sessionId: string | undefined,
  dm: boolean,
): void {
  try {
    const sections = countPromptSections(prompt, history);
    logger.info(
      `[PromptSections] ${JSON.stringify({ sessionId: sessionId ?? null, dm, ...sections })}`,
    );
  } catch (sectionsError) {
    logger.warn({ msg: 'PROMPT_SECTIONS_LOG_FAILED', error: sectionsError });
  }
}

// #2158: the browser must not choose the model or the output size. The DM turn asks for 8192
// (src/services/ai-service.ts), so that is the generate ceiling; extraction asks for 1000-1200.
const MAX_GENERATE_TOKENS = 8192;
const MAX_EXTRACT_TOKENS = 1500;

const clampMaxTokens = (value: unknown, fallback: number, max: number): number => {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(Math.max(1, n), max);
};

// #2427: the section names measurePromptSections (src/services/ai/shared/prompt-metrics.ts) emits.
// The client sends this record, so only these keys, with numeric values, go into the log.
// #2450: adds `scene` (current-scene block), `canon_cut` and `history_below_floor` guard flags.
const PROMPT_METRIC_KEYS = [
  'campaign_and_canon',
  'tactical',
  'scene_state',
  'system',
  'history',
  'player_input',
  'scene',
  'canon_cut',
  'history_below_floor',
] as const;

// #2425: say when the server replaced what the client sent. Route, user and two flags only: the
// client's model string and prompt never go into the log.
const warnIfClientInputReplaced = (
  route: string,
  userId: string,
  sent: { model?: unknown; maxTokens?: unknown },
  used: { model?: string; maxTokens: number },
): void => {
  const modelDropped = sent.model !== undefined && sent.model !== null && used.model === undefined;
  const clamped = sent.maxTokens !== undefined && sent.maxTokens !== used.maxTokens;
  if (!modelDropped && !clamped) return;
  logger.warn({ msg: 'LLM_CLIENT_INPUT_REPLACED', route, userId, modelDropped, clamped });
};

// Only a model the server already configures may be requested; anything else uses the default.
const allowlistedModel = (model: unknown): string | undefined => {
  if (typeof model !== 'string') return undefined;
  const trimmed = model.trim();
  const allowed = new Set([...getConfiguredOpenRouterModels(), ...getConfiguredGeminiModels()]);
  return allowed.has(trimmed) ? trimmed : undefined;
};

const extractPlayerInputFromPrompt = (prompt: string): string | undefined => {
  const match = /<player_input>\s*([\s\S]*?)\s*<\/player_input>\s*$/i.exec(prompt);
  const playerInput = match?.[1]?.trim();
  return playerInput || undefined;
};

const escapeXmlAttribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const appendDeclaredAttackDirective = (
  prompt: string,
  actorName: string,
  encounterDirective = '',
): string => {
  const escapedActor = escapeXmlAttribute(actorName);
  const size = encounterDirective ? ` ${encounterDirective}` : '';
  return `${prompt}\n\n<declared_attack actor="${escapedActor}">The player has declared an attack on ${escapedActor}. It has NOT been resolved: the engine has not rolled, so nothing has hit, missed, or dealt damage, and ${escapedActor} has not reacted or moved. Do NOT resolve it. Emit combat_transition:'start' with ${escapedActor} in combatants and describe only the moment before the roll.${size}</declared_attack>`;
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
      // Account page display: every quota (messages, images, voice in
      // characters) from the same quota config, in one response (#2510).
      const all = await AIUsageService.getAllQuotaStatuses({
        userId: user.userId,
        plan: user.plan,
      });
      return { ...quotaStatus, quotas: all.quotas };
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
        dmReply,
      } = body || {};
      const safeModel = allowlistedModel(model);
      const safeMaxTokens = clampMaxTokens(maxTokens, 1000, MAX_GENERATE_TOKENS);
      warnIfClientInputReplaced(
        'generate',
        user.userId,
        { model, maxTokens: body?.maxTokens },
        { model: safeModel, maxTokens: safeMaxTokens },
      );

      if (!prompt || typeof prompt !== 'string') {
        set.status = 400;
        return { error: 'Missing prompt' };
      }

      // Phase 0.6 (#1688): per-section prompt token telemetry, log-only. No storage --
      // one structured log line per turn, WARN instead of INFO when the total estimate
      // is large enough to matter for the Phase 4 bounded-prompt work. Absent `metrics`
      // (old clients, or client-side computation failure) is a no-op, by design.
      // #2450: the record also carries `canon_cut` / `history_below_floor` 0/1 guard
      // flags; they log as counts only (never prompt text or player text) and get
      // their own WARN lines when set.
      if (metrics && typeof metrics === 'object') {
        try {
          const metricsRecord = metrics as Record<string, unknown>;
          // #2427: only the allowlisted keys go into the log, with numeric values.
          const loggedMetrics: Record<string, number> = {};
          for (const key of PROMPT_METRIC_KEYS) {
            const value = metricsRecord[key];
            if (typeof value === 'number' && Number.isFinite(value)) loggedMetrics[key] = value;
          }
          // The #2450 guard flags are counts, not section token estimates, so they
          // must not be summed into the total.
          const total =
            typeof metricsRecord.total === 'number'
              ? metricsRecord.total
              : (Object.entries(loggedMetrics) as [string, number][])
                  .filter(([key]) => key !== 'canon_cut' && key !== 'history_below_floor')
                  .reduce<number>((sum, [, value]) => sum + value, 0);
          const line = `[PromptMetrics] ${JSON.stringify({ ...loggedMetrics, total })}`;
          if (total > 30_000) {
            logger.warn(line);
          } else {
            logger.info(line);
          }
          if (loggedMetrics.canon_cut === 1) {
            logger.warn(
              `[PromptMetrics] canon cut to fit prompt budget ${JSON.stringify({
                sessionId,
                canon_cut: loggedMetrics.canon_cut,
              })}`,
            );
          }
          if (loggedMetrics.history_below_floor === 1) {
            logger.warn(
              `[PromptMetrics] history below floor ${JSON.stringify({
                sessionId,
                history_below_floor: loggedMetrics.history_below_floor,
              })}`,
            );
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

      // #2456: a message sent after the party was defeated must not run
      // ordinary generation. The encounter is concluded, so it no longer
      // appears as active — check the latest concluded encounter and return a
      // handled terminal state (before quota is consumed) so the client can
      // render the death screen instead of erroring and wedging on the
      // "Checking whose turn it is… / Resuming…" loop.
      // The check is wrapped in try/catch: if the encounter lookup fails
      // (e.g. database unavailable), fall through to ordinary generation
      // rather than breaking the chat route.
      const terminalCheckSessionId =
        typeof sessionId === 'string' && sessionId.length > 0
          ? sessionId
          : typeof combatEntry?.sessionId === 'string'
            ? combatEntry.sessionId
            : null;
      if (terminalCheckSessionId) {
        try {
          // Dynamic import: CombatEncounterService pulls in the database
          // client at import time. Loading it lazily keeps the route
          // importable in tests that don't mock the database.
          const { CombatEncounterService } =
            await import('../../services/combat/combat-encounter-service.js');
          const latestConcluded = await CombatEncounterService.getLatestConcludedEncounter(
            terminalCheckSessionId,
            userId,
          );
          if (latestConcluded?.endedReason === 'party_defeated') {
            const stillActive = await CombatEncounterService.getActiveEncounter(
              terminalCheckSessionId,
              userId,
            );
            if (!stillActive) {
              logger.info({
                msg: 'LLM_GENERATE_PARTY_DEFEATED_TERMINAL',
                sessionId: terminalCheckSessionId,
                encounterId: latestConcluded.id,
              });
              set.status = 200;
              return {
                terminalState: 'party_defeated',
                encounterId: latestConcluded.id,
                text: '',
              };
            }
          }
        } catch (terminalCheckError) {
          logger.warn({
            msg: 'LLM_GENERATE_TERMINAL_CHECK_FAILED',
            sessionId: terminalCheckSessionId,
            error:
              terminalCheckError instanceof Error
                ? terminalCheckError.message
                : String(terminalCheckError),
          });
        }
      }

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

      // #2533: server-counted prompt sections, one line per generate. Below
      // the quota consume (and the party-defeated terminal return above it)
      // so requests that never reach a provider call are not logged as turns.
      logPromptSections(prompt, history, sessionId ?? combatEntry?.sessionId, Boolean(dmReply));

      const playerInput =
        typeof requestedPlayerInput === 'string'
          ? requestedPlayerInput
          : extractPlayerInputFromPrompt(prompt);
      const combatIntentPrefilterMatched =
        typeof playerInput === 'string' && looksLikeCombatIntent(playerInput);
      let declaredAttack: Awaited<ReturnType<typeof detectDeclaredAttack>> = null;
      let untargetedSpellRoster: Awaited<ReturnType<typeof loadCombatIntentActorRoster>> | null =
        null;
      if (
        combatEntry?.sessionId &&
        typeof playerInput === 'string' &&
        combatIntentPrefilterMatched
      ) {
        const actors = await loadCombatIntentActorRoster(combatEntry.sessionId, userId);
        declaredAttack = detectDeclaredAttack(playerInput, actors);
        // "At him" points at a creature the DM may have just introduced; only a cast that names
        // nothing (the sheet's) is checked against the roster.
        const untargetedSpell = declaredAttack ? null : detectUntargetedAttackSpell(playerInput);
        if (untargetedSpell && !untargetedSpell.pronoun) untargetedSpellRoster = actors;
      }
      if (combatEntry?.sessionId && !declaredAttack) {
        logger.info({
          msg: 'COMBAT_INTENT_NO_DECLARATION',
          sessionId: combatEntry.sessionId,
          prefilter: combatIntentPrefilterMatched,
          detector: declaredAttack,
        });
      }
      // #2514: the DM prompt receives the engine-decided creature count and
      // names BEFORE it narrates the approach. For a declared attack the
      // target is known before generation, so sizing runs here and the
      // directive carries the count into the prose prompt; the gate and
      // `startCombat` then seat exactly that sized encounter. A sizing
      // failure must not block the turn: the directive falls back to the
      // single named creature, as before #2514.
      let encounterDirective = '';
      if (declaredAttack && combatEntry?.sessionId) {
        try {
          const context = await loadSessionEncounterContext(combatEntry.sessionId, userId);
          if (context.difficulty) {
            const sized = expandDerivedCombatants(
              [
                {
                  name: declaredAttack.actorName,
                  ...(declaredAttack.monsterId ? { monsterId: declaredAttack.monsterId } : {}),
                  count: 1,
                },
              ],
              context,
            );
            encounterDirective = buildEncounterSizeDirective(sized);
          }
        } catch (sizingError) {
          logger.warn({
            msg: 'LLM_ENCOUNTER_SIZING_UNAVAILABLE',
            sessionId: combatEntry.sessionId,
            error: sizingError,
          });
        }
      }
      const llmPrompt = declaredAttack
        ? appendDeclaredAttackDirective(prompt, declaredAttack.actorName, encounterDirective)
        : prompt;

      let result = await LLMProviderService.generate({
        prompt: llmPrompt,
        model: safeModel,
        maxTokens: safeMaxTokens,
        temperature,
        history,
        provider,
        responseSchema,
      });
      result = stripUntargetedInitiativeRollRequests(result, declaredAttack);
      const factSessionId = sessionId ?? combatEntry?.sessionId;
      result = await enforceCombatTransitionContract({
        result,
        prompt: llmPrompt,
        model: safeModel,
        maxTokens: safeMaxTokens,
        temperature,
        history,
        provider,
        responseSchema,
        // #2563: a scene end deferred at generation time writes the refusal fact the
        // end route writes on a 409, so the DM's next read knows the fight is not over.
        // Loaded lazily: the tactical-action graph reaches the db client, and this
        // route's module graph must stay loadable without DATABASE_URL.
        recordTacticalFact: factSessionId
          ? async (fact) => {
              const { recordDmTacticalFact } =
                await import('../../services/combat/tactical-action-service.js');
              await recordDmTacticalFact(factSessionId, fact);
            }
          : undefined,
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
        untargetedSpellRoster,
        liveEncounter: async (sessionId, ownerId) => {
          const { combatEntryGateDeps } =
            await import('../../services/combat/combat-entry-gate-deps.js');
          return combatEntryGateDeps.getActiveEncounter(sessionId, ownerId);
        },
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
          // #2218: only DM turns carry dmReply; other generations stay session-less.
          sessionId: dmReply ? (sessionId ?? combatEntry?.sessionId) : undefined,
        });
      }

      // One parse, shared by the log line and the narration rewrite. (#2050 G)
      const envelope = parseLlmEnvelope(result.text);
      // sessionId must not come from combatEntry: that is only sent when combat
      // is NOT already active, so in-combat turns logged `sessionId: null` --
      // precisely the turns being debugged. (#2050 C)
      logEnvelopeShape(envelope, result.text, sessionId ?? combatEntry?.sessionId);

      // #2218: the engine keeps the DM reply it generated. Written before the response leaves,
      // so a tab that dies after this point cannot take the reply with it; the client saves
      // the same id and replaces this row in place. A turn the server may not persist (roll,
      // combat) is watched instead, and reported if no DM row follows.
      let dmReplyPersisted = false;
      const dmSessionId = sessionId ?? combatEntry?.sessionId;
      if (dmReply && dmSessionId) {
        const generatedAt = new Date();
        const persistence = await persistGeneratedDmReply({
          userId,
          sessionId: dmSessionId,
          messageId: dmReply.messageId,
          envelope,
          clientInCombat: dmReply.inCombat === true,
          narrationGated: dmReply.narrationGated,
        });
        dmReplyPersisted = persistence.persisted;
        logger.info({
          msg: 'DM_REPLY_PERSISTENCE',
          sessionId: dmSessionId,
          messageId: dmReply.messageId,
          persisted: persistence.persisted,
          reason: persistence.reason ?? null,
          // #2530: D1's two held replies could not be told apart afterwards; the request's type
          // says whether the player was owed an attack, a check or a save. Types only.
          ...(persistence.reason === 'roll_requests'
            ? { rollRequestTypes: rollRequestTypesOf(envelope) }
            : {}),
        });
        if (!persistence.persisted) {
          void scheduleDmReplyWatchdog({
            sessionId: dmSessionId,
            messageId: dmReply.messageId,
            reason: persistence.reason ?? 'unknown',
            generatedAt,
          });
        }
      }

      return {
        text: rewriteNarrationSegmentsFromEnvelope(envelope, result.text),
        provider: result.provider,
        model: result.model,
        ...(dmReply ? { dmReplyPersisted } : {}),
      };
    },
    {
      body: t.Object({
        prompt: t.String(),
        // #2050 C: correlate the envelope log line to a session on every
        // generate, not only on the combat-entry path.
        sessionId: t.Optional(t.String({ maxLength: 255 })),
        player_input: t.Optional(t.String({ maxLength: 20_000 })),
        // #2218: the id the client reserved for this turn's DM row. Present only on the main DM
        // turn; the server persists the reply under it when the turn is display-ready.
        dmReply: t.Optional(
          t.Object({
            messageId: t.String({
              pattern:
                '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
            }),
            inCombat: t.Optional(t.Boolean()),
            narrationGated: t.Optional(t.Boolean()),
          }),
        ),
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
        sessionId,
        dmReply,
      } = body || {};
      const safeModel = allowlistedModel(model);
      const safeMaxTokens = clampMaxTokens(maxTokens, 1000, MAX_GENERATE_TOKENS);
      warnIfClientInputReplaced(
        'generate/stream',
        user.userId,
        { model, maxTokens: body?.maxTokens },
        { model: safeModel, maxTokens: safeMaxTokens },
      );
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
      // #2533: streamed generates get the same one-line section count,
      // only once quota has been consumed for an actual provider call.
      logPromptSections(prompt, history, sessionId, Boolean(dmReply));
      try {
        const stream = await LLMProviderService.stream({
          prompt,
          model: safeModel,
          maxTokens: safeMaxTokens,
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
        // #2533: correlates the stream route's [PromptSections] line to a
        // session, as /generate already does (#2050 C). Sent by
        // LlmApiClient.generateText on every call.
        sessionId: t.Optional(t.String({ maxLength: 255 })),
        // #2533: present only on the main DM turn (same shape as
        // /generate), so the [PromptSections] line can label it dm:true.
        dmReply: t.Optional(
          t.Object({
            messageId: t.String({
              pattern:
                '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
            }),
            inCombat: t.Optional(t.Boolean()),
            narrationGated: t.Optional(t.Boolean()),
          }),
        ),
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

      const safeMaxTokens = clampMaxTokens(maxTokens, 1000, MAX_EXTRACT_TOKENS);
      warnIfClientInputReplaced(
        'extract',
        user.userId,
        { maxTokens: body?.maxTokens },
        { maxTokens: safeMaxTokens },
      );

      const result = await LLMProviderService.extract({
        prompt,
        maxTokens: safeMaxTokens,
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
