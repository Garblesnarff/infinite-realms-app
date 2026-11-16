/**
 * #390: after an enemy turn in a normal fight, the player's pre-flight reads "ready" and the
 * composer's "Combat turn state needs to be refreshed." copy is never the state it shows.
 *
 * Real: reconcileCombatTurnAfterAction, combatReducer, initialCombatState. The harness hook
 * holds the encounter in React state through useReducer, the same way the combat context does.
 * Stubbed: the logger and the user-data API (no network). No live DM is called.
 *
 * The copy itself is rendered by GameMainContent's composerTurnStatus, which is not exported.
 * It shows the copy only for preflight 'unknown' or 'failed' (GameMainContent.tsx:68), so this
 * test pins the state that decides it.
 */
import { act, renderHook } from '@testing-library/react';
import { useReducer } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { reconcileCombatTurnAfterAction } from '../combat-turn-preflight';

import { combatReducer, initialCombatState } from '@/contexts/combat/combat-reducer';

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

type Encounter = {
  id: string;
  phase: string;
  currentTurnParticipantId: string | null;
  participants: Array<{
    id: string;
    characterId?: string | null;
    name: string;
    participantType: string;
  }>;
};

const PARTICIPANTS = [
  { id: 'player-1', characterId: 'character-1', name: 'The Player', participantType: 'player' },
  { id: 'npc-1', name: 'The Professor', participantType: 'monster' },
];

const encounterHeldBy = (holder: string): Encounter => ({
  id: 'encounter-1',
  phase: 'active',
  currentTurnParticipantId: holder,
  participants: PARTICIPANTS,
});

/** The server's encounter after the player ends a turn and the NPC loop has run back to the player. */
const afterEnemyTurn = (): Encounter => encounterHeldBy('player-1');

describe('combat turn pre-flight after an enemy turn (#390)', () => {
  it('reads ready for the player on every round of a normal fight, with no refresh copy', async () => {
    const { result } = renderHook(() => {
      const [state, dispatch] = useReducer(combatReducer, initialCombatState);
      return { state, dispatch };
    });

    // Round 1 starts on the player: seat the encounter through the real reducer.
    act(() => {
      result.current.dispatch({ type: 'SET_ENCOUNTER', encounter: encounterHeldBy('player-1') });
    });

    for (let round = 1; round <= 3; round++) {
      // The player ends the turn; the server holds the enemy's turn, then runs the NPC loop.
      act(() => {
        result.current.dispatch({ type: 'SET_ENCOUNTER', encounter: encounterHeldBy('npc-1') });
      });
      // The refreshed encounter is the post-NPC-loop state, carried through the real reducer.
      const refreshed = combatReducer(initialCombatState, {
        type: 'SET_ENCOUNTER',
        encounter: afterEnemyTurn(),
      }).activeEncounter as Encounter;
      const refreshCombatState = vi.fn(async () => refreshed);

      let reconciled:
        | Awaited<ReturnType<typeof reconcileCombatTurnAfterAction<Encounter>>>
        | undefined;
      await act(async () => {
        reconciled = await reconcileCombatTurnAfterAction({
          sessionId: 'session-1',
          activeEncounter: result.current.state.activeEncounter as Encounter,
          characterId: 'character-1',
          refreshCombatState,
        });
      });

      expect(refreshCombatState).toHaveBeenCalledTimes(1);
      expect(reconciled?.isInCombat).toBe(true);
      expect(reconciled?.uiState.holder).toBe('player-1');
      expect(reconciled?.uiState.preflight).toBe('ready');
      expect(reconciled?.uiState.error).toBeUndefined();
      // The copy shows only for 'unknown' or 'failed' (GameMainContent.tsx:68).
      expect(['unknown', 'failed']).not.toContain(reconciled?.uiState.preflight);
    }
  });
});
