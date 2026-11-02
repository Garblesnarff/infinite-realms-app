import { Elysia, t } from 'elysia';

import { PLAYER_INPUT_MAX_CHARS } from '../../../../../shared/player-input-cap';
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
import { runNpcTurnsIfNpcHolds as defaultRunNpcTurns } from '../../../services/combat/npc-turn-drain.js';
import {
  clearPendingCombatEntry,
  liftCombatEntryDecline,
  readPendingCombatEntry,
  recordCombatEntryDecline,
} from '../../../services/combat/pending-combat-entry.js';
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
  playerInput: t.String({ minLength: 1, maxLength: PLAYER_INPUT_MAX_CHARS }),
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

/**
 * Who "him" or a title that matches nobody can mean (#862). The last message wins when it
 * names one creature. Otherwise the one creature this session has met (ledger or map; a
 * missing source counts as met, so a fixture roster stays present). The whole campaign cast
 * is not that creature. One actor on the roster, of any source, still is.
 */
function attackAntecedent(
  actors: readonly CombatIntentActor[],
  recentNarration: string | undefined,
): CombatIntentActor | null {
  const mentioned = actorsMentionedIn(recentNarration ?? '', actors);
  if (mentioned.length === 1) return mentioned[0] ?? null;
  const present = actors.filter((actor) => actor.source !== 'campaign');
  if (present.length === 1) return present[0] ?? null;
  return actors.length === 1 ? (actors[0] ?? null) : null;
}

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

const combatantBody = t.Object({
  name: t.String({ minLength: 1, maxLength: 200 }),
  monsterId: t.Optional(t.Nullable(t.String({ minLength: 1, maxLength: 120 }))),
  count: t.Optional(t.Integer({ minimum: 1, maximum: 100 })),
});

