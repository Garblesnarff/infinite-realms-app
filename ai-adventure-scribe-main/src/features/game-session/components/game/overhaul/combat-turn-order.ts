import {
  facingName,
  rosterEntryForParticipant,
} from '../../../../../../shared/engine-display-name';

import type { CombatEncounter } from '@/types/combat-encounter';

import { isHostileParticipantType } from '@/services/combat/engine-result-card';
import { participantVital } from '@/services/combat/participant-vital';

export type TurnActorState = 'acted' | 'now' | 'waiting' | 'down';

export interface TurnActor {
  id: string;
  name: string;
  initials: string;
  initiative: number;
  isPlayer: boolean;
  isEnemy: boolean;
  /** A player on the floor with death saves owed: their turn is the save, nothing else (#2518). */
  isDying: boolean;
  /** Whether this actor already spent their action this turn (#85 copy: "action used"). */
  actionTaken: boolean;
  state: TurnActorState;
}

export interface CombatTurnSummary {
  round: number;
  actors: TurnActor[];
  /** One-based: `Turn 1 of 2`. */
  turn: number;
  active: TurnActor;
  /** `Next: Captain Sarah Reeves.` or `Next: The Scholar starts round 3.` */
  nextLine: string;
}

const ARTICLES = new Set(['the', 'a', 'an']);

/** First letters of the first two significant words (#85): a leading article doesn't count. */
const initialsOf = (name: string): string => {
  const words = name.split(/\s+/).filter(Boolean);
  while (words.length > 1 && ARTICLES.has(words[0].toLowerCase())) words.shift();
  return words
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');
};

/**
 * One pass through the initiative order is a round. Who has acted is read off the order: everyone
 * ahead of the turn holder has, everyone behind has not (#2417).
 *
 * TODO (#2249): read getCurrentTurnInfo() here once it lands, instead of the raw encounter
 * state. Until then the encounter's turn pointer is the one turn source (#85).
 */
export function summarizeCombatTurn(
  encounter: Pick<
    CombatEncounter,
    'currentRound' | 'currentTurnParticipantId' | 'participants'
  > | null,
): CombatTurnSummary | null {
  if (!encounter?.participants.length || !encounter.currentTurnParticipantId) return null;
  // `currentTurnParticipantId` indexes the participants still in the order, so only they count.
  const inOrder = encounter.participants.filter((participant) => participant.isActive !== false);
  const roster = inOrder.map(rosterEntryForParticipant);
  const ordered = inOrder.slice().sort((a, b) => (b.initiative ?? 0) - (a.initiative ?? 0));
  const activeIndex = ordered.findIndex(
    (participant) => participant.id === encounter.currentTurnParticipantId,
  );
  if (activeIndex < 0) return null;
  const actors = ordered.map<TurnActor>((participant, index) => {
    const name = facingName(undefined, participant.id, roster);
    // A dead creature shows as down, not as "acted": the inline tracker read its state off the
    // initiative position alone, so a kill kept showing "Acted" and the "N of M have acted"
    // count stayed wrong (#223 CB-007). Players go through participantVital; monsters die at
    // 0 HP with no death saves (2014 5e), so `isDead` or 0 HP is the marker.
    const isDown =
      participant.isDead === true ||
      (participant.participantType !== 'player' && participant.currentHitPoints <= 0);
    return {
      id: participant.id,
      name,
      initials: initialsOf(name),
      initiative: participant.initiative ?? 0,
      isPlayer: participant.participantType === 'player',
      isEnemy: isHostileParticipantType(participant.participantType),
      isDying: participantVital(participant) === 'dying',
      actionTaken: participant.actionTaken === true,
      state: isDown
        ? 'down'
        : index < activeIndex
          ? 'acted'
          : index === activeIndex
            ? 'now'
            : 'waiting',
    };
  });
  // Token labels are unique (#85): a second actor with the same initials gets a number, so two
  // "TH" tokens never sit side by side.
  const usedInitials = new Map<string, number>();
  for (const actor of actors) {
    const count = (usedInitials.get(actor.initials) ?? 0) + 1;
    usedInitials.set(actor.initials, count);
    if (count > 1) actor.initials = `${actor.initials}${count}`;
  }
  const round = encounter.currentRound;
  const last = activeIndex === actors.length - 1;
  return {
    round,
    actors,
    turn: activeIndex + 1,
    active: actors[activeIndex],
    nextLine: last
      ? `Next: ${actors[0].name} starts round ${round + 1}.`
      : `Next: ${actors[activeIndex + 1].name}.`,
  };
}

