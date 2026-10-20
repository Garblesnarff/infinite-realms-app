import { CombatEncounterService } from './combat-encounter-service.js';
import { executeCombatIntent } from './combat-intent-service.js';
import { getParticipantAbilityProfile } from './data-access.js';
import { loadActiveTacticalMap, saveTacticalMap } from './tactical-map-store.js';
import { isSelfCastSpell, resolveCatalogSpell } from '../../data/spellData.js';
import { BusinessLogicError } from '../../lib/errors.js';
import { calculateAoECast } from '../../tactical/aoe.js';
import { dispatchMapAction } from '../../tactical/dispatch.js';
import { describeEntityRoster, resolveEntityRef } from '../../tactical/identity.js';
import { broadcastToRoom } from '../collaboration/room-manager.js';
import { ownedSessionCharacter } from '../dm/dm-feature-gate.js';

import type { CombatActionOrigin } from './combat-intent-service.js';
import type { Spell } from '../../data/spellData.js';
import type { AoECastGeometry } from '../../tactical/aoe.js';
import type { MapEntity, Point } from '../../tactical/types.js';

export type AoECastRequest = {
  actorId: string;
  spellId: string;
  origin: Point;
  direction: Point | null;
  slotLevel: number | null;
  /**
   * Who produced the cast (#2305), forwarded to the intent gateway: the chat batch sends the
   * turn's player-input origin (`sheet_cast` for the sheet's Cast button), the repair loop sends
   * `repair`, and a player area spell no player input made is refused there like any other.
   */
  actionOrigin?: CombatActionOrigin;
};

export type AoEForcedMove = { entityId: string; path: Point[] };
export type AoETargetResult = {
  entityId: string;
  saved: boolean | null;
  finalDamage: number | undefined;
  newHp: number | undefined;
};
export type AoECastDelta = {
  type: 'aoe_cast';
  state: 'player-confirmed' | 'hostile-telegraph';
  actorId: string;
  spellId: string;
  geometry: AoECastGeometry;
  targets: AoETargetResult[];
  forcedMoves: AoEForcedMove[];
};
export type AoEPreviewDelta = {
  type: 'aoe_preview';
  state: 'player-pending' | 'hostile-telegraph';
  actorId: string;
  spellId: string;
  slotLevel: number | null;
  geometry: AoECastGeometry;
};

const publish = (sessionId: string, delta: AoECastDelta | AoEPreviewDelta): void =>
  broadcastToRoom(sessionId, null as never, { ...delta, timestamp: Date.now() });

/** Why an area spell was not cast. The message is shown to the player, so it says what to do. */
export class AoECastRefusedError extends BusinessLogicError {
  constructor(message: string, reason: string, extra: Record<string, unknown> = {}) {
    super(message, { reason, ...extra });
  }
}

const isSelfRange = (spell: Spell): boolean => /^self\b/i.test(spell.range.trim());

/**
 * Where the area starts and which way it points.
 *
 * A "Self" area (Burning Hands' cone) starts at the caster: that is the spell, not a choice the
 * DM gets to make. The DM still says where it is aimed, and it says so most reliably with the
 * cell it named as `origin` — so when that cell is not the caster's own, the cone points at it.
 */
function aimFor(
  spell: Spell,
  actor: MapEntity,
  request: AoECastRequest,
): { origin: Point; direction: Point | null } {
  if (!isSelfRange(spell)) return { origin: request.origin, direction: request.direction };
  const origin = { x: actor.x, y: actor.y };
  const aimedAt = { x: request.origin.x - actor.x, y: request.origin.y - actor.y };
  const direction = aimedAt.x || aimedAt.y ? aimedAt : request.direction;
  return { origin, direction };
}

/**
 * GP-061 (#313): refuse an area spell the PC's sheet does not list, before the area is placed.
 * The solo game seats one player character per session, so a PC's cast is theirs. Fails open:
 * a sheet that cannot be read skips the check rather than blocking the cast.
 */
