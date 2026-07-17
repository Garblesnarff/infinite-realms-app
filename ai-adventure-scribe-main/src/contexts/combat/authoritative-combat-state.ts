import { createCombatParticipant } from './participant-factory';

import type { CombatEncounter } from '@/types/combat';

type ServerStatus = { currentHp: number; maxHp: number; tempHp: number; isConscious: boolean };
type ServerCondition = { condition?: { name?: string; description?: string } };
type ServerParticipant = {
  id: string; characterId?: string | null; name: string; participantType: string;
  initiative: number; initiativeModifier: number; armorClass: number; maxHp: number; speed: number;
  actionUsed?: boolean; bonusActionUsed?: boolean; reactionUsed?: boolean;
  status?: ServerStatus | null; conditions?: ServerCondition[];
};
type ServerEncounter = {
  id: string; sessionId: string; status: string; currentRound: number; currentTurnOrder: number;
  startedAt: string | Date; endedAt?: string | Date | null;
};
export type AuthoritativeCombatPayload = {
  encounter: ServerEncounter;
  participants: ServerParticipant[];
};

export function mapAuthoritativeCombat(payload: AuthoritativeCombatPayload): CombatEncounter {
  const participants = payload.participants.map((participant) => createCombatParticipant({
    id: participant.id,
    characterId: participant.characterId ?? undefined,
    participantType: participant.participantType === 'player' ? 'player' : 'monster',
    name: participant.name,
    initiative: participant.initiative,
    initiativeBonus: participant.initiativeModifier,
    armorClass: participant.armorClass,
    maxHitPoints: participant.status?.maxHp ?? participant.maxHp,
    currentHitPoints: participant.status?.currentHp ?? participant.maxHp,
    temporaryHitPoints: participant.status?.tempHp ?? 0,
    speed: participant.speed,
    actionTaken: participant.actionUsed ?? false,
    bonusActionTaken: participant.bonusActionUsed ?? false,
    reactionTaken: participant.reactionUsed ?? false,
    isUnconscious: participant.status ? !participant.status.isConscious : false,
    conditions: (participant.conditions ?? []).flatMap((entry) => entry.condition?.name ? [{
      name: entry.condition.name.toLowerCase() as never,
      description: entry.condition.description ?? entry.condition.name,
      duration: -1,
      concentrationRequired: false,
    }] : []),
  }, { rollInitiative: false }));
  return {
    id: payload.encounter.id,
    sessionId: payload.encounter.sessionId,
    phase: payload.encounter.status === 'active' ? 'active' : 'conclusion',
    currentRound: payload.encounter.currentRound,
    currentTurnParticipantId: participants[payload.encounter.currentTurnOrder]?.id,
    participants,
    actions: [],
    roundsElapsed: payload.encounter.currentRound,
    startTime: new Date(payload.encounter.startedAt),
    endTime: payload.encounter.endedAt ? new Date(payload.encounter.endedAt) : undefined,
  };
}
