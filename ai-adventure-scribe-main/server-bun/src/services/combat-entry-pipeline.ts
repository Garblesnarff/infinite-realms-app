/**
 * Turn-pipeline integration for the deterministic combat entry gate (#1779 §1–§2).
 *
 * `POST /v1/llm/generate` is the single funnel every DM turn passes through, which makes it the
 * only place where "before the turn's narration returns" is a statement about wall-clock rather
 * than a hope about client ordering. The gate runs here, after contract enforcement (so it
 * judges the accepted dialect, not the raw one) and before the response leaves the server.
 *
 * On entry the returned envelope receives `combat_entry_pending`, an explicit, auditable handoff
 * containing the server-derived combatants and sanitized scene. It is deliberately not seated
 * here: the player must confirm the entry and may provide their own initiative d20 through the
 * separate `/v1/combat/sessions/:sessionId/enter` endpoint.
 */
import {
  detectCombatEntry,
  mapActionTarget,
  synthesizeSceneSpec,
} from './combat/combat-entry-gate.js';
import { sanitizeSceneSpec as defaultSanitizeSceneSpec } from './combat/scene-spec-sanitizer.js';
import { logger } from '../lib/logger.js';

import type {
  CombatEntryGateDeps,
  CombatEntryPlayer,
  CombatEntryResponse,
} from './combat/combat-entry-gate.js';
import type { CombatIntentActor, DeclaredAttack } from './combat/combat-intent-gate.js';
import type { LLMResponse } from './llm-provider-service.js';

/** What the client must send for the server to be able to seat the player in an encounter. */
export interface CombatEntryContext {
  sessionId: string;
  player: CombatEntryPlayer;
}

