/* eslint-disable max-lines -- one cohesive entry contract: detect, derive, synthesize, seat. */
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
 * Detection makes the entry decision a property of the server rather than of a client-side
 * narrator heuristic. It runs on the turn pipeline before the narration is returned, and it
 * emits a pending handoff when no encounter is active and the DM response shows ANY of three
 * signals. Seating is an explicit endpoint operation below:
 *
 *   1. `combat_transition === 'start'`  — the existing signal, now enforced by the server.
 *   2. a tactical/combat action targeting an entity — the model behaving as though a fight
 *      is underway. This is the 03:25:10 shove that was silently dropped as `no_active_map`.
 *   3. an attack-type roll_request — dice that only exist inside combat.
 *
 * One model string stops being a single point of failure because combat *behavior* also
 * triggers entry.
 */
import { sanitizeSceneSpec as defaultSanitizeSceneSpec } from './scene-spec-sanitizer.js';
import { GENERIC_NPC_STATS } from './srd-monster-resolution.js';
import { displayNameFromRoster } from '../../../../shared/engine-display-name';
import { ValidationError } from '../../lib/errors.js';

import type { CombatEntryFirstAction } from './combat-entry-first-action.js';
import type { DeclaredAttack } from './combat-intent-gate.js';
import type { CombatSeatingHint, CombatSeatingReason } from '../../tactical/seating.js';
import type { SceneSpec } from '../../tactical/types.js';
import type { DMMapAction, DMResponse } from '../dm/dm-response-schema.js';

export type CombatEntryReason =
  | 'combat_transition'
  | 'tactical_action'
  | 'attack_roll_request'
  | 'player_intent';

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

export interface CombatEntrySeatingHint {
  targetName: string;
  reason: CombatSeatingReason;
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

const normalize = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

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

export type SceneSpecSanitizer = (
  raw: unknown,
  sessionId: string,
) => { ok: true; sceneSpec: SceneSpec; overrides: string[] } | { ok: false; detail: string };

/** The pure input to combat-entry detection. It contains no database or publication dependency. */
export interface CombatEntryDetectionParams {
  sessionId: string;
  playerName: string;
  response: CombatEntryResponse;
  declaredAttack?: DeclaredAttack | null;
  sanitizeSceneSpec?: SceneSpecSanitizer;
}

function mentionedTarget(text: string, declared: DeclaredAttack): boolean {
  const normalizedText = slugify(text);
  const targetName = slugify(declared.actorName);
  const targetSlug = slugify(declared.actorSlug ?? '');
  return [targetName, targetSlug]
    .filter(Boolean)
    .some((candidate) => normalizedText.includes(candidate));
}

/** Infer only server-readable context; `/enter` re-matches the target to its seated participant. */
export function inferCombatEntrySeatingHint(
  text: string | undefined,
  declaredAttack?: DeclaredAttack | null,
): CombatEntrySeatingHint | undefined {
  if (!text || !declaredAttack) return undefined;
  const targetName = declaredAttack.actorName.trim();
  if (!targetName || !mentionedTarget(text, declaredAttack)) return undefined;

  const assetTarget = [...text.matchAll(/\[ASSET:(?:npc|monster|entity):([^\]]+)\]/gi)].find(
    (match) => {
      const tag = slugify(match[1] ?? '');
      return (
        tag &&
        [slugify(targetName), slugify(declaredAttack.actorSlug ?? '')].some(
          (candidate) => candidate && (tag === candidate || tag.startsWith(`${candidate}-`)),
        )
      );
    },
  );
  if (assetTarget) return { targetName, reason: 'asset_tag' };

  if (/\b(?:says?|said|speaks?|spoke|replies?|asks?|tells?|whispers?|shouts?)\b/i.test(text)) {
    return { targetName, reason: 'conversation' };
  }
  return undefined;
}

/**
 * Resolve the scene carried by a detected entry without making it a side effect of detection.
 * The sanitizer is a pure validator; the database-backed map is deliberately absent here.
 */
