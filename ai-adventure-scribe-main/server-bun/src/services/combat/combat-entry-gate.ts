/* eslint-disable max-lines -- one cohesive entry decision: detect, derive, synthesize, seat. */
/**
 * Deterministic server-side combat entry gate (#1779).
 *
 * Before this module, entering combat depended entirely on one unconstrained model-authored
 * string — `combat_transition: 'start'` — checked on the CLIENT, and additionally required a
 * co-emitted `scene_spec`. Prod session 5ebaffab put four consecutive hostile actions through
 * the DM (two punches, two grapples) and never entered combat once, while the very same model
 * was emitting a tactical `shove` against the target it claimed it was not fighting. Session
 * 552a0122 entered combat only because the model happened to emit both fields together.
 *
 * The gate makes entry a property of the engine rather than of the narrator. It runs on the
 * turn pipeline, server-side, BEFORE the turn's narration is returned to the client, and it
 * fires when no encounter is active and the DM response shows ANY of three signals:
 *
 *   1. `combat_transition === 'start'`  — the existing signal, now enforced by the server.
 *   2. a tactical/combat action targeting an entity — the model behaving as though a fight
 *      is underway. This is the 03:25:10 shove that was silently dropped as `no_active_map`.
 *   3. an attack-type roll_request — dice that only exist inside combat.
 *
 * One model string stops being a single point of failure because combat *behavior* also
 * triggers entry.
 */
import { GENERIC_NPC_STATS } from './srd-monster-resolution.js';

import type { SceneSpec } from '../../tactical/types.js';
import type { DMMapAction, DMResponse } from '../dm/dm-response-schema.js';

export type CombatEntryReason = 'combat_transition' | 'tactical_action' | 'attack_roll_request';

export interface CombatEntryTrigger {
  reason: CombatEntryReason;
  /** Human-readable evidence, carried into telemetry so an entry is explicable after the fact. */
  detail: string;
}

/** The subset of a DM response the gate reads. Everything else is narration. */
export type CombatEntryResponse = Pick<
  DMResponse,
  'combat_transition' | 'scene_spec' | 'combatants' | 'map_actions' | 'combat_actions'
> &
  Partial<Pick<DMResponse, 'roll_requests' | 'text'>>;

/** The player participant the gate seats. Assembled by the client from the character record. */
export interface CombatEntryPlayer {
  characterId?: string | null;
  name: string;
  initiativeModifier: number;
  hpCurrent?: number | null;
  hpMax?: number | null;
}

const asArray = <T>(value: T[] | undefined | null): T[] => (Array.isArray(value) ? value : []);

/** The entity a map action addresses, whichever field that dialect puts it in. */
export function mapActionTarget(action: DMMapAction): string | null {
  if (action.action === 'forced_move') return action.target?.trim() || null;
  const entityId = (action as { entityId?: string | null }).entityId;
  return typeof entityId === 'string' && entityId.trim() ? entityId.trim() : null;
}

/**
 * Which signal — if any — says this turn belongs inside an encounter.
 *
 * Order is significance order, not preference: the explicit transition is reported when the
 * model asked for it, so telemetry can still distinguish "model asked" from "model was caught".
 */
export function detectCombatEntryTrigger(response: CombatEntryResponse): CombatEntryTrigger | null {
  if (response.combat_transition === 'start') {
    return { reason: 'combat_transition', detail: 'combat_transition="start"' };
  }

  const targetedMapActions = asArray(response.map_actions).filter((action) =>
    Boolean(mapActionTarget(action)),
  );
  if (targetedMapActions.length) {
    const first = targetedMapActions[0];
    return {
      reason: 'tactical_action',
      detail: `map_action ${first.action} -> ${mapActionTarget(first)}`,
    };
  }
  const combatActions = asArray(response.combat_actions);
  if (combatActions.length) {
    return {
      reason: 'tactical_action',
      detail: `combat_action ${combatActions[0].action_type}`,
    };
  }

  // `initiative` is included alongside `attack` deliberately: a model asking for initiative
  // is asking for the encounter it is not allowed to create, and `validateCombatTransitionContract`
  // already treats both as combat dice.
  const combatRoll = asArray(response.roll_requests).find(
    (request) => request.type === 'attack' || request.type === 'initiative',
  );
  if (combatRoll) {
    return {
      reason: 'attack_roll_request',
      detail: `roll_request ${combatRoll.type}: ${combatRoll.purpose || '(no purpose)'}`,
    };
  }

  return null;
}

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** `dishwasher-prime` -> `Dishwasher Prime`. Slugs are all the board ever gives us back. */
const titleize = (slug: string): string =>
  slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ') || 'Hostile Creature';

export interface DerivedCombatant {
  name: string;
  monsterId?: string;
  count: number;
}

