/**
 * The player leaving a fight the end guard is holding open (#2580).
 *
 * The #2524 guard refuses a DM scene end while a hostile stands, and until now the only exits
 * it honoured were the DM's own `combat_exits` declarations. A fight the player wanted out of
 * could therefore only end by killing everything: the Disengage chip moved the token and
 * recorded nothing, and no control existed that produced an exit for the player's own side.
 *
 * `flee` and `yield` are two intent slugs over the one exit machinery `concludeEncounter`
 * already uses (`markParticipantExited` plus an engine fact for the DM), so the DM's next
 * `dm_ended_scene` is judged against a roster with nobody left on the player's side and is
 * accepted rather than 409'd. HP is never touched by an exit and nothing here awards XP:
 * leaving is not a resolution and must never read as one.
 *
 * SRD flavour, because a flee nothing can hit on the way out is not the rule: leaving a
 * hostile's reach provokes one opportunity attack unless the player Disengaged first. That
 * attack resolves through the ordinary engine path — the same roll, the same damage write, the
 * same DM fact — BEFORE the exit is recorded, so the narration of "you run" and "it hit you
 * as you ran" cannot disagree.
 *
 * @module server/services/combat/player-exit-service
 */
import { describeResolvedAttack } from './attack-narration.js';
import { isLiveHostile } from './combat-end-guard.js';
import { recordDmTacticalFact } from './tactical-action-service.js';
import { logger } from '../../lib/logger.js';
import { NarrativeLedgerService } from '../narrative/narrative-ledger-service.js';

import type { CombatExitKind } from './combat-end-guard.js';
import type { MapEntity } from '../../tactical/types.js';
import type { CombatState } from '../../types/combat.js';

/** How close to the edge of the board counts as having left the fight. */
export const EXIT_EDGE_CELLS = 1;

/** The player-facing intent slugs, mapped onto the one exit vocabulary the guard knows. */
const PLAYER_EXIT_INTENTS = {
  flee: 'fled',
  yield: 'surrendered',
} as const satisfies Record<string, CombatExitKind>;

export type PlayerExitIntent = keyof typeof PLAYER_EXIT_INTENTS;

export function isPlayerExitIntent(type: string): type is PlayerExitIntent {
  return Object.hasOwn(PLAYER_EXIT_INTENTS, type);
}

export function exitKindFor(type: PlayerExitIntent): CombatExitKind {
  return PLAYER_EXIT_INTENTS[type];
}

/**
 * The one engine line each exit writes for the DM, in the player's own voice.
 *
 * Deliberately not the guard's `describeCombatExit`: that sentence is the DM declaring a
 * hostile's exit at the moment the scene ends, and reusing it here would have the DM read the
 * player's departure as a creature leaving the board.
 */
export function describePlayerExit(name: string, kind: CombatExitKind): string {
  return kind === 'fled' ? `${name} flees the fight.` : `${name} yields.`;
}

/** Off the board, or on its outermost ring: the token is no longer in the fight. */
export function hasLeftTheBoard(
  map: { width: number; height: number },
  point: { x: number; y: number },
): boolean {
  if (point.x < 0 || point.y < 0 || point.x >= map.width || point.y >= map.height) return true;
  return (
    point.x < EXIT_EDGE_CELLS ||
    point.y < EXIT_EDGE_CELLS ||
    point.x >= map.width - EXIT_EDGE_CELLS ||
    point.y >= map.height - EXIT_EDGE_CELLS
  );
}
/** The participant fields this module reads; the service's own row type does not name them. */
type ExitParticipant = {
  id: string;
  name?: string | null;
  participantType?: string | null;
  isActive: boolean;
  maxHp: number;
  isDisengaged?: boolean | null;
  status?: { currentHp: number; isConscious: boolean } | null;
};

export type OpportunityAttacker = {
  participant: ExitParticipant;
  weapon: { id: string; name: string; normalRange: number; ranged: boolean };
  distanceFeet: number;
};