function resolveDetectedScene(
  sessionId: string,
  response: CombatEntryResponse,
  sanitize: SceneSpecSanitizer,
): { sceneSpec: SceneSpec; sceneSpecSynthesized: boolean } {
  if (response.scene_spec) {
    const sanitized = sanitize(response.scene_spec, sessionId);
    if (sanitized.ok) {
      return { sceneSpec: sanitized.sceneSpec, sceneSpecSynthesized: false };
    }
  }

  return {
    sceneSpec: synthesizeSceneSpec(sessionId, response.text),
    sceneSpecSynthesized: true,
  };
}

export interface CombatEntryPending {
  trigger: CombatEntryReason;
  detail: string;
  combatants: DerivedCombatant[];
  sceneSpec: SceneSpec;
  sceneSpecSynthesized: boolean;
  declaredAttack?: DeclaredAttack;
  seatingHint?: CombatEntrySeatingHint;
}

/**
 * Detect and describe combat entry without reading or writing combat state.
 *
 * The returned object is the only server-authored handoff between the LLM turn and the explicit
 * `/enter` confirmation. In particular, this function never calls startCombat, creates a map,
 * emits telemetry, or publishes a websocket state.
 */
export function detectCombatEntry(params: CombatEntryDetectionParams): CombatEntryPending | null {
  const trigger = detectCombatEntryTrigger(params.response);
  if (!trigger) return null;

  const scene = resolveDetectedScene(
    params.sessionId,
    params.response,
    params.sanitizeSceneSpec ?? defaultSanitizeSceneSpec,
  );
  const seatingHint = inferCombatEntrySeatingHint(
    [params.response.text, scene.sceneSpec.sceneDescription].filter(Boolean).join('\n'),
    params.declaredAttack,
  );

  return {
    trigger: trigger.reason,
    detail: trigger.detail,
    combatants: deriveEntryCombatants(params.response, params.playerName),
    ...(seatingHint ? { seatingHint } : {}),
    ...scene,
  };
}

export interface CombatEntryParticipantInput {
  encounterId: string;
  characterId?: string | null;
  npcId?: string | null;
  monsterId?: string;
  name: string;
  initiativeModifier: number;
  /** Input-only natural d20. The entry endpoint sets this for the player only. */
  initiativeRoll?: number;
  hpCurrent?: number | null;
  hpMax?: number | null;
  /** Input-only prose context. The encounter service resolves it once and stores the result. */
  sceneDescription?: string | null;
  sceneEntityName?: string | null;
  source?: string | null;
}

export interface CombatEntrySceneContext {
  sceneDescription?: string | null;
  sceneEntityName?: string | null;
  source?: string | null;
}

/** The start payload the gate hands the encounter service, player first. */
export function buildEntryParticipants(
  player: CombatEntryPlayer,
  combatants: DerivedCombatant[],
  sceneContext: CombatEntrySceneContext = {},
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
        ...(sceneContext.sceneDescription
          ? { sceneDescription: sceneContext.sceneDescription }
          : {}),
        ...(sceneContext.sceneEntityName ? { sceneEntityName: sceneContext.sceneEntityName } : {}),
        ...(sceneContext.source ? { source: sceneContext.source } : {}),
      });
    }
  }
  return participants;
}

export interface CombatEntryStartParticipant {
  id: string;
  name: string;
  initiative: number;
  initiativeModifier: number;
  characterId?: string | null;
  npcId?: string | null;
  participantType?: string;
  armorClass?: number | null;
  encounterId?: string;
  turnOrder?: number;
}

export interface CombatEntryStartResult {
  encounter: { id: string };
  participants: CombatEntryStartParticipant[];
  participantSizes?: Record<string, unknown>;
  turnOrder?: Array<{
    participant: CombatEntryStartParticipant & { participantType: string };
    isCurrent: boolean;
    hasGone: boolean;
  }>;
  currentParticipant?: CombatEntryStartParticipant | null;
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
  seatingTranscript: string;
  notice?: string;
}