/**
 * Who the player is fighting, derived from whatever the response actually named.
 *
 * `combatants` is the authored channel and is used when present. When it is empty — the exact
 * shape of the four missed turns, where the model was shoving an entity it never listed — the
 * hostiles are read out of the entity references the model DID emit. Absent both, a single
 * unnamed hostile is seated rather than refusing entry: synthesis-over-refusal is the house
 * pattern (Balthazar fought at GENERIC_NPC_STATS with `npc_id` NULL and nobody noticed).
 */
export function deriveEntryCombatants(
  response: CombatEntryResponse,
  playerName: string,
): DerivedCombatant[] {
  const authored = asArray(response.combatants)
    .filter((entry) => typeof entry?.name === 'string' && entry.name.trim())
    .map((entry) => ({
      name: entry.name.trim(),
      monsterId:
        typeof entry.monster_id === 'string' && entry.monster_id.trim()
          ? entry.monster_id.trim()
          : undefined,
      count: Math.max(1, Math.floor(Number(entry.count) || 1)),
    }));
  if (authored.length) return authored;

  const playerSlug = slugify(playerName);
  const referenced = new Set<string>();
  for (const action of asArray(response.map_actions)) {
    const target = mapActionTarget(action);
    if (target) referenced.add(slugify(target));
  }
  for (const action of asArray(response.combat_actions)) {
    for (const target of asArray((action as { target_ids?: string[] }).target_ids)) {
      if (typeof target === 'string' && target.trim()) referenced.add(slugify(target));
    }
  }
  referenced.delete(playerSlug);
  referenced.delete('');

  if (referenced.size) {
    return [...referenced].map((slug) => ({ name: titleize(slug), count: 1 }));
  }
  return [{ name: 'Hostile Creature', count: 1 }];
}

/**
 * A minimal, always-valid scene for an entry that arrived without one.
 *
 * Small room, `guarding` placement: of the three placements the generator implements this is
 * the one that puts hostiles nearest the player's entry corner, which is what a fight that
 * began with a thrown punch looks like. Never returns null — a missing scene_spec must not be
 * the reason a declared attack resolves outside the engine.
 */
export function synthesizeSceneSpec(sessionId: string, description?: string): SceneSpec {
  return {
    sessionId,
    environment: 'dungeon_room',
    size: 'small',
    enemyPlacement: 'guarding',
    sceneDescription:
      description?.slice(0, 2_000) ||
      'Combat begins where the characters already stand; no scene was described.',
  };
}

export interface CombatEntryParticipantInput {
  encounterId: string;
  characterId?: string | null;
  npcId?: string | null;
  monsterId?: string;
  name: string;
  initiativeModifier: number;
  hpCurrent?: number | null;
  hpMax?: number | null;
}

/** The start payload the gate hands the encounter service, player first. */
export function buildEntryParticipants(
  player: CombatEntryPlayer,
  combatants: DerivedCombatant[],
): CombatEntryParticipantInput[] {
  const participants: CombatEntryParticipantInput[] = [
    {
      encounterId: '',
      characterId: player.characterId ?? null,
      name: player.name || 'Player',
      initiativeModifier: Number.isFinite(player.initiativeModifier)
        ? player.initiativeModifier
        : 0,
      ...(player.hpCurrent && player.hpCurrent > 0 ? { hpCurrent: player.hpCurrent } : {}),
      ...(player.hpMax && player.hpMax > 0 ? { hpMax: player.hpMax } : {}),
    },
  ];
  for (const combatant of combatants) {
    for (let index = 0; index < combatant.count; index += 1) {
      participants.push({
        encounterId: '',
        name: combatant.count === 1 ? combatant.name : `${combatant.name} ${index + 1}`,
        initiativeModifier: 0,
        ...(combatant.monsterId ? { monsterId: combatant.monsterId } : {}),
      });
    }
  }
  return participants;
}

export interface CombatEntryOutcome {
  entered: true;
  encounterId: string;
  trigger: CombatEntryReason;
  detail: string;
  /** True when the gate had to invent the scene because the model supplied none/an invalid one. */
  sceneSpecSynthesized: boolean;
  sceneSpec: SceneSpec;
  participantCount: number;
}

/**
 * Everything the gate touches, injected so the decision is testable without a database.
 * The concrete wiring lives in `combat-entry-gate-deps.ts`.
 */