/**
 * The one hostile that gets an attack as the player leaves, chosen the way the rules choose
 * it: a living, conscious, hostile creature within its own MELEE reach, nearest first, with line
 * of sight. A ranged weapon never provokes: an opportunity attack is a melee attack, so an archer
 * across the room gets none however far its bow carries. Null when the player Disengaged this
 * turn — that flag is cleared every round by `resetTurnResources`, which is exactly the window SRD
 * gives.
 */
export async function selectOpportunityAttacker(params: {
  state: CombatState;
  actor: ExitParticipant;
  map: { entities: MapEntity[] } | null;
  /** The attacker's own reach, read from its equipped or stored attack profile. */
  reachOf: (
    participant: ExitParticipant,
  ) => Promise<{ id: string; name: string; normalRange: number; ranged: boolean }>;
  hasLineOfSight: (fromId: string, toId: string) => boolean;
  distanceFeet: (from: MapEntity, to: MapEntity) => number;
}): Promise<OpportunityAttacker | null> {
  const { state, actor, map, reachOf, hasLineOfSight, distanceFeet } = params;
  if (actor.isDisengaged || !map) return null;
  const from = map.entities.find((entity) => entity.id === actor.id);
  if (!from) return null;
  const inReach: OpportunityAttacker[] = [];
  for (const candidate of state.participants) {
    if (candidate.id === actor.id) continue;
    if (!isLiveHostile(candidate as unknown as Parameters<typeof isLiveHostile>[0])) continue;
    const to = map.entities.find((entity) => entity.id === candidate.id);
    if (!to || !hasLineOfSight(candidate.id, actor.id)) continue;
    const distance = distanceFeet(from, to);
    const weapon = await reachOf(candidate as unknown as ExitParticipant);
    // For a melee weapon `normalRange` is its reach: 5 ft, or 10 ft for a reach weapon.
    if (weapon.ranged || distance > weapon.normalRange) continue;
    inReach.push({
      participant: candidate as unknown as ExitParticipant,
      weapon,
      distanceFeet: distance,
    });
  }
  return inReach.sort((left, right) => left.distanceFeet - right.distanceFeet)[0] ?? null;
}

export type PlayerExitResult = {
  /**
   * The exit slug recorded against the player's own participant. Null when the provoked attack
   * put the player at 0 HP: a dying hero has not left, the death-save flow owns them now.
   */
  exit: CombatExitKind | null;
  /** What the provoked opportunity attack did, when one was. */
  opportunityAttack: { attackerName: string; hit: boolean; finalDamage: number } | null;
};

/**
 * Record the player's exit: the provoked opportunity attack first (flee only), then the
 * participant leaves the turn order and the DM is told in one engine line.
 *
 * The order is the rule's, and it is also why the engine fact carries both: the attack lands
 * before the player is out of reach, so a DM narrating a clean escape has to contradict the
 * dice it was just handed.
 *
 * The attack is resolved through a caller-supplied engine function rather than here, so this
 * module owns no rolls and no damage writes: the caller routes it through the same
 * `executeCombatIntent` attack branch every other attack in the game takes.
 */