const enterBody = t.Object({
  /**
   * #913: confirm the proposal the server already stored. Combatants and the
   * scene are filled from that store when the body omits them. A body that
   * still sends them (the hold path, which never stored) is seated as posted.
   */
  fromPending: t.Optional(t.Boolean()),
  combatants: t.Optional(t.Array(combatantBody, { maxItems: 100 })),
  sceneSpec: t.Optional(t.Unknown()),
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
      // #877: detectDeclaredAttack always sets this on a weapon declaration and the
      // client forwards the pending's declaredAttack verbatim; declare the field so
      // the stated weapon is part of the wire contract, not unspecified-field tolerance.
      weaponStated: t.Optional(t.Boolean()),
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
  runNpcTurns?: typeof defaultRunNpcTurns;
}

export function createCombatEntryRoutes({
  authenticateRequest = defaultAuthenticateRequest,
  combatEntryGateDeps = defaultCombatEntryGateDeps,
  seatCombatEntry = defaultSeatCombatEntry,
  sanitizeSceneSpec = defaultSanitizeSceneSpec,
  buildInitiativeOrder = defaultBuildInitiativeOrder,
  loadSessionCampaignMonsterIndex = defaultLoadSessionCampaignMonsterIndex,
  runNpcTurns = defaultRunNpcTurns,
}: CombatEntryRouteOptions = {}) {
  return new Elysia()
    .post(
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

        // Before any read or clear of the stored proposal. A caller who does not
        // own the session must not expire it or wipe it when a fight is live (#913).
        const ownership = await combatEntryGateDeps.verifySessionOwnership(
          params.sessionId,
          user.userId,
        );
        if (!ownership.success) {
          set.status = 404;
          return { error: 'Session not found' };
        }

        const stored = body.fromPending
          ? await readPendingCombatEntry(params.sessionId, user.userId)
          : null;
        const sceneSource = body.sceneSpec ?? stored?.pending.sceneSpec;
        const postedCombatants = body.combatants;
        if (!body.fromPending && (postedCombatants == null || body.sceneSpec == null)) {
          set.status = 422;
          return {
            error: 'Invalid combat entry payload',
            detail: 'combatants and sceneSpec are required',
          };
        }
        if (sceneSource == null || (postedCombatants == null && !stored)) {
          set.status = 409;
          return { error: 'Combat entry is no longer available' };
        }

        const sanitized = sanitizeSceneSpec(sceneSource, params.sessionId);
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
        const declaredAttack = body.declaredAttack ?? stored?.pending.declaredAttack;
        const seatingHint = body.seatingHint ?? stored?.pending.seatingHint;
        const posted: DerivedCombatant[] = (
          postedCombatants ??
          stored?.pending.combatants.map((combatant) => ({
            name: combatant.name,
            monsterId: combatant.monsterId ?? null,
            count: combatant.count,
          })) ??
          []
        ).map((combatant) => ({
          name: combatant.name.trim(),
          ...(combatant.monsterId ? { monsterId: combatant.monsterId } : {}),
          count: combatant.count ?? 1,
        }));
        const combatants: DerivedCombatant[] = declaredAttack
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
              declaredAttack,
              seatingHint,
              ...(stored
                ? {
                    trigger: stored.pending.trigger,
                    detail: stored.pending.detail,
                    sceneSpecSynthesized: stored.pending.sceneSpecSynthesized,
                  }
                : {}),
            },
            combatEntryGateDeps,
          );
          if (!outcome) {
            set.status = 409;
            // Seat already refused: a live encounter, or a session the caller does
            // not own. Clear the proposal only when the encounter read says the
            // fight is live. Bound the read so a database the test process cannot
            // reach still returns the 409.
            const active = await Promise.race([
              combatEntryGateDeps
                .getActiveEncounter(params.sessionId, user.userId)
                .catch(() => null),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 250)),
            ]);
            if (active) await clearPendingCombatEntry(params.sessionId);
            return { error: 'Combat entry is no longer available' };
          }
          await clearPendingCombatEntry(params.sessionId);
          // #1328: a decline must not outlive the fight it declined. If
          // this seat came from a stored pending, its decline (if any)
          // clears so a post-fight re-offer is not suppressed by stale
          // state. (Posted combatants without a stored pending keep any
          // decline — that corner needs the seated key, not just the
          // stored one; the pipeline lift covers the common path.)
          if (stored?.actorKey) {
            await liftCombatEntryDecline(params.sessionId, stored.actorKey);
          }

          // Creatures that won initiative act now, before the player's first action (#2658).
          const npcTurns = await runNpcTurns(outcome.combatState.encounter.id, user.userId);
          set.status = 201;
          return {
            ...enterResponse(outcome, buildInitiativeOrder),
            ...(npcTurns ? { npcTurns } : {}),
          };
        } catch (error) {
          return mapEntryError(set, error);
        }
      },
      { params: sessionIdParams, body: enterBody },
    )
    .delete(
      '/sessions/:sessionId/pending',
      async ({ request, params, set }) => {
        const { user, error: authError } = await authenticateRequest(request);
        if (authError || !user) {
          set.status = 401;
          return { error: authError || 'Unauthorized' };
        }
        if (!UUID_PATTERN.test(params.sessionId)) {
          set.status = 422;
          return { error: 'Invalid session id', detail: 'sessionId must be a uuid' };
        }
        const ownership = await combatEntryGateDeps.verifySessionOwnership(
          params.sessionId,
          user.userId,
        );
        if (!ownership.success) {
          set.status = 404;
          return { error: 'Session not found' };
        }
        // #1328: declining is not forgetting. Read the pending entry's
        // actor key before clearing, so the next turn does not re-offer
        // the same fight until a new hostile act or the player's attack.
        // (No userId: an expired proposal clears silently here; expiry is
        // not a decline and records nothing.)
        const stored = await readPendingCombatEntry(params.sessionId);
        await clearPendingCombatEntry(params.sessionId);
        if (stored?.actorKey) {
          // The 409-cleanup DELETE fires after /enter seated the fight;
          // do not record a decline for a hostile the player is now
          // fighting. Record only when the read positively says no
          // encounter is live: on timeout/error the state is unknown,
          // and a missed record only risks one re-offer (the pre-fix
          // behavior, and the player can decline again), while a false
          // decline would suppress a legitimate post-fight offer.
          const encounter = await Promise.race([
            combatEntryGateDeps
              .getActiveEncounter(params.sessionId, user.userId)
              .then((active) => ({ known: true as const, active }))
              .catch(() => ({ known: false as const, active: null })),
            new Promise<{ known: false; active: null }>((resolve) =>
              setTimeout(() => resolve({ known: false, active: null }), 250),
            ),
          ]);
          if (encounter.known && !encounter.active) {
            await recordCombatEntryDecline(params.sessionId, stored.actorKey);
          }
        }
        return { cleared: true };
      },
      { params: sessionIdParams },
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
    ...(outcome.firstActionRefusal
      ? { first_action_refusal: { reason: outcome.firstActionRefusal.reason } }
      : {}),
  };
}

export const entryRoutes = createCombatEntryRoutes();

export interface DeclaredAttackRouteOptions {
  authenticateRequest?: typeof defaultAuthenticateRequest;
  loadCombatIntentActorRoster?: typeof defaultLoadCombatIntentActorRoster;
  /** When this returns an encounter, the message is a turn inside a fight, not a new entry. */
  getActiveEncounter?: (sessionId: string, userId: string) => Promise<unknown>;
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
  getActiveEncounter,
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
      let declaredAttack = detectDeclaredAttack(body.playerInput, actors, {
        antecedent: attackAntecedent(actors, body.recentNarration),
      });
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
        ...(getActiveEncounter ? { liveEncounter: getActiveEncounter } : {}),
      });
      const envelope = JSON.parse(gated.text) as { combat_entry_pending?: unknown };
      return { pending: envelope.combat_entry_pending ?? null };
    },
    { params: sessionIdParams, body: declaredAttackBody },
  );
}

export const declaredAttackRoutes = createDeclaredAttackRoutes({
  getActiveEncounter: (sessionId, userId) =>
    defaultCombatEntryGateDeps.getActiveEncounter(sessionId, userId),
});
