import type { AdvanceNpcTurnsResponse } from '@/services/user-data-api';

import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';
import { slugify } from '@/utils/slug';

type CombatParticipant = {
  id: string;
  characterId?: string | null;
  name?: string;
  participantType?: string;
};

type ActiveEncounter = {
  id?: string;
  phase?: string;
  currentTurnParticipantId?: string | null;
  participants?: CombatParticipant[];
  pendingIntent?: {
    actorId: string;
    actionType: string;
    targetIds: string[];
    sourceText: string;
    queuedOnTurn: number;
    queuedOnRound: number;
  } | null;
};

export const COMBAT_ENTRY_NPC_FIRST_ADVANCE_FAILED = 'COMBAT_ENTRY_NPC_FIRST_ADVANCE_FAILED';
export const NPC_FIRST_ADVANCE_FAILED_NOTICE =
  'The other combatants are still acting — try again in a moment.';

export function preflightErrorStatus(error: unknown): number | string | null {
  if (!error || typeof error !== 'object') return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' || typeof status === 'string' ? status : null;
}

export type CombatTurnPreflightResult = {
  activeEncounter: ActiveEncounter | null | undefined;
  isInCombat: boolean;
  npcTurns?: AdvanceNpcTurnsResponse;
};

function playerParticipantForCharacter(
  encounter: ActiveEncounter | null | undefined,
  characterId?: string,
): CombatParticipant | undefined {
  const players = encounter?.participants?.filter(
    (participant) => participant.participantType === 'player',
  );
  if (!players?.length) return undefined;
  return (
    (characterId ? players.find((participant) => participant.characterId === characterId) : null) ??
    (players.length === 1 ? players[0] : undefined)
  );
}

function isPlayerTurn(
  participantId: string | null | undefined,
  player: CombatParticipant | undefined,
): boolean {
  return Boolean(
    participantId &&
    player &&
    (participantId === player.id || slugify(player.name ?? '') === participantId),
  );
}

function pendingIntentForEncounter(
  initialEncounter: ActiveEncounter,
  refreshedEncounter: ActiveEncounter | null | undefined,
): ActiveEncounter['pendingIntent'] {
  if (
    refreshedEncounter &&
    Object.prototype.hasOwnProperty.call(refreshedEncounter, 'pendingIntent')
  ) {
    return refreshedEncounter.pendingIntent;
  }
  return initialEncounter.pendingIntent;
}

/**
 * Drain an NPC-held encounter before the player's declaration reaches the DM.
 *
 * The expected participant id makes this safe when two tabs submit at once: the API either drains
 * the holder we observed or returns the authoritative winner after the other request advanced it.
 */
export async function preflightNpcTurnsBeforePlayerDeclaration(params: {
  sessionId: string;
  activeEncounter: ActiveEncounter | null | undefined;
  characterId?: string;
  refreshCombatState: () => Promise<ActiveEncounter | null | undefined>;
}): Promise<CombatTurnPreflightResult> {
  const { sessionId, activeEncounter, characterId, refreshCombatState } = params;
  if (!sessionId || activeEncounter?.phase !== 'active') {
    return {
      activeEncounter,
      isInCombat: activeEncounter?.phase === 'active',
    };
  }

  const player = playerParticipantForCharacter(activeEncounter, characterId);
  if (!player || isPlayerTurn(activeEncounter.currentTurnParticipantId, player)) {
    return { activeEncounter, isInCombat: true };
  }

  const expectedCurrentParticipantId = activeEncounter.currentTurnParticipantId;
  if (!expectedCurrentParticipantId) return { activeEncounter, isInCombat: true };

  const npcTurns = await userDataApi.advanceNpcTurns(sessionId, expectedCurrentParticipantId);
  const refreshedEncounter = await refreshCombatState();
  if (refreshedEncounter?.phase === 'active') {
    const refreshedPlayer = playerParticipantForCharacter(refreshedEncounter, characterId);
    if (
      refreshedPlayer &&
      refreshedEncounter.currentTurnParticipantId &&
      !isPlayerTurn(refreshedEncounter.currentTurnParticipantId, refreshedPlayer)
    ) {
      throw new Error('NPC turn preflight did not reach the player turn');
    }
  }

  const playerTurnReturned =
    !npcTurns.combatEnded &&
    Boolean(
      npcTurns.currentParticipant && player && isPlayerTurn(npcTurns.currentParticipant.id, player),
    );
  const pendingIntent = pendingIntentForEncounter(activeEncounter, refreshedEncounter);
  const shouldDiscardPendingIntent =
    playerTurnReturned && pendingIntent && isPlayerTurn(pendingIntent.actorId, player);
  if (shouldDiscardPendingIntent) {
    const encounterId = refreshedEncounter?.id ?? activeEncounter.id;
    if (!encounterId) throw new Error('Cannot discard pending combat intent without an encounter');
    const clearResponse = await userDataApi.clearPendingCombatIntent(encounterId);
    if (!clearResponse.ok) {
      const error = Object.assign(
        new Error(`Pending combat intent could not be discarded (${clearResponse.status})`),
        { status: clearResponse.status },
      );
      throw error;
    }
    logger.info('PENDING_INTENT_DISCARDED', {
      sessionId,
      encounterId,
      actorId: pendingIntent.actorId,
    });
  }

  const returnedEncounter =
    shouldDiscardPendingIntent && refreshedEncounter
      ? { ...refreshedEncounter, pendingIntent: null }
      : refreshedEncounter;
  return {
    activeEncounter: returnedEncounter,
    isInCombat: !npcTurns.combatEnded && refreshedEncounter?.phase === 'active',
    npcTurns,
  };
}