async function assertPcKnowsSpell(
  sessionId: string,
  userId: string,
  actor: MapEntity,
  spell: Spell,
): Promise<void> {
  let characterId: string | null = null;
  try {
    const character = await ownedSessionCharacter(sessionId, userId);
    characterId = character?.id ?? null;
  } catch {
    return;
  }
  if (!characterId) return;
  let spellIds: string[];
  try {
    const profile = await getParticipantAbilityProfile({ characterId });
    spellIds = profile.spellIds ?? [];
  } catch {
    return;
  }
  const isKnown = spellIds.some((known) => resolveCatalogSpell(known)?.id === spell.id);
  if (!isKnown) {
    throw new AoECastRefusedError(
      `Spell refused: ${spell.name} is not on ${actor.name ?? 'the caster'}'s sheet — cast a spell you know or have prepared`,
      'spell_not_known',
      { spellId: spell.id },
    );
  }
}

async function prepare(sessionId: string, request: AoECastRequest, userId: string) {
  const [map, spell] = await Promise.all([
    loadActiveTacticalMap(sessionId),
    resolveCatalogSpell(request.spellId),
  ]);
  if (!map)
    throw new AoECastRefusedError(
      'there is no tactical map for this fight, so the area cannot be placed — name one target and cast it again',
      'no_tactical_map',
    );
  // #902: a spell with no area that the engine acknowledges as a self cast (Detect Magic
  // is the reported case) is cast on the caster — there is no target to name, so the
  // "name its target" refusal must not fire. The cast is synthesized on the actor's own
  // cell in the return below, and the engine resolves it as a self cast. A Self-range
  // spell the engine does not resolve (False Life and its kin) refuses as what it is —
  // never with "name its target", which is the one instruction it cannot be obeyed by.
  // A no-area spell with a real range keeps the original refusal: it genuinely needs
  // a target named.
  const selfCast = !!spell && !spell.areaOfEffect && isSelfCastSpell(spell);
  if (!spell?.areaOfEffect && !selfCast) {
    if (spell && isSelfRange(spell))
      throw new AoECastRefusedError(
        `${spell.name} is cast on yourself, and the combat engine does not resolve it — describe it to the DM instead and it will be narrated; no slot was spent`,
        'self_spell_not_resolved',
      );
    throw new AoECastRefusedError(
      `${spell?.name ?? request.spellId} has no area of effect — name its target and cast it again`,
      'no_area_of_effect',
    );
  }
  // The DM copies the digest slug ("the-apprentice"), the client echoes participant ids, and the
  // model sometimes writes the display name. The board answers all three; an exact-id `find`
  // answered only the second and refused the rest (#2304).
  const actor = resolveEntityRef(map.entities, request.actorId);
  if (!actor)
    throw new AoECastRefusedError(
      `the caster '${request.actorId}' is not on the tactical map (on the map: ${describeEntityRoster(map.entities)})`,
      'caster_not_on_map',
      { roster: describeEntityRoster(map.entities) },
    );
  // GP-061 (#313): the sheet check runs at propose time, not just at resolve. A spell the
  // caster does not know is refused at once — no area is placed and no "Confirm spell area"
  // is asked. Mirrors prepareSpellCast's ordering (sheet before combat-spell assessment).
  if (actor.type === 'pc') {
    await assertPcKnowsSpell(sessionId, userId, actor, spell);
  }
  const { origin, direction } = aimFor(spell, actor, request);
  // A cone or line with no direction is an empty template: `isAoECell` answers false for every
  // cell, so the cast would reach the "catches no creature" refusal with a hint about distance
  // that is not the problem. Say what is missing instead.
  const directional = spell.areaOfEffect?.shape === 'cone' || spell.areaOfEffect?.shape === 'line';
  if (directional && (!direction || (!direction.x && !direction.y)))
    throw new AoECastRefusedError(
      `${spell.name} is a ${spell.areaOfEffect!.sizeFeet}-foot ${spell.areaOfEffect!.shape} and was given no direction — say which way you aim it (at which creature) and cast it again; no slot was spent`,
      'aoe_no_direction',
    );
  return {
    map,
    spell,
    area: spell.areaOfEffect ?? null,
    actor,
    origin,
    direction,
    // A self cast has no template to calculate: its whole geometry is the caster's cell and
    // its only target is the caster (calculateAoECast would exclude the source by design).
    cast: spell.areaOfEffect
      ? calculateAoECast(map, actor.id, spell.areaOfEffect, origin, direction)
      : {
          geometry: {
            shape: 'sphere',
            sizeFeet: 0,
            origin,
            direction: null,
            cells: [{ x: actor.x, y: actor.y }],
          } satisfies AoECastGeometry,
          targets: [actor],
        },
  };
}

