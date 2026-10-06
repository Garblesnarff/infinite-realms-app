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

export type ActiveEncounter = {
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

/** The player cancelled a cast from the sheet or on the save card; the engine spent nothing. */
export const SPELL_CAST_CANCELLED_NOTICE = 'Cast cancelled. No spell slot was used.';

export function preflightErrorStatus(error: unknown): number | string | null {
  if (!error || typeof error !== 'object') return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' || typeof status === 'string' ? status : null;
}

export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

export type CombatTurnPreflightResult = {
  activeEncounter: ActiveEncounter | null | undefined;
  isInCombat: boolean;
  npcTurns?: AdvanceNpcTurnsResponse;
};

export type CombatTurnPreflightStatus = 'idle' | 'running' | 'ready' | 'unknown' | 'failed';

export type CombatTurnUiState = {
  holder: string | null;
  pendingIntent: string | null;
  preflight: CombatTurnPreflightStatus;
  error?: string;
};

export const INITIAL_COMBAT_TURN_UI_STATE: CombatTurnUiState = {
  holder: null,
  pendingIntent: null,
  preflight: 'idle',
};

export function playerParticipantForCharacter<
  P extends { participantType?: string; characterId?: string | null },
>(encounter: { participants?: P[] } | null | undefined, characterId?: string): P | undefined {
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

export function combatTurnUiStateForEncounter(
  encounter: ActiveEncounter | null | undefined,
  isInCombat: boolean,
  characterId?: string,
  preflight?: CombatTurnPreflightStatus,
): CombatTurnUiState {
  const player = playerParticipantForCharacter(encounter, characterId);
  const holder = encounter?.currentTurnParticipantId ?? null;
  const defaultPreflight: CombatTurnPreflightStatus = !isInCombat
    ? 'idle'
    : holder && player && isPlayerTurn(holder, player)
      ? 'ready'
      : 'unknown';

  return {
    holder,
    pendingIntent: encounter?.pendingIntent?.actorId ?? null,
    preflight: preflight ?? defaultPreflight,
  };
}

export function logCombatTurnUiState(state: CombatTurnUiState & { isSending: boolean }): void {
  logger.info('TURN_UI_STATE', {
    holder: state.holder,
    isSending: state.isSending,
    pendingIntent: state.pendingIntent,
    preflight: state.preflight,
  });
}

export function combatTurnErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'Unable to refresh the combat turn state.';
}

function failedCombatTurnUiState(
  encounter: ActiveEncounter | null | undefined,
  characterId: string | undefined,
  error: unknown,
): CombatTurnUiState {
  return {
    ...combatTurnUiStateForEncounter(encounter, true, characterId, 'failed'),
    error: combatTurnErrorMessage(error),
  };
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
  refreshCombatState: (signal?: AbortSignal) => Promise<ActiveEncounter | null | undefined>;
  signal?: AbortSignal;
}): Promise<CombatTurnPreflightResult> {
  const { sessionId, activeEncounter, characterId, refreshCombatState, signal } = params;
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

  const npcTurns = signal
    ? await userDataApi.advanceNpcTurns(sessionId, expectedCurrentParticipantId, signal)
    : await userDataApi.advanceNpcTurns(sessionId, expectedCurrentParticipantId);
  const refreshedEncounter = await refreshCombatState(signal);
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
    const clearResponse = signal
      ? await userDataApi.clearPendingCombatIntent(encounterId, signal)
      : await userDataApi.clearPendingCombatIntent(encounterId);
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

/**
 * Reconcile browser combat state after a player action has been resolved and the NPC loop has run.
 * The refresh is intentional even when the old render said it was the player's turn: resolution
 * advances initiative outside the reducer, so the old encounter cannot decide whether the UI is
 * ready for another declaration.
 */
export async function reconcileCombatTurnAfterAction<T extends ActiveEncounter>(params: {
  sessionId: string;
  activeEncounter: T | null | undefined;
  characterId?: string;
  refreshCombatState: (signal?: AbortSignal) => Promise<T | null | undefined>;
  signal?: AbortSignal;
}): Promise<{
  activeEncounter: T | null | undefined;
  isInCombat: boolean;
  uiState: CombatTurnUiState;
}> {
  const { sessionId, activeEncounter, characterId, refreshCombatState, signal } = params;

  let refreshedEncounter: T | null | undefined;
  try {
    refreshedEncounter = await refreshCombatState(signal);
  } catch (error) {
    if (isAbortError(error)) throw error;
    logger.warn('COMBAT_TURN_POST_ACTION_REFRESH_FAILED', {
      sessionId,
      encounterId: activeEncounter?.id ?? null,
      status: preflightErrorStatus(error),
    });
    return {
      activeEncounter,
      isInCombat: activeEncounter?.phase === 'active',
      uiState: failedCombatTurnUiState(activeEncounter, characterId, error),
    };
  }

  if (refreshedEncounter?.phase !== 'active') {
    return {
      activeEncounter: refreshedEncounter,
      isInCombat: false,
      uiState: combatTurnUiStateForEncounter(refreshedEncounter, false, characterId),
    };
  }

  try {
    const preflight = await preflightNpcTurnsBeforePlayerDeclaration({
      sessionId,
      activeEncounter: refreshedEncounter,
      characterId,
      refreshCombatState,
      signal,
    });
    return {
      activeEncounter: preflight.activeEncounter as T | null | undefined,
      isInCombat: preflight.isInCombat,
      uiState: combatTurnUiStateForEncounter(
        preflight.activeEncounter,
        preflight.isInCombat,
        characterId,
      ),
    };
  } catch (error) {
    if (isAbortError(error)) throw error;
    logger.warn('COMBAT_TURN_POST_ACTION_PREFLIGHT_FAILED', {
      sessionId,
      encounterId: refreshedEncounter.id ?? null,
      status: preflightErrorStatus(error),
    });
    return {
      activeEncounter: refreshedEncounter,
      isInCombat: true,
      uiState: failedCombatTurnUiState(refreshedEncounter, characterId, error),
    };
  }
}