export type CombatTurnBusy = 'casting' | 'acting' | null;

/**
 * How many combatants have acted this round. Read off the actor states, not the turn position:
 * a dead creature shows as down, not acted, so it must not count (#223 CB-007).
 */
export function actedCount(summary: CombatTurnSummary): number {
  return summary.actors.filter((actor) => actor.state === 'acted').length;
}

export interface NearestEnemy {
  name: string;
  feet: number;
}

/**
 * The nearest enemy to the player, in feet (#85). Positions are grid squares and the table
 * plays 5 ft to a square, so the distance is the Chebyshev step count x 5. When either side
 * has no position there is no distance to report, and the copy omits the clause rather than
 * inventing one.
 */
export function nearestEnemyDistanceFeet(
  encounter: Pick<CombatEncounter, 'participants'> | null,
): NearestEnemy | null {
  if (!encounter) return null;
  const roster = encounter.participants
    .filter((participant) => participant.isActive !== false)
    .map(rosterEntryForParticipant);
  const player = encounter.participants.find(
    (participant) => participant.participantType === 'player' && participant.isActive !== false,
  );
  if (!player?.position) return null;
  let best: NearestEnemy | null = null;
  for (const enemy of encounter.participants) {
    if (
      !isHostileParticipantType(enemy.participantType) ||
      enemy.isActive === false ||
      !enemy.position
    ) {
      continue;
    }
    const steps = Math.max(
      Math.abs(enemy.position.x - player.position.x),
      Math.abs(enemy.position.y - player.position.y),
    );
    const feet = steps * 5;
    if (best === null || feet < best.feet) {
      best = { name: facingName(undefined, enemy.id, roster), feet };
    }
  }
  return best;
}

/**
 * The bar's title line (#85 copy table), with the in-flight overrides kept: a sheet cast
 * still reads `Casting…`, an enemy holding a turn being answered still reads as acting.
 * `playerDown` covers a player at 0 HP whose unconscious flag hasn't landed yet; the
 * summary's own isDying covers the usual death-save flow.
 */
export function turnBarTitle(
  summary: CombatTurnSummary,
  busy: CombatTurnBusy,
  playerDown = false,
): string {
  const { active } = summary;
  if (active.isPlayer && (active.isDying || playerDown)) return 'You are down';
  if (busy === 'casting' && active.isPlayer) return 'Casting…';
  if (busy && !active.isPlayer) return `${active.name} is acting…`;
  return active.isPlayer ? 'Your turn' : `${active.name}'s turn`;
}

/** The bar's sub line (#85 copy table): the round plus what the turn means. */
export function turnBarSub(
  summary: CombatTurnSummary,
  enemyDistance: NearestEnemy | null,
  playerDown = false,
): string {
  const { active, round } = summary;
  if (active.isPlayer && (active.isDying || playerDown)) return '0 HP · roll a death saving throw';
  if (active.isPlayer && active.actionTaken) {
    return `Round ${round} · action used · bonus action and move left`;
  }
  if (active.isPlayer) {
    return enemyDistance
      ? `Round ${round} · ${enemyDistance.name} is ${enemyDistance.feet} ft away`
      : `Round ${round}`;
  }
  return `Round ${round} · wait for it to act`;
}
