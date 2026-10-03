import { Elysia, t } from 'elysia';

import { isUnresolvedNpcName } from '../../../../../shared/unresolved-creature-name';
import { authenticateRequest as defaultAuthenticateRequest } from '../../../lib/auth.js';
import { AppError } from '../../../lib/errors.js';
import { logger } from '../../../lib/logger.js';
import { loadSessionCampaignMonsterIndex as defaultLoadSessionCampaignMonsterIndex } from '../../../services/combat/combat-entry-campaign-index.js';
import { combatEntryGateDeps as defaultCombatEntryGateDeps } from '../../../services/combat/combat-entry-gate-deps.js';
import {
  seatCombatEntry as defaultSeatCombatEntry,
  type CombatEntryGateDeps,
  type CombatEntryPlayer,
  type DerivedCombatant,
  type SeatedCombatEntryOutcome,
} from '../../../services/combat/combat-entry-gate.js';
import { nameUnresolvedCombatants } from '../../../services/combat/combat-entry-unnamed-hostile.js';
import {
  actorsMentionedIn,
  declareSpellAttackOn,
  detectDeclaredAttack,
  detectUntargetedAttackSpell,
  looksLikeCombatIntent,
  type CombatIntentActor,
  type DeclaredAttack,
} from '../../../services/combat/combat-intent-gate.js';
import { loadCombatIntentActorRoster as defaultLoadCombatIntentActorRoster } from '../../../services/combat/combat-intent-roster.js';
import { buildInitiativeOrder as defaultBuildInitiativeOrder } from '../../../services/combat/initiative-order.js';
import { sanitizeSceneSpec as defaultSanitizeSceneSpec } from '../../../services/combat/scene-spec-sanitizer.js';
import { applyCombatEntryGate } from '../../../services/combat-entry-pipeline.js';

const sessionIdParams = t.Object({
  sessionId: t.String({ minLength: 1, maxLength: 255 }),
});

const entryPlayerBody = t.Object({
  characterId: t.Optional(t.Nullable(t.String({ maxLength: 255 }))),
  name: t.String({ minLength: 1, maxLength: 200 }),
  initiativeModifier: t.Number({ minimum: -100, maximum: 100 }),
  hpCurrent: t.Optional(t.Nullable(t.Number({ minimum: 0, maximum: 100_000 }))),
  hpMax: t.Optional(t.Nullable(t.Number({ minimum: 0, maximum: 100_000 }))),
});

const declaredAttackBody = t.Object({
  playerInput: t.String({ minLength: 1, maxLength: 20_000 }),
  player: entryPlayerBody,
  /** The last DM message: which creatures "him" can mean when the spell names no target. */
  recentNarration: t.Optional(t.String({ maxLength: 6_000 })),
  /** The creature the player picked when asked who the spell is for. */
  targetName: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
});

/** Most creatures the popup offers when the narration names none of them. */
const MAX_TARGET_CHOICES = 8;

const sameName = (left: string, right: string): boolean =>
  left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();

type SpellTarget = { attack: DeclaredAttack } | { choices: string[] } | null;

/**
 * An attack spell with no creature the roster can name: "I cast Fire Bolt at him", or the sheet's
 * Cast button, which names none at all. The creatures it can mean are the ones the last DM
 * message names, and only those. With none named, the ones this session has met: its ledger and
 * its map. A campaign NPC the player has not met is offered only when the narration names it
 * (#2415, #2445). "Him" with one candidate is that candidate; no pronoun is the player's to
 * pick, however few there are, so a creature is never chosen for them.
 */
function resolveSpellTarget(
  spell: { id: string; name: string; pronoun?: string },
  actors: readonly CombatIntentActor[],
  body: { targetName?: string; recentNarration?: string },
  sessionId: string,
): SpellTarget {
  if (body.targetName) {
    const chosen = actors.find((actor) => sameName(actor.name, body.targetName ?? ''));
    return chosen ? { attack: declareSpellAttackOn(spell, chosen) } : null;
  }
  const mentioned = actorsMentionedIn(body.recentNarration ?? '', actors);
  const candidates = mentioned.length
    ? mentioned.map((actor) => ({ actor, basis: 'named_in_last_message' }))
    : actors
        .filter((actor) => actor.source === 'ledger' || actor.source === 'map')
        .slice(0, MAX_TARGET_CHOICES)
        .map((actor) => ({ actor, basis: actor.source ?? 'unknown' }));
  logger.debug({
    msg: 'COMBAT_ENTRY_TARGET_CANDIDATES',
    sessionId,
    spellId: spell.id,
    roster: actors.length,
    candidates: candidates.map(({ actor, basis }) => ({
      id: actor.actorSlug ?? actor.slug ?? actor.name,
      basis,
    })),
  });
  if (candidates.length === 0) return null;
  if (candidates.length === 1 && spell.pronoun) {
    return { attack: declareSpellAttackOn(spell, candidates[0].actor) };
  }
  return { choices: candidates.map(({ actor }) => actor.name) };
}

