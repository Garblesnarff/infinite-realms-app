/**
 * LLM Routes for Elysia
 *
 * Provides LLM generation API endpoints:
 * - GET /v1/llm/quota - Get current quota status
 * - POST /v1/llm/generate - Generate text via OpenRouter or Gemini
 *
 * Ported from /server/src/routes/v1/llm.ts
 */

import { timingSafeEqual } from 'node:crypto';

import { Elysia, t } from 'elysia';

import { SSE_HEADERS, extractPartialNarration } from './llm-streaming.js';
import { deferUntilCommit } from '../../../../db/transaction-context';
import {
  DEATH_SAVE_TURN_TEXT,
  describeDeathSave,
  describeDeathSaveRollLine,
} from '../../../../shared/death-save-lines.js';
import { authenticateRequest, type AuthUser } from '../../lib/auth.js';
import { logger } from '../../lib/logger.js';
import { isAdmin } from '../../middleware/admin.js';
import { planRateLimit } from '../../middleware/rate-limit.js';
import { AIUsageService, type UsageType } from '../../services/ai-usage-service.js';
import { loadSessionEncounterContext } from '../../services/combat/combat-entry-campaign-index.js';
import {
  declareSpellAttackOn,
  detectDeclaredAttack,
  detectDeclaredDefense,
  detectUntargetedAttackSpell,
  looksLikeCombatIntent,
  type CombatIntentActor,
  type DefensiveDeclaration,
  type UntargetedAttackSpell,
} from '../../services/combat/combat-intent-gate.js';
import { loadCombatIntentActorRoster } from '../../services/combat/combat-intent-roster.js';
import {
  buildEncounterSizeDirective,
  expandDerivedCombatants,
} from '../../services/combat/encounter-sizing.js';
import { maybeStartConcentrationAfterReply } from '../../services/combat/spell-cast-concentration.js';
import {
  applyCombatEntryGate,
  stripUntargetedInitiativeRollRequests,
  type CombatEntryContext,
} from '../../services/combat-entry-pipeline.js';
import { enforceCombatTransitionContract } from '../../services/combat-transition-enforcement.js';
import { preserveDeclaredToolCheck } from '../../services/dm/declared-tool-check.js';
import {
  refuseFeaturesCharacterLacks,
  type AllowedCasts,
  type AllowedFeatures,
} from '../../services/dm/dm-feature-gate.js';
import {
  persistGeneratedDmReply,
  scheduleDmReplyWatchdog,
} from '../../services/dm/dm-reply-persistence.js';
import {
  dmResponseSchema,
  parseLlmEnvelope,
  rewriteNarrationSegmentsFromEnvelope,
} from '../../services/dm/dm-response-schema.js';
import { recordDmTurnActions } from '../../services/dm/dm-turn-action-registry.js';
import { isRetryableUpstreamStatus } from '../../services/llm-errors.js';
import { isProviderKeyLimitError } from '../../services/llm-key-limit.js';
import {
  getConfiguredGeminiModels,
  getConfiguredOpenRouterModels,
} from '../../services/llm-model-config.js';
import { LLMProviderService, type LLMResponse } from '../../services/llm-provider-service.js';
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

// #350: a turn degraded by a provider key/credit limit is not the player's
// fault. The message says so plainly, and the route gives the consumed quota
// unit back (see the degraded branch below) — "Your turn was not used."
const LLM_GENERATE_KEY_LIMIT_REASON = 'llm_provider_key_limit';
const LLM_GENERATE_KEY_LIMIT_TEXT =
  'The storyteller is offline for maintenance. Your turn was not used.';

const keyLimitDegradedEnvelope = (): {
  parsed: false;
  degraded: true;
  reason: string;
  text: string;
} => ({
  parsed: false as const,
  degraded: true as const,
  reason: LLM_GENERATE_KEY_LIMIT_REASON,
  text: LLM_GENERATE_KEY_LIMIT_TEXT,
});

/**
 * #350: whether a failed storyteller result was caused by a provider key/credit
 * limit. The provider service computes the verdict once per chain-exhausted
 * event and carries it on `result.providerKeyLimit`; the status-only check is
 * a fallback for results produced off that path (e.g. the breaker-open fast
 * fail, which synthesizes `upstreamStatus: 403` while the key is known dead).
 */
const isKeyLimitResult = (result: LLMResponse): boolean =>
  result.providerKeyLimit === true ||
  isProviderKeyLimitError({ upstreamStatus: result.upstreamStatus });

/**
 * #312: whether a failed storyteller call is worth one retry before the turn degrades.
 * Retryable means the provider said so (`retryable: true`, e.g. a 429 with `retry_after`)
 * or the status is in the retryable set (408/409/425/429/5xx — including the 60 s provider
 * timeout, which surfaces as a 503). Anything else (400s, auth, quota) degrades at once.
 */
const isRetryableGenerateResult = (result: LLMResponse): boolean => {
  if (!result.error) return false;
  if (result.retryable === true) return true;
  return typeof result.status === 'number' && isRetryableUpstreamStatus(result.status);
};

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
// (src/services/ai-service.ts), so that is the generate ceiling.
const MAX_GENERATE_TOKENS = 8192;

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
  // #352: the split lore sections (scene-stable + per-turn tail).
  'lore_scene',
  'lore_tail',
  // #352 (self-review): the game-state envelope and turn-flags line are real
  // prompt sections, so they get keys instead of riding unmeasured in `total`.
  'game_state',
  'turn_flags',
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

/**
 * GP-060 (#313): the player cast a damaging combat spell with no resolvable target
 * ("I fling my palms toward the creature's maw and cast Burning Hands"). The intent
 * gate cannot name the creature from a body part or vague noun, so without this the
 * DM narrates the cast as flavor and no fight starts. The directive tells the DM to
 * name the hostile creature in `combatants` and emit combat_transition:'start'
 * without resolving the damage — the entry gate validates the named creature against
 * the scene roster (invented ones are dropped), and the engine resolves the cast if
 * the player confirms the entry. Only used when the roster is non-empty; with no
 * known creatures there is nothing to fight and the DM narrates normally.
 */
