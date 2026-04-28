import type { CombatSlice, TurnManagementActions } from './types';

export const createTurnSlice: CombatSlice<TurnManagementActions> = (set, get) => ({
  nextTurn: () => {
    const { activeEncounter } = get();
    if (!activeEncounter) return;

    const currentIndex = activeEncounter.participants.findIndex(
      (p) => p.id === activeEncounter.currentTurnParticipantId,
    );
    let nextIndex = currentIndex + 1;
    let newRound = activeEncounter.currentRound;

    // If we've gone through all participants, start new round
    if (nextIndex >= activeEncounter.participants.length) {
      nextIndex = 0;
      newRound += 1;
    }

    // Skip unconscious/dead participants
    while (nextIndex < activeEncounter.participants.length) {
      const participant = activeEncounter.participants[nextIndex];
      if (participant.currentHitPoints > 0 || participant.deathSaves.failures < 3) {
        break;
      }
      nextIndex++;
    }

    const nextParticipant = activeEncounter.participants[nextIndex];

    set(
      {
        activeEncounter: {
          ...activeEncounter,
          currentRound: newRound,
          currentTurnParticipantId: nextParticipant?.id,
          roundsElapsed: newRound,
          participants: activeEncounter.participants.map((p) =>
            p.id === nextParticipant?.id
              ? {
                  ...p,
                  actionTaken: false,
                  bonusActionTaken: false,
                  reactionTaken: false,
                  movementUsed: 0,
                  reactionOpportunities: [],
                }
              : p,
          ),
        },
        activeReactionOpportunities: [],
      },
      false,
      'combat/nextTurn',
    );
  },

  rollInitiative: (participantId) => {
    const { activeEncounter } = get();
    if (!activeEncounter) return 0;

    const participant = activeEncounter.participants.find((p) => p.id === participantId);
    if (!participant) return 0;

    // Roll d20 + initiative modifier
    const roll = Math.floor(Math.random() * 20) + 1;
    const initiativeBonus = participant.initiative || 0;
    const newInitiative = roll + initiativeBonus;

    set(
      {
        activeEncounter: {
          ...activeEncounter,
          participants: activeEncounter.participants.map((p) =>
            p.id === participantId ? { ...p, initiative: newInitiative } : p,
          ),
        },
      },
      false,
      'combat/rollInitiative',
    );

    return newInitiative;
  },

  rerollInitiative: (participantId, newInitiative) => {
    const { activeEncounter } = get();
    if (!activeEncounter) return;

    set(
      {
        activeEncounter: {
          ...activeEncounter,
          participants: activeEncounter.participants.map((p) =>
            p.id === participantId ? { ...p, initiative: newInitiative } : p,
          ),
        },
      },
      false,
      'combat/rerollInitiative',
    );
  },

  updateInitiativeOrder: (newOrder) => {
    const { activeEncounter } = get();
    if (!activeEncounter) return;

    const reorderedParticipants = [...activeEncounter.participants].sort((a, b) => {
      const aIndex = newOrder.indexOf(a.id);
      const bIndex = newOrder.indexOf(b.id);
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });

    set(
      {
        activeEncounter: {
          ...activeEncounter,
          participants: reorderedParticipants,
        },
      },
      false,
      'combat/updateInitiativeOrder',
    );
  },

  setGroupId: (participantId, groupId) => {
    const { activeEncounter } = get();
    if (!activeEncounter) return;

    set(
      {
        activeEncounter: {
          ...activeEncounter,
          participants: activeEncounter.participants.map((p) =>
            p.id === participantId ? { ...p, groupId } : p,
          ),
        },
      },
      false,
      'combat/setGroupId',
    );
  },
});