const parseEnvelope = (text: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(
      text
        .trim()
        .replace(/^```(?:json)?\s*/, '')
        .replace(/\s*```$/, ''),
    );
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

const hasAuthoredCombatant = (envelope: Record<string, unknown>): boolean =>
  Array.isArray(envelope.combatants) &&
  envelope.combatants.some(
    (combatant) =>
      combatant &&
      typeof combatant === 'object' &&
      typeof (combatant as { name?: unknown }).name === 'string' &&
      Boolean((combatant as { name: string }).name.trim()),
  );

const hasTargetedMapAction = (envelope: Record<string, unknown>): boolean =>
  Array.isArray(envelope.map_actions) &&
  envelope.map_actions.some(
    (action) =>
      action &&
      typeof action === 'object' &&
      Boolean(mapActionTarget(action as Parameters<typeof mapActionTarget>[0])),
  );

/**
 * Initiative is meaningful only when the response identifies who the roll belongs to. A model
 * asking for initiative during a peaceful action ("Cast Light") must not manufacture an entry
 * handoff. Other roll requests remain byte-for-byte represented in the accepted envelope.
 */
export function stripUntargetedInitiativeRollRequests(
  result: LLMResponse,
  declaredAttack?: DeclaredAttack | null,
): LLMResponse {
  if (result.error) return result;
  const envelope = parseEnvelope(result.text);
  if (!envelope || !Array.isArray(envelope.roll_requests)) return result;

  const initiativeRequests = envelope.roll_requests.filter(
    (request) =>
      request &&
      typeof request === 'object' &&
      (request as { type?: unknown }).type === 'initiative',
  );
  if (!initiativeRequests.length) return result;

  if (hasAuthoredCombatant(envelope) || hasTargetedMapAction(envelope) || declaredAttack) {
    return result;
  }

  const remainingRolls = envelope.roll_requests.filter(
    (request) =>
      !(
        request &&
        typeof request === 'object' &&
        (request as { type?: unknown }).type === 'initiative'
      ),
  );
  logger.warn({
    msg: 'initiative_without_target',
    event: 'initiative_without_target',
    removed: initiativeRequests.length,
  });
  return {
    ...result,
    text: JSON.stringify({ ...envelope, roll_requests: remainingRolls }),
  };
}

const declaredCombatOutcomePattern =
  /\b(?:hits?|strikes?|punch(?:es|ed)?|slashes?|stabs?|shoots?|fires?|deals?|damage|wounds?|bleeds?|falls?|collapses?|dies?|slain)\b/i;

const normalizeCombatantName = (value: string): string =>
  value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim();

const isDeclaredCombatant = (
  combatant: { name: string; monsterId?: string },
  declaredAttack: DeclaredAttack,
): boolean => {
  if (declaredAttack.monsterId && combatant.monsterId === declaredAttack.monsterId) return true;

  const combatantName = normalizeCombatantName(combatant.name);
  const declaredName = normalizeCombatantName(declaredAttack.actorName);
  return (
    combatantName === declaredName ||
    combatantName.endsWith(` ${declaredName}`) ||
    declaredName.endsWith(` ${combatantName}`)
  );
};

/** The DM's reply with every field that could open or resolve a fight removed. */
const withoutCombatEntryFields = (envelope: Record<string, unknown>): Record<string, unknown> => {
  const rest = { ...envelope };
  delete rest.combatants;
  return {
    ...rest,
    combat_transition: 'none',
    map_actions: [],
    combat_actions: [],
    roll_requests: (Array.isArray(envelope.roll_requests) ? envelope.roll_requests : []).filter(
      (request) =>
        !(request && typeof request === 'object') ||
        !['attack', 'initiative'].includes((request as { type?: string }).type ?? ''),
    ),
  };
};

/**
 * Drop every reference to a combatant the roster does not know. Map and combat actions name
 * entities by id or slug, so a reference is invented when it equals the name, id or monster id of
 * a combatant the roster rejected. References to anything else stay: a map entity's id need not
 * match its roster slug. `entered` is every combatant the gate read for this turn, before the
 * roster filter: when the DM omits `combatants` they come from the action targets, and the actions
 * that name an invented one must go with it.
 */
const withoutInventedCreatures = (
  envelope: Record<string, unknown>,
  roster: readonly CombatIntentActor[],
  entered: readonly { name: string; monsterId?: string }[],
): Record<string, unknown> => {
  const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
  const field = (item: unknown, key: string): unknown =>
    item && typeof item === 'object' ? (item as Record<string, unknown>)[key] : undefined;
  const text = (value: unknown): string => (typeof value === 'string' ? value : '');

  const isOnRoster = (combatant: unknown): boolean =>
    roster.some((actor) =>
      isDeclaredCombatant(
        {
          name: text(field(combatant, 'name')),
          ...(text(field(combatant, 'monster_id'))
            ? { monsterId: text(field(combatant, 'monster_id')) }
            : {}),
        },
        {
          verb: 'cast',
          actorName: actor.name,
          ...(actor.monsterId ? { monsterId: actor.monsterId } : {}),
        },
      ),
    );
  const invented = new Set<string>();
  for (const combatant of list(envelope.combatants)) {
    if (isOnRoster(combatant)) continue;
    for (const key of ['name', 'monster_id']) {
      const reference = normalizeCombatantName(text(field(combatant, key)));
      if (reference) invented.add(reference);
    }
  }
  for (const combatant of entered) {
    if (isOnRoster({ name: combatant.name, monster_id: combatant.monsterId })) continue;
    for (const reference of [combatant.name, combatant.monsterId ?? '']) {
      const normalized = normalizeCombatantName(reference);
      if (normalized) invented.add(normalized);
    }
  }
  const isInvented = (reference: unknown): boolean =>
    invented.has(normalizeCombatantName(text(reference)));

  const mapReferences = (action: unknown): unknown[] => [
    mapActionTarget(action as Parameters<typeof mapActionTarget>[0]),
    field(field(action, 'changes'), 'id'),
    field(field(action, 'changes'), 'slug'),
    field(field(action, 'changes'), 'name'),
  ];

  return {
    ...envelope,
    ...(Array.isArray(envelope.combatants)
      ? { combatants: envelope.combatants.filter(isOnRoster) }
      : {}),
    ...(Array.isArray(envelope.map_actions)
      ? {
          map_actions: envelope.map_actions.filter(
            (action) => !mapReferences(action).some(isInvented),
          ),
        }
      : {}),
    ...(Array.isArray(envelope.combat_actions)
      ? {
          combat_actions: envelope.combat_actions.filter(
            (action) =>
              !isInvented(field(action, 'actor_id')) &&
              !list(field(action, 'target_ids')).some(isInvented),
          ),
        }
      : {}),
  };
};

/**
 * Run the gate for this turn and return the response the client should receive.
 *
 * A turn that does not trigger entry, cannot be parsed, or arrives without a session is
 * returned untouched — the gate is additive and can never withhold narration.
 */
export async function applyCombatEntryGate(params: {
  result: LLMResponse;
  userId: string;
  combatEntry?: CombatEntryContext | null;
  declaredAttack?: DeclaredAttack | null;
  /**
   * Set when the player's words were a spell cast with no creature named (the sheet's Cast
   * button): the roster the turn was checked against. The player chose nobody, so a combatant
   * the DM made up from its own description ("shadows that do not cast light") is not a target.
   */
  untargetedSpellRoster?: readonly CombatIntentActor[] | null;
  deps?: CombatEntryGateDeps;
}): Promise<LLMResponse> {
  const { combatEntry, declaredAttack, untargetedSpellRoster } = params;
  const sanitizedResult = stripUntargetedInitiativeRollRequests(params.result, declaredAttack);
  if (sanitizedResult.error || !combatEntry?.sessionId || !combatEntry.player) {
    return sanitizedResult;
  }

  // A declared attack is allowed to force the handoff even when the model answered with pure
  // prose or omitted every structured combat field. The original narration remains in `text`;
  // only the server-owned envelope is added around it.
  let envelope =
    parseEnvelope(sanitizedResult.text) ?? (declaredAttack ? { text: sanitizedResult.text } : null);
  if (!envelope) return sanitizedResult;

  // Detection is pure. Keep the optional dependency seam for tests that need to assert scene
  // sanitization, but never import or call the database-backed seating dependencies here.
  let pending = detectCombatEntry({
    sessionId: combatEntry.sessionId,
    playerName: combatEntry.player.name,
    response: envelope as unknown as CombatEntryResponse,
    declaredAttack,
    sanitizeSceneSpec: params.deps?.sanitizeSceneSpec ?? defaultSanitizeSceneSpec,
  });

  if (declaredAttack) {
    if (!pending) {
      const declaredDetection = detectCombatEntry({
        sessionId: combatEntry.sessionId,
        playerName: combatEntry.player.name,
        response: { ...envelope, combat_transition: 'start' } as unknown as CombatEntryResponse,
        declaredAttack,
        sanitizeSceneSpec: params.deps?.sanitizeSceneSpec ?? defaultSanitizeSceneSpec,
      });
      const sceneSpec =
        declaredDetection?.sceneSpec ??
        synthesizeSceneSpec(
          combatEntry.sessionId,
          typeof envelope.text === 'string' ? envelope.text : undefined,
        );
      pending = {
        trigger: 'player_intent',
        detail: `player declared an attack on ${declaredAttack.actorName}`,
        combatants: [
          {
            name: declaredAttack.actorName,
            ...(declaredAttack.monsterId ? { monsterId: declaredAttack.monsterId } : {}),
            count: 1,
          },
        ],
        sceneSpec,
        sceneSpecSynthesized: declaredDetection?.sceneSpecSynthesized ?? true,
        ...(declaredDetection?.seatingHint ? { seatingHint: declaredDetection.seatingHint } : {}),
      };
    } else if (
      !pending.combatants.some((combatant) => isDeclaredCombatant(combatant, declaredAttack))
    ) {
      pending = {
        ...pending,
        combatants: [
          ...pending.combatants,
          {
            name: declaredAttack.actorName,
            ...(declaredAttack.monsterId ? { monsterId: declaredAttack.monsterId } : {}),
            count: 1,
          },
        ],
      };
    }

    pending = { ...pending, declaredAttack };

    const narration = typeof envelope.text === 'string' ? envelope.text : sanitizedResult.text;
    if (declaredCombatOutcomePattern.test(narration)) {
      logger.warn({
        msg: 'COMBAT_INTENT_DIRECTIVE_CONTRACT_VIOLATION',
        event: 'contract_violation',
        sessionId: combatEntry.sessionId,
        actorName: declaredAttack.actorName,
        verb: declaredAttack.verb,
      });
    }
  }

  if (pending && !declaredAttack && untargetedSpellRoster) {
    const known = pending.combatants.filter((combatant) =>
      untargetedSpellRoster.some((actor) =>
        isDeclaredCombatant(combatant, {
          verb: 'cast',
          actorName: actor.name,
          ...(actor.monsterId ? { monsterId: actor.monsterId } : {}),
        }),
      ),
    );
    if (known.length === 0) {
      logger.info({
        msg: 'COMBAT_ENTRY_INVENTED_TARGET_DROPPED',
        sessionId: combatEntry.sessionId,
        trigger: pending.trigger,
        combatants: pending.combatants.map((combatant) => combatant.name),
      });
      return { ...sanitizedResult, text: JSON.stringify(withoutCombatEntryFields(envelope)) };
    }
    // A target id that is the player's own is a hostile the gate derived by mistake, not an
    // invented creature: the player's actions must stay.
    const playerId = normalizeCombatantName(combatEntry.player.characterId ?? '');
    envelope = withoutInventedCreatures(
      envelope,
      untargetedSpellRoster,
      pending.combatants.filter(
        (combatant) => !playerId || normalizeCombatantName(combatant.name) !== playerId,
      ),
    );
    pending = { ...pending, combatants: known };
  }

  if (!pending) return sanitizedResult;

  logger.info({
    msg: 'COMBAT_ENTRY_DETECTED_PENDING_PLAYER_ENTRY',
    sessionId: combatEntry.sessionId,
    trigger: pending.trigger,
    detail: pending.detail,
    sceneSpecSynthesized: pending.sceneSpecSynthesized,
    participants: pending.combatants.reduce((total, combatant) => total + combatant.count, 1),
  });

  const rewritten = {
    ...envelope,
    // A pending entry is not a combat transition. This prevents old clients from treating the
    // model's `combat_transition: "start"` as proof that an encounter exists.
    combat_transition: 'none',
    combat_entry_pending: pending,
  };
  return { ...sanitizedResult, text: JSON.stringify(rewritten) };
}