export const appendUntargetedSpellDirective = (prompt: string, spellName: string): string => {
  const escapedSpell = escapeXmlAttribute(spellName);
  return (
    `${prompt}\n\n<untargeted_spell name="${escapedSpell}">The player has cast ${escapedSpell} ` +
    `at a hostile creature. It has NOT been resolved: the engine has not rolled, so nothing ` +
    `has hit, missed, or dealt damage, and no creature has reacted or moved. Do NOT resolve ` +
    `it and do NOT narrate it as already done. Name the hostile creature the spell is aimed ` +
    `at in combatants and emit combat_transition:'start'; describe only the moment before ` +
    `the roll.</untargeted_spell>`
  );
};

/**
 * GP-060 (#313): the untargeted damaging spell the `<untargeted_spell>` directive named.
 * The DM named the creature and the entry gate validated it against the roster, so the
 * cast becomes the declared attack on the first named creature: the engine resolves it
 * as the opening action when the player confirms the entry, exactly like a typed declared
 * attack. A no-op when there is no pending entry, when an attack is already declared, or
 * when the named creature matches no roster actor. Pure: parses and re-serializes the
 * envelope text.
 */
export function attachUntargetedSpellAttack(
  resultText: string,
  spell: { id: string; name: string },
  roster: readonly CombatIntentActor[],
): string {
  let envelope: Record<string, unknown>;
  try {
    envelope = JSON.parse(resultText) as Record<string, unknown>;
  } catch {
    return resultText;
  }
  const pending = envelope.combat_entry_pending as
    | { declaredAttack?: unknown; combatants?: Array<{ name?: string; monsterId?: string }> }
    | undefined;
  if (!pending || pending.declaredAttack) return resultText;
  const combatants = pending.combatants ?? [];
  const targetName = (combatants[0]?.name ?? '').toLowerCase();
  if (!targetName) return resultText;
  const actor = roster.find(
    (candidate) =>
      candidate.name.toLowerCase() === targetName ||
      (candidate.monsterId != null &&
        combatants[0]?.monsterId != null &&
        candidate.monsterId === combatants[0]?.monsterId),
  );
  if (!actor) return resultText;
  return JSON.stringify({
    ...envelope,
    combat_entry_pending: { ...pending, declaredAttack: declareSpellAttackOn(spell, actor) },
  });
}

/**
 * #262: the player declared a defensive action in plain text ("I dodge"). The DM's
 * inline options send the option text as chat, so without this directive the DM
 * narrates the dodge but the engine never applies it. The directive tells the DM to
 * emit the structured combat_action instead of just narrating.
 *
 * Yield and flee go through the same combat_action path: the engine resolves them
 * through the intent the inline option sends, so a typed surrender ends the
 * encounter with the `player_surrendered` reason. Directing the DM at
 * `combat_transition:'end'` with a player `combat_exits` entry instead disagrees
 * with the end guard, which drops exit declarations that name the player — the
 * prompt promised "the engine records the exit with its reason" while the guard
 * refused the end outright (#262).
 */
