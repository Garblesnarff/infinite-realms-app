import logger from '@/lib/logger';
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

/**
 * Reconcile browser combat state after a player action has been resolved and the server's NPC loop
 * has run.
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

  const isInCombat = refreshedEncounter?.phase === 'active';
  return {
    activeEncounter: refreshedEncounter,
    isInCombat,
    uiState: combatTurnUiStateForEncounter(refreshedEncounter, isInCombat, characterId),
  };
}
