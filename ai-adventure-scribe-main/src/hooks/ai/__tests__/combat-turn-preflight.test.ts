import { describe, expect, it, vi, beforeEach } from 'vitest';

import { reconcileCombatTurnAfterAction } from '../combat-turn-preflight';

import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    clearPendingCombatIntent: vi.fn(),
  },
}));

const NPC_TURN = {
  id: 'encounter-1',
  phase: 'active',
  currentTurnParticipantId: 'npc-1',
  participants: [
    { id: 'player-1', characterId: 'character-1', name: 'The Player', participantType: 'player' },
    { id: 'npc-1', name: 'The Professor', participantType: 'monster' },
  ],
};

const PLAYER_TURN = { ...NPC_TURN, currentTurnParticipantId: 'player-1' };

describe('combat player-turn pre-flight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(userDataApi.clearPendingCombatIntent).mockResolvedValue({ ok: true } as Response);
  });

  // Migrated (#2658 step 3): was "drains the observed NPC holder before the player declaration can be sent"
  it('has no client NPC advance: the server runs the creatures, and the client only reads the board', async () => {
    const actual = await vi.importActual<{ userDataApi: object }>('@/services/user-data-api');
    expect('advanceNpcTurns' in actual.userDataApi).toBe(false);
    const refreshCombatState = vi.fn().mockResolvedValue(PLAYER_TURN);

    const result = await reconcileCombatTurnAfterAction({
      sessionId: 'session-1',
      activeEncounter: NPC_TURN,
      characterId: 'character-1',
      refreshCombatState,
    });

    expect(refreshCombatState).toHaveBeenCalledTimes(1);
    expect(result.activeEncounter).toEqual(PLAYER_TURN);
  });

  // Migrated (#2658 step 3): was "does not advance when the player already holds the turn"
  it('reconciles a player-held board to a ready turn with one refresh and nothing else', async () => {
    const refreshCombatState = vi.fn().mockResolvedValue(PLAYER_TURN);

    const result = await reconcileCombatTurnAfterAction({
      sessionId: 'session-1',
      activeEncounter: PLAYER_TURN,
      characterId: 'character-1',
      refreshCombatState,
    });

    expect(refreshCombatState).toHaveBeenCalledTimes(1);
    expect(userDataApi.clearPendingCombatIntent).not.toHaveBeenCalled();
    expect(result.uiState).toEqual({ holder: 'player-1', pendingIntent: null, preflight: 'ready' });
  });

  // Migrated (#2658 step 3): was "discards a legacy player pending intent after the NPC handoff reaches player turn"
  it('leaves a pending intent on the board for its confirmation: the client no longer discards it', async () => {
    const pendingIntent = {
      actorId: 'player-1',
      actionType: 'attack',
      targetIds: ['npc-1'],
      sourceText: 'I punch The Professor',
      queuedOnTurn: 1,
      queuedOnRound: 1,
    };
    const refreshCombatState = vi.fn().mockResolvedValue({ ...PLAYER_TURN, pendingIntent });

    const result = await reconcileCombatTurnAfterAction({
      sessionId: 'session-1',
      activeEncounter: { ...NPC_TURN, pendingIntent },
      characterId: 'character-1',
      refreshCombatState,
    });

    expect(userDataApi.clearPendingCombatIntent).not.toHaveBeenCalled();
    expect(result.activeEncounter).toMatchObject({ pendingIntent });
    expect(result.uiState.pendingIntent).toBe('player-1');
    expect(logger.info).not.toHaveBeenCalledWith('PENDING_INTENT_DISCARDED', expect.anything());
  });

  // Migrated (#2658 step 3): was "reconciles a move-only action followed by an NPC hit back to an enabled player turn"
  it('reconciles a move-only action, after the server ran the NPC hit, to an enabled player turn', async () => {
    // The server ran the creature inside the action's own request; the refresh reads its board.
    const refreshCombatState = vi.fn().mockResolvedValueOnce(PLAYER_TURN);

    const result = await reconcileCombatTurnAfterAction({
      sessionId: 'session-1',
      activeEncounter: PLAYER_TURN,
      characterId: 'character-1',
      refreshCombatState,
    });

    expect(refreshCombatState).toHaveBeenCalledTimes(1);
    expect(result.uiState).toEqual({
      holder: 'player-1',
      pendingIntent: null,
      preflight: 'ready',
    });
    expect(result.isInCombat).toBe(true);
  });

  it('marks a failed post-action refresh and preserves the error for the UI', async () => {
    const refreshError = new Error('combat state refresh unavailable');
    const refreshCombatState = vi.fn().mockRejectedValue(refreshError);

    const result = await reconcileCombatTurnAfterAction({
      sessionId: 'session-1',
      activeEncounter: PLAYER_TURN,
      characterId: 'character-1',
      refreshCombatState,
    });

    expect(result.uiState).toEqual({
      holder: 'player-1',
      pendingIntent: null,
      preflight: 'failed',
      error: 'combat state refresh unavailable',
    });
    expect(logger.warn).toHaveBeenCalledWith('COMBAT_TURN_POST_ACTION_REFRESH_FAILED', {
      sessionId: 'session-1',
      encounterId: 'encounter-1',
      status: null,
    });
  });

  // Migrated (#2658 step 3): was "marks a failed NPC pre-flight and preserves the error for the UI"
  it('reports a creature still holding the turn as not ready, without driving it from the client', async () => {
    const refreshCombatState = vi.fn().mockResolvedValue(NPC_TURN);

    const result = await reconcileCombatTurnAfterAction({
      sessionId: 'session-1',
      activeEncounter: PLAYER_TURN,
      characterId: 'character-1',
      refreshCombatState,
    });

    expect(refreshCombatState).toHaveBeenCalledTimes(1);
    expect(result.uiState).toEqual({ holder: 'npc-1', pendingIntent: null, preflight: 'unknown' });
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