export async function proposeAoECast(
  sessionId: string,
  request: AoECastRequest,
  userId: string,
) {
  const { spell, actor, cast } = await prepare(sessionId, request, userId);
  const playerCast = actor.type === 'pc';
  const autoConfirm = playerCast && isSelfRange(spell);
  const preview: AoEPreviewDelta = {
    type: 'aoe_preview',
    state: playerCast ? 'player-pending' : 'hostile-telegraph',
    actorId: actor.id,
    spellId: request.spellId,
    slotLevel: request.slotLevel,
    geometry: cast.geometry,
  };
  publish(sessionId, preview);
  return { preview, autoConfirm, hostile: !playerCast };
}

/** The broadcast aggregate, plus the engine's own result for the caller's transcript line. */
export type AoECastResolution = { delta: AoECastDelta; engineResult: unknown };

/**
 * Resolve damage/saves through the combat engine, then apply every failed-save
 * push against the same in-memory tactical map. Only the completed aggregate is
 * broadcast, making this safe for spectators and future co-op clients.
 *
 * An area that catches nobody is refused, not resolved as an empty cast: nothing was rolled, so
 * there is no engine line to show, and a silent success is exactly what let the DM narrate a
 * Burning Hands the engine never saw (#2304). The slot is kept, and the refusal says what to do.
 */
export async function resolveAoECast(
  sessionId: string,
  request: AoECastRequest,
  userId: string,
): Promise<AoECastResolution> {
  const { map, spell, area, actor, origin, cast } = await prepare(sessionId, request, userId);
  const encounter = await CombatEncounterService.getActiveEncounter(sessionId, userId);
  if (!encounter)
    throw new AoECastRefusedError('there is no active fight to cast it in', 'no_active_encounter');
  const targetIds = cast.targets.map((target) => target.id);
  if (!targetIds.length) {
    // Only an area cast can land here — a self cast always targets its caster.
    const size = `${area?.sizeFeet ?? 0}-foot ${area?.shape ?? 'area'}`;
    throw new AoECastRefusedError(
      `the ${size} catches no creature from where it was aimed — move within ${area?.sizeFeet ?? 0} feet of a target and cast it again; no slot was spent`,
      'aoe_no_targets',
    );
  }
  const combatState = await CombatEncounterService.getCombatState(encounter.id, userId);
  const engineResult = await executeCombatIntent(
    encounter.id,
    {
      type: 'spell',
      actorId: actor.id,
      targetIds,
      spellId: request.spellId,
      spellName: spell.name,
      slotLevel: request.slotLevel ?? undefined,
      expectedVersion: combatState.encounter.version,
    },
    userId,
    actor.type === 'pc' ? 'player' : 'dm',
    undefined,
    request.actionOrigin,
  );
  const outcomes =
    (
      engineResult as {
        results?: Array<{ hit?: boolean; finalDamage?: number; targetNewHp?: number }>;
      }
    ).results ?? [];
  const targets = targetIds.map((entityId, index) => ({
    entityId,
    saved: spell.saveAbility ? outcomes[index]?.hit === false : null,
    finalDamage: outcomes[index]?.finalDamage,
    newHp: outcomes[index]?.targetNewHp,
  }));
  const forcedMoves: AoEForcedMove[] = [];
  if (spell.forcedMove) {
    for (const target of targets) {
      if (target.saved || target.saved === null) continue;
      const moved = dispatchMapAction(map, {
        action: 'forced_move',
        target: target.entityId,
        mode: spell.forcedMove.direction === 'away' ? 'shove' : 'pull',
        origin,
        distance: spell.forcedMove.distanceFeet,
        destination: null,
      });
      if (moved.applied && moved.path?.length)
        forcedMoves.push({ entityId: target.entityId, path: moved.path });
    }
    if (forcedMoves.length) await saveTacticalMap(map);
  }
  const delta: AoECastDelta = {
    type: 'aoe_cast',
    state: actor.type === 'pc' ? 'player-confirmed' : 'hostile-telegraph',
    actorId: actor.id,
    spellId: request.spellId,
    geometry: cast.geometry,
    targets,
    forcedMoves,
  };
  publish(sessionId, delta);
  return { delta, engineResult };
}
