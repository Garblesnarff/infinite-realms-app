import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  preflightNpcTurnsBeforePlayerDeclaration,
  reconcileCombatTurnAfterAction,
} from '../combat-turn-preflight';

import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    advanceNpcTurns: vi.fn(),
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
    vi.mocked(userDataApi.advanceNpcTurns).mockResolvedValue({
      results: [],
      currentParticipant: { id: 'player-1', name: 'The Player', participantType: 'player' },
      combatEnded: false,
      iterationCount: 1,
      iterationCap: 4,
      capReached: false,
      transcriptLines: ['⚙️ Engine: The Professor misses.'],
    });
    vi.mocked(userDataApi.clearPendingCombatIntent).mockResolvedValue({ ok: true } as Response);
  });

  it('drains the observed NPC holder before the player declaration can be sent', async () => {
    const order: string[] = [];
    vi.mocked(userDataApi.advanceNpcTurns).mockImplementation(async () => {
      order.push('advanceNpcTurns');
      return {
        results: [],
        currentParticipant: { id: 'player-1', name: 'The Player', participantType: 'player' },
        combatEnded: false,
        iterationCount: 1,
        iterationCap: 4,
        capReached: false,
        transcriptLines: ['⚙️ Engine: The Professor misses.'],
      };
    });
    const refreshCombatState = vi.fn(async () => {
      order.push('refresh');
      return PLAYER_TURN;
    });

    const result = await preflightNpcTurnsBeforePlayerDeclaration({
      sessionId: 'session-1',
      activeEncounter: NPC_TURN,
      characterId: 'character-1',
      refreshCombatState,
    });
    order.push('chatWithDM');

    expect(userDataApi.advanceNpcTurns).toHaveBeenCalledWith('session-1', 'npc-1');
    expect(order).toEqual(['advanceNpcTurns', 'refresh', 'chatWithDM']);
    expect(result.activeEncounter).toEqual(PLAYER_TURN);
    expect(result.npcTurns?.transcriptLines).toEqual(['⚙️ Engine: The Professor misses.']);
  });

  it('does not advance when the player already holds the turn', async () => {
    const refreshCombatState = vi.fn().mockResolvedValue(PLAYER_TURN);

    const result = await preflightNpcTurnsBeforePlayerDeclaration({
      sessionId: 'session-1',
      activeEncounter: PLAYER_TURN,
      characterId: 'character-1',
      refreshCombatState,
    });

    expect(userDataApi.advanceNpcTurns).not.toHaveBeenCalled();
    expect(refreshCombatState).not.toHaveBeenCalled();
    expect(result.npcTurns).toBeUndefined();
  });

  it('discards a legacy player pending intent after the NPC handoff reaches player turn', async () => {
    const pendingIntent = {
      actorId: 'player-1',
      actionType: 'attack',
      targetIds: ['npc-1'],
      sourceText: 'I punch The Professor',
      queuedOnTurn: 1,
      queuedOnRound: 1,
    };
    const refreshCombatState = vi.fn().mockResolvedValue({
      ...PLAYER_TURN,
      pendingIntent,
    });

    const result = await preflightNpcTurnsBeforePlayerDeclaration({
      sessionId: 'session-1',
      activeEncounter: { ...NPC_TURN, pendingIntent },
      characterId: 'character-1',
      refreshCombatState,
    });

    expect(userDataApi.clearPendingCombatIntent).toHaveBeenCalledTimes(1);
    expect(userDataApi.clearPendingCombatIntent).toHaveBeenCalledWith('encounter-1');
    expect(result.activeEncounter).toMatchObject({ pendingIntent: null });
    expect(logger.info).toHaveBeenCalledWith('PENDING_INTENT_DISCARDED', {
      sessionId: 'session-1',
      encounterId: 'encounter-1',
      actorId: 'player-1',
    });
  });

  it('reconciles a move-only action followed by an NPC hit back to an enabled player turn', async () => {
    const refreshCombatState = vi
      .fn()
      .mockResolvedValueOnce(NPC_TURN)
      .mockResolvedValueOnce(PLAYER_TURN);
    vi.mocked(userDataApi.advanceNpcTurns).mockResolvedValueOnce({
      results: [
        {
          action: {
            actor_id: 'npc-1',
            action_type: 'attack',
            target_ids: ['player-1'],
            weapon_id: 'claw',
            spell_id: null,
            slot_level: null,
            movement_feet: 0,
          },
          outcomes: [{ finalDamage: 5, hit: true }],
          actorIsPlayer: false,
          transcriptLines: ['Chiropteran Hulk HIT, 5 damage'],
        },
      ],
      currentParticipant: { id: 'player-1', name: 'The Player', participantType: 'player' },
      combatEnded: false,
      iterationCount: 1,
      iterationCap: 4,
      capReached: false,
      transcriptLines: ['Chiropteran Hulk HIT, 5 damage'],
    });

    const result = await reconcileCombatTurnAfterAction({
      sessionId: 'session-1',
      activeEncounter: PLAYER_TURN,
      characterId: 'character-1',
      refreshCombatState,
    });

    expect(userDataApi.advanceNpcTurns).toHaveBeenCalledWith('session-1', 'npc-1');
    expect(refreshCombatState).toHaveBeenCalledTimes(2);
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

  it('marks a failed NPC pre-flight and preserves the error for the UI', async () => {
    const preflightError = new Error('NPC turn runner unavailable');
    vi.mocked(userDataApi.advanceNpcTurns).mockRejectedValueOnce(preflightError);
    const refreshCombatState = vi.fn().mockResolvedValue(NPC_TURN);

    const result = await reconcileCombatTurnAfterAction({
      sessionId: 'session-1',
      activeEncounter: PLAYER_TURN,
      characterId: 'character-1',
      refreshCombatState,
    });

    expect(result.uiState).toEqual({
      holder: 'npc-1',
      pendingIntent: null,
      preflight: 'failed',
      error: 'NPC turn runner unavailable',
    });
    expect(logger.warn).toHaveBeenCalledWith('COMBAT_TURN_POST_ACTION_PREFLIGHT_FAILED', {
      sessionId: 'session-1',
      encounterId: 'encounter-1',
      status: null,
    });
  });
});
