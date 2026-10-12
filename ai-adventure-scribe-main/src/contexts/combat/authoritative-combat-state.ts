import { createCombatParticipant } from './participant-factory';

import type { CombatEncounter } from '@/types/combat';

type ServerStatus = {
  currentHp: number;
  maxHp: number;
  tempHp: number;
  isConscious: boolean;
  /** The death-save tallies the server counts. Absent on payloads older than #2518. */
  deathSavesSuccesses?: number;
  deathSavesFailures?: number;
};
/** The server's player state machine (`vitalStateOf`): standing, dying, stable or dead. */
export type ServerVitalState = 'standing' | 'dying' | 'stabilized' | 'dead';
type ServerCondition = { condition?: { name?: string; description?: string } };
type ServerParticipant = {
  id: string;
  characterId?: string | null;
  name: string;
  participantType: string;
  initiative: number;
  initiativeModifier: number;
  armorClass: number;
  maxHp: number;
  speed: number;
  actionUsed?: boolean;
  bonusActionUsed?: boolean;
  reactionUsed?: boolean;
  isActive?: boolean;
  status?: ServerStatus | null;
  vitalState?: ServerVitalState;
  conditions?: ServerCondition[];
  /** Stored attack profile; only its `displayName` is read here. */
  monsterAttack?: { displayName?: string } | null;
};
type ServerEncounter = {
  id: string;
  sessionId: string;
  status: string;
  currentRound: number;
  currentTurnOrder: number;
  startedAt: string | Date;
  endedAt?: string | Date | null;
  pendingIntent?: {
    actorId: string;
    actionType: string;
    targetIds: string[];
    sourceText: string;
    queuedOnTurn: number;
    queuedOnRound: number;
  } | null;
};
export type AuthoritativeCombatPayload = {
  encounter: ServerEncounter;
  participants: ServerParticipant[];
};

export function mapAuthoritativeCombat(payload: AuthoritativeCombatPayload): CombatEncounter {
  const participants = payload.participants.map((participant) =>
    createCombatParticipant(
      {
        id: participant.id,
        characterId: participant.characterId ?? undefined,
        participantType: participant.participantType === 'player' ? 'player' : 'monster',
        name: participant.name,
        displayName: participant.monsterAttack?.displayName,
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
        // Death saves come off the wire the server counted them on. They used to be rebuilt at
        // 0/0 here, so a dying character's tracker never showed the saves the engine recorded.
        deathSaves: {
          successes: participant.status?.deathSavesSuccesses ?? 0,
          failures: participant.status?.deathSavesFailures ?? 0,
        },
        isStable: participant.vitalState === 'stabilized',
        isDead: participant.vitalState === 'dead',
        isActive: participant.isActive,
        conditions: [
          ...(participant.conditions ?? []).flatMap((entry) =>
            entry.condition?.name
              ? [
                  {
                    name: entry.condition.name.toLowerCase() as never,
                    description: entry.condition.description ?? entry.condition.name,
                    duration: -1,
                    concentrationRequired: false,
                  },
                ]
              : [],
          ),
          // Unconscious is the persisted `is_conscious = false` at 0 HP, read as the condition
          // it is, so the tracker and the attack rules agree about a character on the floor.
          ...(participant.participantType === 'player' &&
          participant.status &&
          !participant.status.isConscious &&
          participant.status.currentHp <= 0 &&
          !(participant.conditions ?? []).some(
            (entry) => entry.condition?.name?.toLowerCase() === 'unconscious',
          )
            ? [
                {
                  name: 'unconscious' as never,
                  description: 'Unconscious: cannot act; attacks within 5 ft are critical hits.',
                  duration: -1,
                  concentrationRequired: false,
                },
              ]
            : []),
        ],
      },
      { rollInitiative: false },
    ),
  );
  // `currentTurnOrder` indexes the server's *active* participants — the same list
  // `CombatEncounterService.getCombatState` uses to pick `currentParticipant`. Indexing the
  // full list here would name a different actor the moment anyone is deactivated, and that
  // name is what the tactical-context fetch and the DM's ACTIVE line are built from.
  const activeIds = payload.participants
    .filter((participant) => participant.isActive !== false)
    .map((participant) => participant.id);
  const currentTurnParticipantId = activeIds[payload.encounter.currentTurnOrder];
  return {
    id: payload.encounter.id,
    sessionId: payload.encounter.sessionId,
    phase: payload.encounter.status === 'active' ? 'active' : 'conclusion',
    currentRound: payload.encounter.currentRound,
    currentTurnParticipantId,
    participants,
    origin: 'server',
    actions: [],
    roundsElapsed: payload.encounter.currentRound,
    startTime: new Date(payload.encounter.startedAt),
    endTime: payload.encounter.endedAt ? new Date(payload.encounter.endedAt) : undefined,
    pendingIntent: payload.encounter.pendingIntent ?? null,
  };
}