export async function recordPlayerExit(params: {
  encounterId: string;
  sessionId: string;
  userId: string;
  state: CombatState;
  actorId: string;
  intent: PlayerExitIntent;
  /** Resolves the provoked attack through the engine. Null skips it (yield, or no reach). */
  resolveOpportunityAttack: (attacker: OpportunityAttacker) => Promise<{
    hit?: boolean;
    finalDamage?: number;
    targetNewHp?: number;
    targetIsConscious?: boolean;
    targetIsDead?: boolean;
    isCritical?: boolean;
  } | null>;
  selectAttacker: (actor: ExitParticipant) => Promise<OpportunityAttacker | null>;
  markExited: (encounterId: string, participantId: string) => Promise<void>;
  label: (participantId: string) => string;
  /** The engine slug the narration contract matches actor and target on, not the display name. */
  slugOf: (participantId: string) => string;
}): Promise<PlayerExitResult> {
  const { encounterId, sessionId, userId, state, actorId, intent } = params;
  const kind = exitKindFor(intent);
  const actor = state.participants.find((participant) => participant.id === actorId) as unknown as
    | ExitParticipant
    | undefined;
  if (!actor) throw new Error(`Player exit: unknown participant ${actorId}`);

  let opportunityAttack: PlayerExitResult['opportunityAttack'] = null;
  let playerDowned = false;
  if (intent === 'flee') {
    const attacker = await params.selectAttacker(actor);
    if (attacker) {
      const attackerName = params.label(attacker.participant.id);
      const targetName = params.label(actorId);
      // Resolved, or nothing is said about it. A reaction the engine refused must leave NO trace
      // in the DM's context: writing an attack line for a blow that never rolled is precisely the
      // fabrication #2524 exists to stop, and the DM would narrate a hit out of it.
      const outcome = await params.resolveOpportunityAttack(attacker).catch((error) => {
        // The exit must not be lost to a failed reaction: the player is leaving either way, and
        // a refused attack is recoverable from the log while a stranded fight is not.
        logger.warn({
          msg: 'PLAYER_EXIT_OPPORTUNITY_ATTACK_FAILED',
          encounterId,
          sessionId,
          attackerId: attacker.participant.id,
          actorId,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      });
      if (outcome) {
        opportunityAttack = {
          attackerName,
          hit: outcome.hit === true,
          finalDamage: Number(outcome.finalDamage ?? 0),
        };
        await recordDmTacticalFact(
          sessionId,
          describeResolvedAttack(attackerName, targetName, outcome, attacker.weapon.name),
          {
            kind: 'attack',
            actorSlug: params.slugOf(attacker.participant.id),
            actorIsPlayer: false,
            targetSlug: params.slugOf(actorId),
            hit: outcome.hit,
          },
        );
        playerDowned =
          outcome.targetIsDead === true ||
          outcome.targetIsConscious === false ||
          (outcome.targetNewHp != null && outcome.targetNewHp <= 0);
      }
    }
  }

  // A player the blow put at 0 HP is dying, not gone: they stay in the turn order for the
  // death-save flow, and the DM was just told they are UNCONSCIOUS. Recording the exit anyway
  // would take a dying hero out of the order and let the DM's end be accepted as an abandonment.
  if (playerDowned) {
    logger.info({
      msg: 'PLAYER_EXIT_ABORTED_PLAYER_DOWNED',
      encounterId,
      sessionId,
      userId,
      actorId,
      intent,
      opportunityAttack: opportunityAttack?.attackerName ?? null,
    });
    return { exit: null, opportunityAttack };
  }

  await params.markExited(encounterId, actorId);
  await recordDmTacticalFact(sessionId, describePlayerExit(params.label(actorId), kind));
  // The party's exit slug, written now so the ledger can tell a surrender from a flight: the end
  // handler only knows the encounter was abandoned, and used to write every abandonment as fled.
  try {
    await NarrativeLedgerService.assertFact(
      {
        sessionId,
        subjectType: 'party',
        subjectName: 'party',
        predicate: 'status',
        value: { state: kind, encounterId },
        knownBy: ['dm'],
        source: 'engine',
      },
      userId,
    );
  } catch (error) {
    logger.warn({
      msg: 'NARRATIVE_FACT_WRITE_FAILED',
      encounterId,
      sessionId,
      error: error instanceof Error ? error.message : error,
    });
  }
  logger.info({
    msg: 'PLAYER_EXIT_RECORDED',
    encounterId,
    sessionId,
    userId,
    actorId,
    intent,
    exit: kind,
    opportunityAttack: opportunityAttack?.attackerName ?? null,
  });
  return { exit: kind, opportunityAttack };
}