const enterBody = t.Object({
  combatants: t.Array(
    t.Object({
      name: t.String({ minLength: 1, maxLength: 200 }),
      monsterId: t.Optional(t.Nullable(t.String({ minLength: 1, maxLength: 120 }))),
      count: t.Optional(t.Integer({ minimum: 1, maximum: 100 })),
    }),
    { maxItems: 100 },
  ),
  sceneSpec: t.Unknown(),
  player: entryPlayerBody,
  declaredAttack: t.Optional(
    t.Object({
      verb: t.String({ minLength: 1, maxLength: 80 }),
      actorName: t.String({ minLength: 1, maxLength: 200 }),
      actorSlug: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
      monsterId: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
      attackSource: t.Optional(
        t.Union([t.Literal('unarmed'), t.Literal('weapon'), t.Literal('spell')]),
      ),
      weaponName: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
      spellId: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
      spellName: t.Optional(t.String({ minLength: 1, maxLength: 200 })),
    }),
  ),
  playerInitiativeRoll: t.Optional(t.Integer({ minimum: 1, maximum: 20 })),
  seatingHint: t.Optional(
    t.Object({
      targetName: t.String({ minLength: 1, maxLength: 200 }),
      reason: t.Union([t.Literal('conversation'), t.Literal('asset_tag')]),
    }),
  ),
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isPostgresUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!current || typeof current !== 'object') return false;
    if ((current as { code?: unknown }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function mapEntryError(
  set: { status?: number | string },
  error: unknown,
): { error: string; details?: unknown } {
  if (isPostgresUniqueViolation(error)) {
    set.status = 409;
    return { error: 'Combat entry is no longer available' };
  }
  if (error instanceof AppError) {
    set.status = error.statusCode;
    return {
      error: error.statusCode === 404 ? 'Session not found' : error.message,
      ...(error.details ? { details: error.details } : {}),
    };
  }
  set.status = 500;
  return { error: 'Failed to enter combat' };
}

export interface CombatEntryRouteOptions {
  authenticateRequest?: typeof defaultAuthenticateRequest;
  combatEntryGateDeps?: CombatEntryGateDeps;
  seatCombatEntry?: typeof defaultSeatCombatEntry;
  sanitizeSceneSpec?: typeof defaultSanitizeSceneSpec;
  buildInitiativeOrder?: typeof defaultBuildInitiativeOrder;
  loadSessionCampaignMonsterIndex?: typeof defaultLoadSessionCampaignMonsterIndex;
}

export function createCombatEntryRoutes({
  authenticateRequest = defaultAuthenticateRequest,
  combatEntryGateDeps = defaultCombatEntryGateDeps,
  seatCombatEntry = defaultSeatCombatEntry,
  sanitizeSceneSpec = defaultSanitizeSceneSpec,
  buildInitiativeOrder = defaultBuildInitiativeOrder,
  loadSessionCampaignMonsterIndex = defaultLoadSessionCampaignMonsterIndex,
}: CombatEntryRouteOptions = {}) {
  return new Elysia().post(
    '/sessions/:sessionId/enter',
    async ({ request, params, body, set }) => {
      const { user, error: authError } = await authenticateRequest(request);
      if (authError || !user) {
        set.status = 401;
        return { error: authError || 'Unauthorized' };
      }

      if (!UUID_PATTERN.test(params.sessionId)) {
        set.status = 422;
        return { error: 'Invalid session id', detail: 'sessionId must be a uuid' };
      }

      const sanitized = sanitizeSceneSpec(body.sceneSpec, params.sessionId);
      if (!sanitized.ok) {
        set.status = 422;
        return { error: 'Invalid combat entry payload', detail: sanitized.detail };
      }

      const player: CombatEntryPlayer = {
        characterId: body.player.characterId ?? null,
        name: body.player.name.trim(),
        initiativeModifier: body.player.initiativeModifier,
        ...(body.player.hpCurrent != null ? { hpCurrent: body.player.hpCurrent } : {}),
        ...(body.player.hpMax != null ? { hpMax: body.player.hpMax } : {}),
      };

      // No participant is seated as a placeholder (#2532). The pending entry the server hands out
      // is already named; this stops a body that is not (an older client's, a forged one). With a
      // declared attack the declared target is the creature: a placeholder beside it is dropped,
      // never named from prose (the gate skips naming for a declared attack as well).
      const posted: DerivedCombatant[] = body.combatants.map((combatant) => ({
        name: combatant.name.trim(),
        ...(combatant.monsterId ? { monsterId: combatant.monsterId } : {}),
        count: combatant.count ?? 1,
      }));
      const combatants: DerivedCombatant[] = body.declaredAttack
        ? posted.filter((combatant) => !isUnresolvedNpcName(combatant.name))
        : await nameUnresolvedCombatants({
            combatants: posted,
            prose: sanitized.sceneSpec.sceneDescription ?? '',
            playerName: player.name,
            loadIndex: () => loadSessionCampaignMonsterIndex(params.sessionId, user.userId),
          });
      if (combatants.length === 0) {
        logger.info({ msg: 'COMBAT_ENTRY_UNNAMED_HOSTILE_REFUSED', sessionId: params.sessionId });
        set.status = 422;
        return {
          error: 'Invalid combat entry payload',
          detail: 'combatants must name at least one creature',
        };
      }

      try {
        const outcome = await seatCombatEntry(
          {
            sessionId: params.sessionId,
            userId: user.userId,
            player,
            combatants,
            sceneSpec: sanitized.sceneSpec,
            playerInitiativeRoll: body.playerInitiativeRoll,
            declaredAttack: body.declaredAttack,
            seatingHint: body.seatingHint,
          },
          combatEntryGateDeps,
        );
        if (!outcome) {
          set.status = 409;
          return { error: 'Combat entry is no longer available' };
        }

        set.status = 201;
        return enterResponse(outcome, buildInitiativeOrder);
      } catch (error) {
        return mapEntryError(set, error);
      }
    },
    { params: sessionIdParams, body: enterBody },
  );
}

function enterResponse(
  outcome: SeatedCombatEntryOutcome,
  buildInitiativeOrder: typeof defaultBuildInitiativeOrder,
) {
  const combatState = outcome.combatState;
  return {
    ...combatState,
    initiativeOrder: buildInitiativeOrder(
      combatState as Parameters<typeof buildInitiativeOrder>[0],
    ),
    seatingTranscript: outcome.seatingTranscript,
    ...(outcome.notice ? { notice: outcome.notice } : {}),
    ...(outcome.firstAction ? { first_action: outcome.firstAction } : {}),
  };
}

export const entryRoutes = createCombatEntryRoutes();

export interface DeclaredAttackRouteOptions {
  authenticateRequest?: typeof defaultAuthenticateRequest;
  loadCombatIntentActorRoster?: typeof defaultLoadCombatIntentActorRoster;
}

/**
 * #2341: the pending entry for a message that names an attack, before the DM is called.
 *
 * The popup has to open before any DM text exists, so the client asks here first. This is the
 * detector `/v1/llm/generate` runs, on the same roster, with no model call in between; a message
 * that names no attack on a known creature answers `{ pending: null }`.
 */
export function createDeclaredAttackRoutes({
  authenticateRequest = defaultAuthenticateRequest,
  loadCombatIntentActorRoster = defaultLoadCombatIntentActorRoster,
}: DeclaredAttackRouteOptions = {}) {
  return new Elysia().post(
    '/sessions/:sessionId/declared-attack',
    async ({ request, params, body, set }) => {
      const { user, error: authError } = await authenticateRequest(request);
      if (authError || !user) {
        set.status = 401;
        return { error: authError || 'Unauthorized' };
      }

      if (!UUID_PATTERN.test(params.sessionId)) {
        set.status = 422;
        return { error: 'Invalid session id', detail: 'sessionId must be a uuid' };
      }

      if (!looksLikeCombatIntent(body.playerInput)) return { pending: null };
      const actors = await loadCombatIntentActorRoster(params.sessionId, user.userId);
      let declaredAttack = detectDeclaredAttack(body.playerInput, actors);
      let targetChoice: { spellName: string; candidates: string[] } | undefined;
      if (!declaredAttack) {
        const spell = detectUntargetedAttackSpell(body.playerInput);
        const target = spell ? resolveSpellTarget(spell, actors, body, params.sessionId) : null;
        if (!spell || !target) return { pending: null };
        if ('choices' in target) {
          targetChoice = { spellName: spell.name, candidates: target.choices };
        } else {
          declaredAttack = target.attack;
        }
      }
      if (!declaredAttack) return { pending: null, targetChoice };

      const gated = await applyCombatEntryGate({
        result: { text: JSON.stringify({ text: '' }) },
        userId: user.userId,
        combatEntry: {
          sessionId: params.sessionId,
          player: {
            characterId: body.player.characterId ?? null,
            name: body.player.name.trim(),
            initiativeModifier: body.player.initiativeModifier,
            ...(body.player.hpCurrent != null ? { hpCurrent: body.player.hpCurrent } : {}),
            ...(body.player.hpMax != null ? { hpMax: body.player.hpMax } : {}),
          },
        },
        declaredAttack,
      });
      const envelope = JSON.parse(gated.text) as { combat_entry_pending?: unknown };
      return { pending: envelope.combat_entry_pending ?? null };
    },
    { params: sessionIdParams, body: declaredAttackBody },
  );
}

export const declaredAttackRoutes = createDeclaredAttackRoutes();