export interface CombatEntryGateDeps {
  getActiveEncounter: (
    sessionId: string,
    userId: string,
  ) => Promise<{ id: string } | undefined | null>;
  verifySessionOwnership: (sessionId: string, userId: string) => Promise<{ success: boolean }>;
  startCombat: (
    sessionId: string,
    participants: CombatEntryParticipantInput[],
    surpriseRound: boolean,
    userId: string,
  ) => Promise<{
    encounter: { id: string };
    participants: Array<{ id: string; name: string }>;
    participantSizes?: Record<string, unknown>;
  }>;
  createTacticalCombatMap: (
    sessionId: string,
    participants: Array<{ id: string; name: string }>,
    sceneSpec: SceneSpec,
    participantSizes?: Record<string, unknown>,
  ) => Promise<unknown>;
  sanitizeSceneSpec: (
    raw: unknown,
    sessionId: string,
  ) => { ok: true; sceneSpec: SceneSpec; overrides: string[] } | { ok: false; detail: string };
  trackCombatEvent: (event: string, properties: Record<string, unknown>) => void;
  publishCombatState: (encounterId: string, userId: string, reason: string) => Promise<unknown>;
  logger: {
    info: (data: unknown) => void;
    warn: (data: unknown) => void;
    error: (data: unknown) => void;
  };
}

export interface CombatEntryGateParams {
  sessionId: string;
  userId: string;
  player: CombatEntryPlayer;
  response: CombatEntryResponse;
}

/**
 * Create the encounter and roll initiative, or return null because there is nothing to do.
 *
 * Returning null covers three distinct non-events, all of them normal: no hostile signal, an
 * encounter is already running (the gate never restarts a fight — see the `alreadyActive`
 * no-op the start route learned in run 8), or the session is not the caller's.
 *
 * A THROWN error is never propagated. The gate is on the turn path: a failure to seat an
 * encounter must degrade to a narrated turn plus loud `combat_integrity` telemetry, never to a
 * turn the player never receives.
 */
export async function runCombatEntryGate(
  params: CombatEntryGateParams,
  deps: CombatEntryGateDeps,
): Promise<CombatEntryOutcome | null> {
  const { sessionId, userId, player, response } = params;
  const trigger = detectCombatEntryTrigger(response);
  if (!trigger) return null;

  try {
    const active = await deps.getActiveEncounter(sessionId, userId);
    if (active) return null;

    const ownership = await deps.verifySessionOwnership(sessionId, userId);
    if (!ownership.success) {
      deps.logger.warn({
        msg: 'Combat entry gate refused: session not owned by caller',
        sessionId,
        trigger: trigger.reason,
      });
      return null;
    }

    // Scene: the model's, if it survives sanitising; otherwise ours. An invalid scene_spec is
    // downgraded to a synthesized one rather than aborting entry — the whole point of #1779 §2.
    let sceneSpecSynthesized = false;
    let scene: SceneSpec;
    if (response.scene_spec) {
      const sanitized = deps.sanitizeSceneSpec(response.scene_spec, sessionId);
      if (sanitized.ok) {
        scene = sanitized.sceneSpec;
        if (sanitized.overrides.length) {
          deps.logger.info({
            msg: 'Overrode model-supplied scene_spec fields on gated combat entry',
            sessionId,
            overrides: sanitized.overrides,
          });
        }
      } else {
        sceneSpecSynthesized = true;
        scene = synthesizeSceneSpec(sessionId, response.text);
        deps.logger.warn({
          msg: 'Synthesized scene_spec after the model supplied an invalid one',
          sessionId,
          detail: sanitized.detail,
        });
      }
    } else {
      sceneSpecSynthesized = true;
      scene = synthesizeSceneSpec(sessionId, response.text);
    }

    const combatants = deriveEntryCombatants(response, player.name);
    const participants = buildEntryParticipants(player, combatants);
    const combatState = await deps.startCombat(sessionId, participants, false, userId);

    await deps.createTacticalCombatMap(
      sessionId,
      combatState.participants,
      scene,
      combatState.participantSizes,
    );

    deps.trackCombatEvent('combat_started', {
      encounterId: combatState.encounter.id,
      sessionId,
      entryTrigger: trigger.reason,
      entryDetail: trigger.detail,
      sceneSpecSynthesized,
      // Named so the "every campaign NPC fights as AC 12 / 11 HP" finding stays visible.
      genericStatFallbackAc: GENERIC_NPC_STATS.armorClass,
      gated: true,
    });
    deps.trackCombatEvent('initiative_completed', {
      encounterId: combatState.encounter.id,
      participants: combatState.participants.length,
      gated: true,
    });
    await deps.publishCombatState(combatState.encounter.id, userId, 'combat_started');

    return {
      entered: true,
      encounterId: combatState.encounter.id,
      trigger: trigger.reason,
      detail: trigger.detail,
      sceneSpecSynthesized,
      sceneSpec: scene,
      participantCount: combatState.participants.length,
    };
  } catch (error) {
    deps.logger.error({
      msg: '!!!!!!!!!!!!!!!! COMBAT_ENTRY_GATE_FAILED !!!!!!!!!!!!!!!!',
      alert: true,
      sessionId,
      trigger: trigger.reason,
      detail: trigger.detail,
      error,
    });
    deps.trackCombatEvent('combat_entry_failed', {
      sessionId,
      entryTrigger: trigger.reason,
      entryDetail: trigger.detail,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
