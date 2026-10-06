import {
  facingName,
  rosterEntryForParticipant,
} from '../../../../../../shared/engine-display-name';

import type { CombatEncounter } from '@/types/combat-encounter';

import { isHostileParticipantType } from '@/services/combat/engine-result-card';
import { participantVital } from '@/services/combat/participant-vital';

export type TurnActorState = 'acted' | 'now' | 'waiting';

export interface TurnActor {
  id: string;
  name: string;
  initials: string;
  initiative: number;
  isPlayer: boolean;
  isEnemy: boolean;
  /** A player on the floor with death saves owed: their turn is the save, nothing else (#2518). */
  isDying: boolean;
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

const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join('');

/**
 * One pass through the initiative order is a round. Who has acted is read off the order: everyone
 * ahead of the turn holder has, everyone behind has not (#2417).
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
    return {
      id: participant.id,
      name,
      initials: initialsOf(name),
      initiative: participant.initiative ?? 0,
      isPlayer: participant.participantType === 'player',
      isEnemy: isHostileParticipantType(participant.participantType),
      isDying: participantVital(participant) === 'dying',
      state: index < activeIndex ? 'acted' : index === activeIndex ? 'now' : 'waiting',
    };
  });
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

/** `Your turn`, the enemy's name, `Casting…`, or `<name> is acting…`. */
export function combatTurnText(summary: CombatTurnSummary, busy: CombatTurnBusy): string {
  if (busy === 'casting' && summary.active.isPlayer) return 'Casting…';
  if (busy && !summary.active.isPlayer) return `${summary.active.name} is acting…`;
  if (summary.active.isPlayer && summary.active.isDying) return 'Dying';
  return summary.active.isPlayer ? 'Your turn' : summary.active.name;
}