export interface SeatedCombatEntryOutcome extends CombatEntryOutcome {
  /** Kept for `/enter`; the LLM pipeline only serializes the audit fields above. */
  combatState: CombatEntryStartResult;
  firstAction?: CombatEntryFirstAction;
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
  ) => Promise<CombatEntryStartResult>;
  createTacticalCombatMap: (
    sessionId: string,
    participants: Array<{ id: string; name: string }>,
    sceneSpec: SceneSpec,
    participantSizes?: Record<string, unknown>,
    seatingHint?: CombatSeatingHint,
  ) => Promise<unknown>;
  sanitizeSceneSpec: (
    raw: unknown,
    sessionId: string,
  ) => { ok: true; sceneSpec: SceneSpec; overrides: string[] } | { ok: false; detail: string };
  trackCombatEvent: (event: string, properties: Record<string, unknown>) => void;
  persistSessionMessage: (message: {
    sessionId: string;
    userId: string;
    speakerType: 'system';
    message: string;
  }) => Promise<unknown>;
  publishCombatState: (encounterId: string, userId: string, reason: string) => Promise<unknown>;
  deriveFirstAction?: (params: {
    sessionId: string;
    combatState: CombatEntryStartResult;
    player: CombatEntryPlayer;
    declaredAttack: DeclaredAttack;
  }) => Promise<CombatEntryFirstAction | null>;
  logger: {
    info: (data: unknown) => void;
    warn: (data: unknown) => void;
    error: (data: unknown) => void;
  };
}

export interface CombatEntrySeatParams {
  sessionId: string;
  userId: string;
  player: CombatEntryPlayer;
  combatants: DerivedCombatant[];
  sceneSpec: SceneSpec;
  sceneSpecSynthesized?: boolean;
  trigger?: CombatEntryReason;
  detail?: string;
  playerInitiativeRoll?: number;
  declaredAttack?: DeclaredAttack;
  seatingHint?: CombatEntrySeatingHint;
}

/**
 * Format the server-owned initiative facts as the seating line shown to the player.
 *
 * `combat_participants` stores the total and modifier, so the natural d20 is recovered as
 * `total - modifier`. The player marker is based on the explicit entry roll, while NPCs and
 * companions remain quietly engine-rolled as they have always been.
 */
export function buildCombatSeatingTranscript(
  participants: CombatEntryStartParticipant[],
  player: CombatEntryPlayer,
  playerInitiativeRoll?: number,
): string {
  let playerNamed = false;
  const ordered = [...participants].sort(
    (left, right) => (left.turnOrder ?? 0) - (right.turnOrder ?? 0),
  );
  const entries = ordered.map((participant) => {
    const isPlayer =
      !playerNamed &&
      (player.characterId
        ? participant.characterId === player.characterId
        : participant.name === (player.name || 'Player'));
    if (isPlayer) playerNamed = true;
    const label = isPlayer
      ? 'You'
      : displayNameFromRoster(participant.name, [{ id: participant.name, name: participant.name }]);
    const roll = participant.initiative - participant.initiativeModifier;
    const modifier =
      participant.initiativeModifier < 0
        ? `- ${Math.abs(participant.initiativeModifier)}`
        : `+ ${participant.initiativeModifier}`;
    const playerRollNote = isPlayer
      ? playerInitiativeRoll === undefined
        ? ' (auto-rolled)'
        : ' (you rolled)'
      : '';
    return `${label}: ${roll} ${modifier} = ${participant.initiative}${playerRollNote}.`;
  });

  return `⚙️ Engine: Initiative — ${entries.join(' ')}`;
}

function validatePlayerInitiativeRoll(roll: number | undefined): void {
  if (roll === undefined) return;
  if (!Number.isInteger(roll) || roll < 1 || roll > 20) {
    throw new ValidationError('playerInitiativeRoll must be an integer from 1 to 20');
  }
}

/**
 * Seat a detected entry after the player has supplied (or declined to supply) their d20.
 *
 * All writes live here: the encounter, tactical map, seating transcript, telemetry, and
 * publication happen in this function and nowhere in `detectCombatEntry` or the LLM turn
 * pipeline.
 */