export const appendDeclaredDefenseDirective = (
  prompt: string,
  defense: 'dodge' | 'disengage' | 'dash' | 'yield' | 'flee',
): string => {
  const actionLabel =
    defense === 'dodge'
      ? 'Dodge (attack rolls against the character have disadvantage while the attacker is visible to them, and they have advantage on Dexterity saving throws, until the start of their next turn)'
      : defense === 'disengage'
        ? 'Disengage (movement does not provoke opportunity attacks this turn)'
        : defense === 'dash'
          ? 'Dash (gain extra movement this turn)'
          : defense === 'yield'
            ? 'Yield (surrender: the engine ends the fight with the surrender recorded)'
            : 'Flee (leave the fight: the engine records the exit, and a hostile in reach gets one attack as you turn)';
  return (
    `${prompt}\n\n<declared_defense type="${defense}">The player has declared a defensive ` +
    `action: ${actionLabel}. It has NOT been resolved by the engine. Do NOT just narrate it. ` +
    `Emit a combat_action of type '${defense}' for the current player character so the engine ` +
    `applies it, then narrate the result.</declared_defense>`
  );
};

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Resolves the dying tray's turn (#261). The client posts "Death saving throw."
 * as a chat line; the engine must roll the d20 on it. Returns the turn payload
 * when an active encounter has a dying player holding the turn.
 *
 * Returns null only when there is no session or no active encounter (the caller
 * falls through to normal generation). When an encounter is active but the turn
 * is not a dying turn — e.g. a retry after the save already resolved and the
 * turn advanced — returns an engine message instead of null, so the DM never
 * narrates the raw "Death saving throw." line as prose (the original #261 bug).
 *
 * The engine rolls the die here (rollOwedDeathSave rolls when no d20 is
 * given) and advances the turn, so the save is recorded even when the client's
 * dice prompt never fires. The DM's narration fact is recorded by the save
 * resolution itself (describeDeathSave, in death-saves-service); the line
 * returned here is the chat line for the save (describeDeathSaveRollLine).
 */
async function resolveDeathSaveTurn(
  sessionId: string | undefined,
  userId: string,
): Promise<Record<string, unknown> | null> {
  if (!sessionId) return null;
  try {
    // Dynamic imports: these services pull in the database client at import
    // time. Loading them lazily keeps the route importable in tests that don't
    // mock the database (same pattern as the party-defeated check).
    const { CombatEncounterService } =
      await import('../../services/combat/combat-encounter-service.js');
    const activeEncounter = await CombatEncounterService.getActiveEncounter(sessionId, userId);
    if (!activeEncounter) return null;
    const { executeCombatIntent } = await import('../../services/combat/combat-intent-service.js');
    const state = await CombatEncounterService.getCombatState(activeEncounter.id, userId);
    const currentRef = state.currentParticipant;
    const current = currentRef ? state.participants.find((p) => p.id === currentRef.id) : undefined;
    const { vitalStateOf } = await import('../../services/combat/vital-state.js');
    // Not a dying turn (turn advanced after a resolved save, or the text was
    // sent when no save was owed): answer from the engine so the DM never sees
    // the raw line. This is the retry path — the d20 already rolled.
    if (!current || vitalStateOf(current) !== 'dying') {
      logger.info({
        msg: 'LLM_GENERATE_DEATH_SAVE_ALREADY_RESOLVED',
        sessionId,
        encounterId: activeEncounter.id,
      });
      return {
        parsed: true,
        text: 'The death saving throw has already been resolved.',
        provider: 'engine',
        model: 'engine',
        deathSave: null,
      };
    }
    const result = (await executeCombatIntent(
      activeEncounter.id,
      { type: 'death_save', actorId: current.id },
      userId,
      'player',
    )) as { deathSaves?: Array<Record<string, unknown>> };
    const save = result?.deathSaves?.[0];
    const actorName =
      typeof current.name === 'string' && current.name.length > 0 ? current.name : 'The hero';
    logger.info({
      msg: 'LLM_GENERATE_DEATH_SAVE_TURN',
      sessionId,
      encounterId: activeEncounter.id,
      participantId: current.id,
      roll: save?.roll,
      successes: save?.successes,
      failures: save?.failures,
      isDead: save?.isDead,
      isStabilized: save?.isStabilized,
    });
    return {
      parsed: true,
      text: save
        ? (describeDeathSaveRollLine(save) ?? describeDeathSave(actorName, save))
        : `${actorName} makes a death saving throw.`,
      provider: 'engine',
      model: 'engine',
      deathSave: save ?? null,
    };
  } catch (error) {
    // Only the engine's refusal (BusinessLogicError: not the turn holder,
    // already recorded) maps to "already resolved". Other errors (DB outage in
    // getActiveEncounter/getCombatState, etc.) are rethrown so the request
    // fails and the client can show it — never tell the dying player the save
    // is done when nothing was rolled or recorded.
    const { BusinessLogicError } = await import('../../lib/errors.js');
    if (error instanceof BusinessLogicError) {
      logger.warn({
        msg: 'LLM_GENERATE_DEATH_SAVE_REFUSED',
        sessionId,
        error: error.message,
      });
      return {
        parsed: true,
        text: 'The death saving throw has already been resolved.',
        provider: 'engine',
        model: 'engine',
        deathSave: null,
      };
    }
    throw error;
  }
}

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
   * Delete the caller's own ai_usage rows by id
   * DELETE /v1/llm/usage
   *
   * #350 FIX round 2: the deploy smoke deletes the ai_usage rows its probe
   * turn created (the ids the generate response carried back) so deploys stop
   * accumulating usage rows.
   *
   * Deleting usage rows restores quota (quota = limit - SUM(units)), so this
   * endpoint is NOT open to users: it requires the SMOKE_CLEANUP_SECRET shared
   * secret (sent as the x-smoke-cleanup-secret header), which only the deploy
   * smoke knows. Without the secret this would be a self-service quota reset.
   * Scoped to the authenticated user as defense in depth.
   */
  .delete(
    '/usage',
    async ({ request, body, set }) => {
      // Direct auth check - bypasses Elysia plugin context issues
      const { user, error } = await authenticateRequest(request);
      if (error || !user) {
        set.status = 401;
        return { error: error || 'Unauthorized' };
      }

      // The cleanup secret gates this endpoint: quota is derived from the
      // usage rows, so deleting rows restores quota. Only the deploy smoke
      // (which holds the secret in its host env file) may delete rows.
      const configuredSecret = process.env.SMOKE_CLEANUP_SECRET || '';
      const presentedSecret = request.headers.get('x-smoke-cleanup-secret') || '';
      if (configuredSecret === '' || !constantTimeEqual(presentedSecret, configuredSecret)) {
        set.status = 403;
        return { error: 'Forbidden' };
      }

      const ids = Array.isArray(body?.ids)
        ? body.ids.filter(
            (id: unknown): id is number => typeof id === 'number' && Number.isFinite(id),
          )
        : [];
      if (ids.length === 0) {
        set.status = 400;
        return { error: 'ids must be a non-empty array of usage row ids' };
      }

      try {
        const { deleted } = await AIUsageService.deleteUsageRows({ userId: user.userId, ids });
        return { deleted };
      } catch (err) {
        logger.error({ msg: 'LLM_USAGE_DELETE_ERROR', error: err });
        set.status = 500;
        return { error: 'Failed to delete usage rows' };
      }
    },
    {
      body: t.Object({
        ids: t.Array(t.Number()),
      }),
    },
  )

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
        // #352: the stable system block; prepended as the `system` message so
        // the provider caches on the prompt prefix.
        systemPrompt,
        model,
        maxTokens = 1000,
        temperature = 0.8,
        history,
        provider = 'openrouter',
        requestType: rawRequestType = 'user',
        metrics,
        combatEntry,
        sessionId,
        // #849 (audit F19): the token the tactical-context GET handed out with its
        // one-shot facts. Carrying it here confirms delivery; see the hook below.
        tacticalDeliveryToken,
        player_input: requestedPlayerInput,
        dmReply: requestedDmReply,
        stream,
      } = body || {};
      // #782 item 3: the DM reply schema is built server-side from the canonical
      // module. The client no longer sends `responseSchema`; a client-sent value
      // is ignored during the transition (the body type still accepts it).
      const responseSchema = dmResponseSchema;
      let dmReply = requestedDmReply;
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

      // #849 (audit F19): a generate carrying the tactical delivery token confirms
      // the client received the one-shot facts the context GET put in this prompt,
      // which is what finally deletes them. The confirm fires only once the turn
      // has actually produced a reply (see the two call sites below): firing at
      // accept time would lose the facts to any turn that then errored. A missing
      // token (older clients) never confirms, and a failed confirm leaves the
      // batch to its TTL rather than failing the player's turn — best-effort and
      // detached, like the other post-accept hooks in this route. Loaded lazily for
      // the same reason as the recordTacticalFact hook below: this route's module
      // graph must stay loadable without DATABASE_URL. Like the rest of this
      // handler, the session id falls back to the combat entry's session id.
      const tacticalDeliverySucceeded = (payload: unknown): boolean =>
        typeof payload === 'object' &&
        payload !== null &&
        !('error' in payload) &&
        (payload as { degraded?: unknown }).degraded !== true &&
        typeof (payload as { text?: unknown }).text === 'string';
      const confirmTacticalDelivery = (): void => {
        const confirmSessionId = sessionId ?? combatEntry?.sessionId;
        if (
          typeof confirmSessionId !== 'string' ||
          confirmSessionId.length === 0 ||
          typeof tacticalDeliveryToken !== 'string' ||
          tacticalDeliveryToken.length === 0
        ) {
          return;
        }
        void (async () => {
          try {
            const { confirmTacticalContextDelivery } =
              await import('../../services/combat/tactical-action-service.js');
            await confirmTacticalContextDelivery(confirmSessionId, tacticalDeliveryToken);
          } catch (error) {
            logger.warn({
              msg: 'TACTICAL_DELIVERY_CONFIRM_FAILED',
              sessionId: confirmSessionId,
              error,
            });
          }
        })();
      };

      const generateTurn = async (
        canonicalMessageId?: string,
        onToken?: (text: string) => void,
        onAttemptStart?: () => void,
      ) => {
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
        // #350 FIX round 2: the ai_usage row ids this turn creates, carried
        // back so the deploy smoke can delete its probe rows.
        const usageIds: number[] = [];
        if (typeof quota.usageId === 'number') usageIds.push(quota.usageId);
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
        // #261: the dying tray's turn arrives as the chat line "Death saving throw."
        // (DEATH_SAVE_TURN_TEXT). The DM must not be asked to narrate it: the engine
        // owns the d20 and the tallies. Resolve the save here so the roll happens on
        // the hero's turn even when the client's dice prompt never fires.
        if (typeof playerInput === 'string' && playerInput.trim() === DEATH_SAVE_TURN_TEXT) {
          const deathSaveOutcome = await resolveDeathSaveTurn(sessionId, userId);
          if (deathSaveOutcome) return deathSaveOutcome;
          // No active dying turn: fall through to normal generation rather than
          // erroring. The DM will see an out-of-context line and can ask for
          // clarification.
        }
        const combatIntentPrefilterMatched =
          typeof playerInput === 'string' && looksLikeCombatIntent(playerInput);
        let declaredAttack: Awaited<ReturnType<typeof detectDeclaredAttack>> = null;
        let untargetedSpellRoster: Awaited<ReturnType<typeof loadCombatIntentActorRoster>> | null =
          null;
        // GP-060 (#313): the damaging spell cast with no resolvable target, for the DM
        // directive and the opening-action attachment below. Set only when the scene
        // roster is non-empty.
        let untargetedSpell: UntargetedAttackSpell | null = null;
        if (
          combatEntry?.sessionId &&
          typeof playerInput === 'string' &&
          combatIntentPrefilterMatched
        ) {
          const actors = await loadCombatIntentActorRoster(combatEntry.sessionId, userId);
          declaredAttack = detectDeclaredAttack(playerInput, actors);
          // "At him" points at a creature the DM may have just introduced; only a cast that names
          // nothing (the sheet's) is checked against the roster.
          const detectedSpell = declaredAttack ? null : detectUntargetedAttackSpell(playerInput);
          if (detectedSpell && !detectedSpell.pronoun) {
            untargetedSpellRoster = actors;
            if (actors.length > 0) untargetedSpell = detectedSpell;
          }
        }
        if (combatEntry?.sessionId && !declaredAttack) {
          logger.info({
            msg: 'COMBAT_INTENT_NO_DECLARATION',
            sessionId: combatEntry.sessionId,
            prefilter: combatIntentPrefilterMatched,
            detector: declaredAttack,
          });
        }
        // #262: a defensive declaration in plain text ("I dodge", "I yield") — the DM's
        // inline options send the option text as chat, and without this the engine never
        // sees the intent. Direct the DM to emit the structured combat_action.
        // The in-combat signal is a live encounter for this session: the combatEntry the
        // client sends is only present when combat is NOT active, so gating on it means
        // the directive never fires mid-fight.
        const defenseSessionId =
          typeof sessionId === 'string' && sessionId.length > 0
            ? sessionId
            : typeof combatEntry?.sessionId === 'string'
              ? combatEntry.sessionId
              : null;
        let declaredDefense: DefensiveDeclaration | null = null;
        if (defenseSessionId && typeof playerInput === 'string' && !declaredAttack) {
          try {
            // Dynamic import: CombatEncounterService pulls in the database client at
            // import time. Loading it lazily keeps the route importable in tests that
            // don't mock the database (same pattern as the party-defeated check above).
            const { CombatEncounterService } =
              await import('../../services/combat/combat-encounter-service.js');
            const activeEncounter = await CombatEncounterService.getActiveEncounter(
              defenseSessionId,
              userId,
            );
            if (activeEncounter) declaredDefense = detectDeclaredDefense(playerInput);
          } catch {
            declaredDefense = null;
          }
        }
        // #712: a typed Lay on Hands in combat resolves against the pool before the
        // DM narrates, so the reply carries the engine's truth (the healing or the
        // clear refusal) instead of ignoring or inventing it. Not gated on
        // !declaredAttack: the QA case combined it with an attack in one line.
        // Gated on dmReply: narration regens carry no dmReply, and resolving
        // twice would spend the pool twice.
        // Dynamic import: the resolver pulls in the database client at load time.
        let layOnHandsDirective: string | null = null;
        if (dmReply && defenseSessionId && typeof playerInput === 'string') {
          try {
            const { resolveCombatLayOnHands } =
              await import('../../services/dm/combat-lay-on-hands.js');
            layOnHandsDirective = await resolveCombatLayOnHands({
              playerInput,
              sessionId: defenseSessionId,
              userId,
            });
          } catch {
            layOnHandsDirective = null;
          }
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
        const llmPromptBase = declaredAttack
          ? appendDeclaredAttackDirective(prompt, declaredAttack.actorName, encounterDirective)
          : declaredDefense
            ? appendDeclaredDefenseDirective(prompt, declaredDefense)
            : untargetedSpell
              ? appendUntargetedSpellDirective(prompt, untargetedSpell.name)
              : prompt;
        const llmPrompt = layOnHandsDirective
          ? `${llmPromptBase}\n\n${layOnHandsDirective}`
          : llmPromptBase;

        const generateOnce = (): Promise<LLMResponse> =>
          LLMProviderService.generate({
            prompt: llmPrompt,
            // #352: the stable system block, as the `system` message.
            systemPrompt: typeof systemPrompt === 'string' ? systemPrompt : undefined,
            model: safeModel,
            maxTokens: safeMaxTokens,
            temperature,
            history,
            provider,
            responseSchema,
            // #633 PR2: stream provider tokens when the client opted in; the
            // full text still accumulates, so retry and everything downstream
            // behave exactly as non-streaming.
            ...(onToken ? { onToken } : {}),
            ...(onAttemptStart ? { onAttemptStart } : {}),
          });
        let result = await generateOnce();
        // #312: one bounded retry on a retryable storyteller failure before the turn degrades.
        // A single transient timeout on the turn that ends a fight (or resolves a check) used to
        // lose the reply, the XP award and the persisted DM row with no recovery — the client was
        // told to "try your action again" after the moment had passed (GP-069).
        // #350: never retry a key-limit failure — the key is dead, so a retry
        // only burns up to 5s (e.g. into a still-open breaker) for nothing.
        if (isRetryableGenerateResult(result) && !isKeyLimitResult(result)) {
          const waitMs = Math.min(5_000, Math.max(0, Math.round((result.retryAfter ?? 1) * 1000)));
          logger.warn({
            msg: 'LLM_GENERATE_RETRY',
            sessionId: sessionId ?? combatEntry?.sessionId ?? null,
            provider: result.provider ?? provider,
            status: result.status ?? null,
            waitMs,
          });
          if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
          result = await generateOnce();
        }
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
          playerInput,
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
          // Remember only on generate. The declared-attack hold confirms before
          // this route runs; storing there would drop the generate that follows.
          holdPending: async (pending) => {
            const holdSessionId = combatEntry?.sessionId;
            if (!holdSessionId) return 'keep';
            const { holdOrDropPending } =
              await import('../../services/combat/pending-combat-entry.js');
            return holdOrDropPending(holdSessionId, userId, pending);
          },
        });
        // GP-060 (#313): the DM named the creature the untargeted spell was aimed at, so
        // the cast becomes the declared attack: the engine resolves it as the opening
        // action when the player confirms the entry, exactly like a declared attack.
        if (untargetedSpell && untargetedSpellRoster && !declaredAttack) {
          result = {
            ...result,
            text: attachUntargetedSpellAttack(result.text, untargetedSpell, untargetedSpellRoster),
          };
        }
        // #2718: a feature or spell the player claims and their character lacks is refused here,
        // before the reply is persisted or returned, so it applies nothing and spends nothing.
        let allowedCasts: AllowedCasts | null = null;
        let concentrationCastsRefused = false;
        let allowedFeatures: AllowedFeatures | null = null;
        if (dmReply) {
          result = await refuseFeaturesCharacterLacks({
            result,
            userId,
            sessionId: sessionId ?? combatEntry?.sessionId,
            playerInput,
            inCombat: dmReply.inCombat === true,
            clientCharacterId: combatEntry?.player?.characterId ?? null,
            onCastsAllowed: (casts) => {
              allowedCasts = casts;
            },
            onCastsRefused: () => {
              concentrationCastsRefused = true;
            },
            onFeaturesAllowed: (features) => {
              allowedFeatures = features;
            },
          });
        }

        if (result.error) {
          // #350: a provider key/credit limit is not the player's fault. Say so
          // plainly, and give back the quota unit this turn consumed — the turn
          // never reached a model, so the player must not pay for the outage.
          const keyLimit = isKeyLimitResult(result);
          logger.error({
            msg: 'LLM_GENERATE_DEGRADED',
            error: result.error,
            status: result.status,
            provider: result.provider,
            model: result.model,
            ...(keyLimit ? { keyLimit: true } : {}),
          });
          const degradedEnvelope = keyLimit
            ? keyLimitDegradedEnvelope()
            : degradedGenerateEnvelope();
          if (keyLimit) {
            try {
              await AIUsageService.refundQuota({ userId, plan, type: quotaType, units: 1 });
            } catch (refundError) {
              logger.error({ msg: 'LLM_GENERATE_KEY_LIMIT_REFUND_FAILED', error: refundError });
            }
          }
          logEnvelopeShape(null, degradedEnvelope.text, sessionId ?? combatEntry?.sessionId, true);
          set.status = 200;
          return degradedEnvelope;
        }

        // #709: a concentration spell cast via the sheet's Cast button (or typed
        // with the [spell_id=...] tag) starts concentration. The DM narrates
        // utility spells without touching the combat engine, so without this the
        // character_concentration row is never created and damage never prompts
        // a CON save. Placed AFTER the provider reply succeeds (not just after
        // the quota/terminal gates): a cast the DM never answers — provider
        // error or degraded envelope above — must not start concentration.
        // The #2718 gate above refuses without setting result.error, so its
        // refusal reaches the hook through concentrationCastsRefused. Runs on
        // player intent once the reply is confirmed; a DB failure must not
        // break chat.
        try {
          await maybeStartConcentrationAfterReply(playerInput ?? prompt, sessionId, {
            allowedCasts,
            replyError: result.error,
            castsRefused: concentrationCastsRefused,
            gateRan: Boolean(dmReply),
          });
        } catch (concentrationError) {
          logger.warn({
            msg: 'LLM_GENERATE_CONCENTRATION_START_FAILED',
            sessionId: sessionId ?? null,
            error:
              concentrationError instanceof Error
                ? concentrationError.message
                : String(concentrationError),
          });
        }

        if (result.usage && result.provider) {
          const usageDetailId = await AIUsageService.recordProviderUsage({
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
          if (typeof usageDetailId === 'number') usageIds.push(usageDetailId);
          // #352: per-turn prompt-cache accounting, log-only (no storage).
          // `cachedTokens` > 0 means the stable system prefix was served from
          // the provider's cache this turn. Only requests that carried a
          // `systemPrompt` (the DM turn) emit the line, so non-DM generations
          // (narration regen, memory extraction) don't dilute the hit rate.
          // The hit rate over these lines is the number #352's "done when"
          // asks for after deploy.
          if (systemPrompt) {
            const cachedTokens = result.usage.cachedInputTokens ?? 0;
            logger.info({
              msg: 'LLM_CACHE_TOKENS',
              sessionId: sessionId ?? combatEntry?.sessionId ?? null,
              provider: result.provider,
              model: result.model ?? safeModel ?? null,
              inputTokens: result.usage.inputTokens,
              cachedTokens,
              cacheWriteTokens: result.usage.cacheWriteTokens ?? 0,
            });
          }
        }

        // One parse, shared by the log line and the narration rewrite. (#2050 G)
        const envelope = parseLlmEnvelope(result.text);
        preserveDeclaredToolCheck(envelope, playerInput ?? '');
        // #266: the engine's verdict for the turn is authoritative. If the narration
        // contradicts the latest roll outcome (a failed check narrated as a success, or an
        // engine hit narrated as a miss), only the contradicting sentences are replaced with
        // the engine's truth — the rest of the reply is the DM's legitimate prose and stays.
        // Fails open: a check that cannot run keeps the reply.
        let outcomeRepaired = false;
        if (
          envelope &&
          typeof envelope.text === 'string' &&
          (sessionId ?? combatEntry?.sessionId)
        ) {
          try {
            const { repairNarrationContradiction } =
              await import('../../services/dm/narration-outcome.js');
            const repaired = await repairNarrationContradiction({
              sessionId: (sessionId ?? combatEntry?.sessionId) as string,
              text: envelope.text,
              // The client sends the player character's name on combatEntry (body schema
              // below); it anchors miss/success claims on the player's own action. Absent
              // out of combat, where the "you" patterns still apply.
              characterName: combatEntry?.player?.name,
            });
            if (repaired) {
              // The spliced text supersedes the model's segments: they were derived from the
              // contradicted wording.
              envelope.text = repaired;
              envelope.narration_segments = [];
              result = { ...result, text: JSON.stringify(envelope) };
              outcomeRepaired = true;
            }
          } catch (error) {
            logger.warn({ msg: 'DM_NARRATION_OUTCOME_HOOK_FAILED', error });
          }
        }
        // #266 (NT-011/NT-020): a reply that REQUESTS a roll must not narrate that roll's
        // outcome in the same breath — the narration posts before the dice exist, and when
        // the roll then contradicts it, no outcome gate ever runs on that earlier text
        // (the repair above needs a persisted outcome; the requesting turn has none yet).
        // Runs only when the turn has NO fresh roll outcome: when one exists, its
        // verdicts are the outcome repair's business (above) — and this pass stays out
        // even when the narration agreed with the outcome and that repair did not fire.
        // That deliberately concedes the combined shape (a correct recap of the fresh
        // outcome plus a premature claim about a newly requested roll in one reply):
        // the recap is correct narration, and a pass that cannot tell the two apart
        // must not risk splicing it (#959 forward-fix — the unscoped pass did exactly
        // that to decided-roll recaps). One repair per turn either way. Keys on the
        // envelope's own roll_requests; the outcome read fails open (an unreadable
        // outcome is treated as none, and the pass runs as it always has).
        // Short-circuit (self-review MEDIUM 4): with no verdict-bearing roll request
        // the pass below is a no-op, so don't pay its outcome read on every turn.
        const hasVerdictRequest =
          Array.isArray(envelope?.roll_requests) &&
          envelope.roll_requests.some(
            (request) =>
              !!request &&
              typeof request === 'object' &&
              ['check', 'save', 'attack'].includes(String((request as { type?: unknown }).type)),
          );
        if (
          envelope &&
          typeof envelope.text === 'string' &&
          !outcomeRepaired &&
          hasVerdictRequest
        ) {
          try {
            const { latestRollOutcome, repairPrematureRollClaims } =
              await import('../../services/dm/narration-outcome.js');
            const turnSessionId = sessionId ?? combatEntry?.sessionId;
            const freshOutcome = turnSessionId
              ? await latestRollOutcome(turnSessionId).catch(() => null)
              : null;
            if (!freshOutcome) {
              const repairedPending = repairPrematureRollClaims(
                envelope.text,
                envelope.roll_requests,
                combatEntry?.player?.name,
              );
              if (repairedPending) {
                envelope.text = repairedPending;
                envelope.narration_segments = [];
                result = { ...result, text: JSON.stringify(envelope) };
              }
            }
          } catch (error) {
            logger.warn({ msg: 'DM_NARRATION_PREMATURE_HOOK_FAILED', error });
          }
        }
        // #218 step 1: a cast the gate allowed spends its slot, server-side, once per player
        // message. Not when combat is opening: the engine spends for the opening cast. Not when the
        // body carries no `combatEntry` out of combat: the player declined a held entry (#2341) and
        // nothing was cast. A spend that fails is logged; it never costs the player their turn.
        const castsToSpend = allowedCasts as AllowedCasts | null;
        const castSessionId = sessionId ?? combatEntry?.sessionId;
        if (castsToSpend && castSessionId && combatEntry && !envelope?.combat_entry_pending) {
          try {
            const { spendStorySpellSlots } = await import('../../services/dm/story-spell-slots.js');
            await spendStorySpellSlots({
              userId,
              sessionId: castSessionId,
              playerInput: playerInput ?? '',
              casts: castsToSpend,
            });
          } catch (error) {
            logger.warn({ msg: 'DM_STORY_SLOT_SPEND_FAILED', sessionId: castSessionId, error });
          }
        }
        // #712: a feature the gate allowed spends its uses, server-side, once per player
        // message — a Retry replays the same saved player message, and a usage-log row
        // for the feature at or after it means the message already spent it (the slot
        // spend's `since` rule, on the feature usage log). Out of combat only (in combat
        // the engine resolves Lay on Hands pre-generation), and never on a turn that
        // opens combat. A spend that fails is logged; it never costs the player their turn.
        // Polarity note: `combatEntry` is the client-sent entry context, present only when
        // combat is NOT already active; `combat_entry_pending` marks the turn that opens
        // combat. So `combatEntry && !envelope?.combat_entry_pending` is an ordinary story turn.
        const featuresToSpend = allowedFeatures as AllowedFeatures | null;
        if (featuresToSpend && castSessionId && combatEntry && !envelope?.combat_entry_pending) {
          try {
            const { spendStoryFeatureUses } =
              await import('../../services/dm/story-feature-uses.js');
            await spendStoryFeatureUses({
              userId,
              sessionId: castSessionId,
              playerInput: playerInput ?? '',
              character: featuresToSpend.character,
              features: featuresToSpend.features,
            });
          } catch (error) {
            logger.warn({ msg: 'DM_STORY_FEATURE_SPEND_FAILED', sessionId: castSessionId, error });
          }
        }
        // #218 step 2: XP the story awards reaches the sheet, server-side, once per player message.
        // Out of combat only, with the same skips as the slot spend above, and never on a turn that
        // asks for a roll. A refused turn carries no `xp_award`: the gate's refusal envelope drops it.
        // Steps 3+4 below share the same guards: items the story grants/takes and conditions it
        // applies/removes reach the sheet the same way.
        const rollRequests = envelope?.roll_requests;
        const rollRequested = Array.isArray(rollRequests) && rollRequests.length > 0;
        if (
          envelope?.xp_award &&
          dmReply &&
          dmReply.inCombat !== true &&
          castSessionId &&
          combatEntry &&
          !envelope.combat_entry_pending
        ) {
          try {
            const { awardStoryXp } = await import('../../services/dm/story-xp.js');
            await awardStoryXp({
              userId,
              sessionId: castSessionId,
              xpAward: envelope.xp_award,
              rollRequested,
            });
          } catch (error) {
            logger.warn({ msg: 'DM_STORY_XP_AWARD_FAILED', sessionId: castSessionId, error });
          }
        }
        // #218 steps 3+4: items the story grants or takes, and conditions it applies or removes
        // out of combat, reach the sheet, server-side, once per player message. A failed write
        // is logged; it never costs the player their turn.
        if (
          (envelope?.items || envelope?.conditions) &&
          dmReply &&
          dmReply.inCombat !== true &&
          castSessionId &&
          combatEntry &&
          !envelope.combat_entry_pending
        ) {
          try {
            if (envelope.items) {
              const { applyStoryItems } = await import('../../services/dm/story-items.js');
              await applyStoryItems({
                userId,
                sessionId: castSessionId,
                items: envelope.items,
                rollRequested,
              });
            }
            if (envelope.conditions) {
              const { applyStoryConditions } =
                await import('../../services/dm/story-conditions.js');
              await applyStoryConditions({
                userId,
                sessionId: castSessionId,
                conditions: envelope.conditions,
                rollRequested,
              });
            }
          } catch (error) {
            logger.warn({ msg: 'DM_STORY_STATE_APPLY_FAILED', sessionId: castSessionId, error });
          }
        }
        // #264 (#218 step 5): a rest the story grants out of combat reaches the sheet
        // through RestService — the same ruleset the sheet's rest buttons use — once per
        // player message. A refused rest is logged inside the applier; it never costs
        // the player their turn.
        if (
          envelope &&
          dmReply &&
          dmReply.inCombat !== true &&
          castSessionId &&
          combatEntry &&
          !envelope.combat_entry_pending
        ) {
          try {
            const { applyStoryRest } = await import('../../services/dm/story-rest.js');
            await applyStoryRest({
              userId,
              sessionId: castSessionId,
              rest: envelope.rest,
              rollRequested,
            });
          } catch (error) {
            logger.warn({ msg: 'DM_STORY_REST_APPLY_FAILED', sessionId: castSessionId, error });
          }
        }
        // #610 (#218 step 6): damage the story deals out of combat reaches the sheet
        // through applyNonAttackDamage — the same writer the client damage route uses —
        // once per player message, with the same guards as the other story appliers. A
        // failed write is logged; it never costs the player their turn.
        // #768 FIX round 5: the client's narration gate treats a populated `damage`
        // field as "the engine applied this". Track whether the applier applied; any
        // turn where it did not — skipped gate, rejected claim, deferred roll, throw —
        // ends with the field nulled, so the client never treats an unapplied claim
        // as engine-applied. The response text is the parsed envelope, so the client
        // sees the nulled field.
        let storyDamageApplied = false;
        if (
          envelope?.damage &&
          dmReply &&
          dmReply.inCombat !== true &&
          castSessionId &&
          combatEntry &&
          !envelope.combat_entry_pending
        ) {
          try {
            const { applyStoryDamage } = await import('../../services/dm/story-damage.js');
            const outcome = await applyStoryDamage({
              userId,
              sessionId: castSessionId,
              damage: envelope.damage,
              rollRequested,
            });
            storyDamageApplied = outcome === 'applied' || outcome === 'already_applied';
          } catch (error) {
            logger.warn({ msg: 'DM_STORY_DAMAGE_FAILED', sessionId: castSessionId, error });
          }
        }
        if (envelope?.damage && !storyDamageApplied) {
          envelope.damage = null;
        }
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
          // #841: record this reply's action batches under its message id, so
          // the corrective reprompts in the handout-actions and
          // tactical-map/dm-actions routes can only ever correct actions the
          // DM actually produced for this session.
          recordDmTurnActions({
            sessionId: dmSessionId,
            messageId: dmReply.messageId,
            handoutActions: Array.isArray(envelope?.handout_actions)
              ? envelope.handout_actions
              : [],
            mapActions: Array.isArray(envelope?.map_actions) ? envelope.map_actions : [],
          });
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
            const watchdog = {
              sessionId: dmSessionId,
              messageId: dmReply.messageId,
              reason: persistence.reason ?? 'unknown',
              generatedAt,
              // #783: the server keeps the envelope so the watchdog can persist
              // a fallback row if the client never saves this reply.
              envelope,
              userId,
            };
            const schedule = () => {
              void scheduleDmReplyWatchdog(watchdog);
            };
            if (!deferUntilCommit(schedule)) schedule();
          }
        }

        // #913: an initiative result sent as this turn seats the stored proposal
        // and the reply no longer asks the client to enter again.
        let responseText = result.text;
        const entrySessionId = combatEntry?.sessionId;
        if (entrySessionId && combatEntry?.player && playerInput) {
          try {
            const {
              initiativeRollFromPlayerInput,
              seatStoredPendingEntry,
              withoutCombatEntryPending,
            } = await import('../../services/combat/pending-combat-entry.js');
            const initiativeRoll = initiativeRollFromPlayerInput(playerInput);
            if (initiativeRoll != null) {
              const seated = await seatStoredPendingEntry({
                sessionId: entrySessionId,
                userId,
                player: combatEntry.player,
                playerInitiativeRoll: initiativeRoll,
              });
              if (seated) responseText = withoutCombatEntryPending(result.text);
            }
          } catch (seatError) {
            logger.warn({
              msg: 'COMBAT_ENTRY_INITIATIVE_SEAT_FAILED',
              sessionId: entrySessionId,
              error: seatError instanceof Error ? seatError.message : String(seatError),
            });
          }
        }

        return {
          // #350 FIX round 2: parsed reflects whether the model text actually
          // parsed — the deploy smoke asserts parsed=true, so a hardcoded true
          // would let a prose-only (null envelope) reply pass the check.
          parsed: envelope !== null,
          text: rewriteNarrationSegmentsFromEnvelope(
            responseText === result.text ? envelope : parseLlmEnvelope(responseText),
            responseText,
          ),
          provider: result.provider,
          model: result.model,
          usageIds,
          ...(dmReply ? { dmReplyPersisted } : {}),
          // #841: the DM reply id is echoed on every recorded turn — not only on
          // roll-guarded ones — because the handout-actions and
          // tactical-map/dm-actions routes bind their corrective reprompts to
          // it. On the guarded path dmReply.messageId was already reassigned
          // to canonicalMessageId before this, so the fallback only fires for
          // ordinary turns, where persistence used the client-supplied id.
          ...(dmReply && dmSessionId
            ? { dmReplyMessageId: canonicalMessageId ?? dmReply.messageId }
            : {}),
        };
      };
      const runTurn = (onToken?: (text: string) => void, onAttemptStart?: () => void) => {
        if (
          sessionId &&
          (dmReply || requestedPlayerInput || extractPlayerInputFromPrompt(prompt))
        ) {
          return (async () => {
            const { SessionMessageService } =
              await import('../../services/session/session-message-service.js');
            try {
              return await SessionMessageService.withRollTurn(
                sessionId,
                user.userId,
                requestedPlayerInput?.trim() || extractPlayerInputFromPrompt(prompt),
                dmReply?.rollRequestId,
                dmReply?.messageId,
                (replyId) => {
                  if (replyId) dmReply = { ...dmReply, messageId: replyId };
                  return generateTurn(replyId, onToken, onAttemptStart);
                },
              );
            } catch (error) {
              const { AppError } = await import('../../lib/errors.js');
              if (!(error instanceof AppError)) throw error;
              // SSE mode: headers are already sent, so the error travels as
              // an event instead of an HTTP status.
              if (stream === true) throw error;
              set.status = error.statusCode;
              return { error: error.message };
            }
          })();
        }
        return generateTurn(undefined, onToken, onAttemptStart);
      };
      // #633 PR2: opt-in streaming. Provider tokens stream out as narration
      // `delta` events while the full response accumulates and runs the
      // identical pipeline (retry, contract enforcement, parse, persistence).
      // The final `done` event's payload matches the non-streaming JSON
      // response shape exactly.
      if (stream === true) {
        const encoder = new TextEncoder();
        const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
        const writer = writable.getWriter();
        const sendEvent = (event: Record<string, unknown>): void => {
          void writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)).catch(() => {
            // The client went away; the turn still completes server-side.
          });
        };
        let streamedRaw = '';
        let emittedNarration = '';
        // #633: a rejected attempt's deltas must not stay in the preview. Reset
        // the server accumulators and tell the client to clear its preview.
        const onAttemptStart = (): void => {
          streamedRaw = '';
          emittedNarration = '';
          sendEvent({ type: 'reset' });
        };
        const onToken = (delta: string): void => {
          streamedRaw += delta;
          const narration = extractPartialNarration(streamedRaw);
          if (
            narration !== null &&
            narration.length > emittedNarration.length &&
            narration.startsWith(emittedNarration)
          ) {
            const fresh = narration.slice(emittedNarration.length);
            emittedNarration = narration;
            sendEvent({ type: 'delta', text: fresh });
          }
        };
        void (async () => {
          try {
            const payload = await runTurn(onToken, onAttemptStart);
            // #849: the streamed turn produced its reply — delivery confirmed.
            // (AppErrors throw out of runTurn in stream mode and land in the
            // error path below, so they never confirm.)
            if (tacticalDeliverySucceeded(payload)) confirmTacticalDelivery();
            sendEvent({ type: 'done', payload });
          } catch (error) {
            const { AppError } = await import('../../lib/errors.js');
            if (error instanceof AppError) {
              // #783: AppError turns had no log line — the SSE error event was
              // invisible in the server logs. Log it here with the session id.
              logger.error({
                msg: 'LLM_GENERATE_SSE_ERROR',
                sessionId: sessionId ?? null,
                statusCode: error.statusCode,
                message: error.message,
              });
              sendEvent({ type: 'error', message: error.message, statusCode: error.statusCode });
            } else {
              logger.error({ msg: 'LLM_GENERATE_STREAM_FAILED', error });
              // #783: log the SSE error event for non-AppError failures too.
              logger.error({
                msg: 'LLM_GENERATE_SSE_ERROR',
                sessionId: sessionId ?? null,
                statusCode: 500,
                message: 'Generation failed',
              });
              sendEvent({ type: 'error', message: 'Generation failed', statusCode: 500 });
            }
          } finally {
            await writer.close().catch(() => {});
          }
        })();
        return new Response(readable, { headers: SSE_HEADERS });
      }
      const payload = await runTurn();
      // #849: only a turn that actually produced a reply confirms delivery — an
      // errored or degraded turn leaves the batch to be re-served (or expire).
      if (tacticalDeliverySucceeded(payload)) confirmTacticalDelivery();
      return payload;
    },
    {
      body: t.Object({
        prompt: t.String(),
        // #352: the stable system block for provider prompt caching. Optional
        // so older clients keep working; absent means the previous behavior.
        systemPrompt: t.Optional(t.String()),
        // #2050 C: correlate the envelope log line to a session on every
        // generate, not only on the combat-entry path.
        sessionId: t.Optional(t.String({ maxLength: 255 })),
        // #849 (audit F19): the delivery token from the tactical-context GET.
        // Optional — older clients never send it, and their facts simply live
        // out the delivery TTL instead of being confirmed.
        tacticalDeliveryToken: t.Optional(t.String({ maxLength: 255 })),
        player_input: t.Optional(t.String({ maxLength: 20_000 })),
        // #2218: the id the client reserved for this turn's DM row. Present only on the main DM
        // turn; the server persists the reply under it when the turn is display-ready.
        dmReply: t.Optional(
          t.Object({
            messageId: t.String({
              pattern:
                '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
            }),
            rollRequestId: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
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
        // #633 PR2: opt-in SSE streaming of the DM turn's narration. Off by
        // default; the client sends `stream: true` to receive
        // `text/event-stream` with progressive narration deltas and a final
        // event carrying the same payload shape as the JSON response.
        stream: t.Optional(t.Boolean()),
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
  );