export async function seatCombatEntry(
  params: CombatEntrySeatParams,
  deps: CombatEntryGateDeps,
): Promise<SeatedCombatEntryOutcome | null> {
  const {
    sessionId,
    userId,
    player,
    combatants,
    sceneSpec,
    sceneSpecSynthesized = false,
    trigger = 'combat_transition',
    detail = 'combat entry confirmed by the player',
    playerInitiativeRoll,
    declaredAttack,
    seatingHint,
  } = params;
  validatePlayerInitiativeRoll(playerInitiativeRoll);

  try {
    const active = await deps.getActiveEncounter(sessionId, userId);
    if (active) return null;

    const ownership = await deps.verifySessionOwnership(sessionId, userId);
    if (!ownership.success) {
      deps.logger.warn({
        msg: 'Combat entry gate refused: session not owned by caller',
        sessionId,
        trigger,
      });
      return null;
    }

    const participants = buildEntryParticipants(player, combatants, {
      sceneDescription: sceneSpec.sceneDescription,
      sceneEntityName: declaredAttack?.actorName ?? seatingHint?.targetName,
      source: trigger,
    });
    if (playerInitiativeRoll !== undefined && participants[0]) {
      participants[0] = { ...participants[0], initiativeRoll: playerInitiativeRoll };
    }
    const combatState = await deps.startCombat(sessionId, participants, false, userId);

    const playerParticipant = combatState.participants.find(
      (participant) =>
        (player.characterId && participant.characterId === player.characterId) ||
        normalize(participant.name) === normalize(player.name),
    );
    const hintedTarget = seatingHint
      ? combatState.participants.find(
          (participant) =>
            participant.id !== playerParticipant?.id &&
            (normalize(participant.name) === normalize(seatingHint.targetName) ||
              slugify(participant.name) === slugify(seatingHint.targetName) ||
              slugify(participant.name).startsWith(`${slugify(seatingHint.targetName)}-`)),
        )
      : undefined;

    const resolvedSeatingHint: CombatSeatingHint | undefined =
      hintedTarget && seatingHint
        ? {
            targetId: hintedTarget.id,
            targetLabel: hintedTarget.name,
            reason: seatingHint.reason,
          }
        : undefined;

    await deps.createTacticalCombatMap(
      sessionId,
      combatState.participants,
      sceneSpec,
      combatState.participantSizes,
      resolvedSeatingHint,
    );

    let firstAction: CombatEntryFirstAction | undefined;
    if (declaredAttack && deps.deriveFirstAction) {
      try {
        firstAction =
          (await deps.deriveFirstAction({ sessionId, combatState, player, declaredAttack })) ??
          undefined;
      } catch (error) {
        // Seating must remain available even if a malformed declaration cannot be grounded. The
        // client will show the explicit declare-action notice rather than silently ending the turn.
        deps.logger.warn({
          msg: 'Combat entry first action could not be derived',
          sessionId,
          encounterId: combatState.encounter.id,
          error,
        });
      }
    }

    deps.trackCombatEvent('combat_started', {
      encounterId: combatState.encounter.id,
      sessionId,
      entryTrigger: trigger,
      entryDetail: detail,
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
    const seatingTranscript = buildCombatSeatingTranscript(
      combatState.participants,
      player,
      playerInitiativeRoll,
    );
    await deps.persistSessionMessage({
      sessionId,
      userId,
      speakerType: 'system',
      message: seatingTranscript,
    });
    await deps.publishCombatState(combatState.encounter.id, userId, 'combat_started');

    return {
      entered: true,
      encounterId: combatState.encounter.id,
      trigger,
      detail,
      sceneSpecSynthesized,
      sceneSpec,
      participantCount: combatState.participants.length,
      seatingTranscript,
      ...(firstAction?.notice ? { notice: firstAction.notice } : {}),
      combatState,
      ...(firstAction ? { firstAction } : {}),
    };
  } catch (error) {
    deps.logger.error({
      msg: '!!!!!!!!!!!!!!!! COMBAT_ENTRY_GATE_FAILED !!!!!!!!!!!!!!!!',
      alert: true,
      sessionId,
      trigger,
      detail,
      error,
    });
    deps.trackCombatEvent('combat_entry_failed', {
      sessionId,
      entryTrigger: trigger,
      entryDetail: detail,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
