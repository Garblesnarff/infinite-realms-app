/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  B2B_ENCOUNTER_ID,
  B2B_ENEMY_ID,
  B2B_PLAYER_ID,
  dashClientIntent,
  dodgeClientIntent,
  enemyAttackClientIntent,
  grappleClientIntent,
  hideClientIntent,
  shoveClientIntent,
} from '../../../../shared/test-fixtures/combat-b2b-intent-bodies';
import { useCombatActionHandlers } from '../use-combat-action-handlers';

import type { MonsterAttack } from '@/types/combat';

import logger from '@/lib/logger';
import { executeAuthoritativeCombatIntent } from '@/services/combat/combat-action-executor';
import { userDataApi } from '@/services/user-data-api';

vi.mock('@/lib/logger', () => ({
  default: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/services/combat/combat-action-executor', () => ({
  executeAuthoritativeCombatIntent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    applyCharacterDamage: vi.fn().mockResolvedValue({}),
    applyCharacterHealing: vi.fn().mockResolvedValue({}),
  },
}));

describe('useCombatActionHandlers', () => {
  const mockTakeAction = vi.fn().mockResolvedValue(undefined);
  const mockUpdateParticipant = vi.fn().mockResolvedValue(undefined);
  const mockNextTurn = vi.fn().mockResolvedValue(undefined);
  const mockValidateCombatAction = vi.fn().mockResolvedValue({
    isValid: true,
    suggestions: [],
    errors: [],
  });

  const mockParticipant = {
    id: 'p1',
    name: 'Hero',
    currentHitPoints: 10,
    maxHitPoints: 20,
    isUnconscious: false,
    activeConcentration: null,
  };

  const mockEnemy = {
    id: 'e1',
    name: 'Orc',
    currentHitPoints: 15,
    maxHitPoints: 15,
    isUnconscious: false,
  };

  const mockEncounter: {
    id: string;
    participants: unknown[];
    currentTurnParticipantId: string | null;
  } = {
    id: 'enc-1',
    participants: [mockParticipant, mockEnemy],
    currentTurnParticipantId: 'p1',
  };

  const defaultProps = {
    activeEncounter: mockEncounter as any,
    takeAction: mockTakeAction,
    updateParticipant: mockUpdateParticipant,
    nextTurn: mockNextTurn,
    validateCombatAction: mockValidateCombatAction,
    selectedEnemy: null as string | null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const setupHook = (props = defaultProps) => {
    return renderHook(() => useCombatActionHandlers(props));
  };

  it('should initialize with null validation and empty reactions', () => {
    const { result } = setupHook();
    expect(result.current.actionValidation).toBeNull();
    expect(result.current.reactionOpportunities).toEqual([]);
  });

  describe('handleCombatAction', () => {
    it('should do nothing if no active encounter', async () => {
      const { result } = setupHook({ ...defaultProps, activeEncounter: null });
      await act(async () => {
        await result.current.handleCombatAction('attack', 'p1');
      });
      expect(mockValidateCombatAction).not.toHaveBeenCalled();
    });

    it('should do nothing if participant not found', async () => {
      const { result } = setupHook();
      await act(async () => {
        await result.current.handleCombatAction('attack', 'non-existent');
      });
      expect(mockValidateCombatAction).not.toHaveBeenCalled();
    });
  });

  describe('handleEnemyAttack', () => {
    // The encounter the #621 B2b bodies name, so the client tests assert the shared fixture.
    const b2bEncounter = {
      id: B2B_ENCOUNTER_ID,
      participants: [
        { id: B2B_PLAYER_ID, name: 'Hero', conditions: [] },
        { id: B2B_ENEMY_ID, name: 'Orc', conditions: [] },
      ],
      currentTurnParticipantId: B2B_PLAYER_ID,
    };
    const b2bProps = { ...defaultProps, activeEncounter: b2bEncounter as any };

    it('should do nothing if no enemy selected', async () => {
      const { result } = setupHook();
      await act(async () => {
        await result.current.handleEnemyAttack({
          name: 'Bite',
          attackBonus: 0,
          damageRoll: '',
          damageType: 'piercing',
          reach: 5,
          description: 'Bite',
        } as MonsterAttack);
      });
      expect(mockTakeAction).not.toHaveBeenCalled();
    });

    it('should do nothing if selected enemy not found in encounter', async () => {
      const { result } = setupHook({ ...defaultProps, selectedEnemy: 'non-existent' });
      await act(async () => {
        await result.current.handleEnemyAttack({
          name: 'Bite',
          attackBonus: 0,
          damageRoll: '',
          damageType: 'piercing',
          reach: 5,
          description: 'Bite',
        } as MonsterAttack);
      });
      expect(mockTakeAction).not.toHaveBeenCalled();
    });

    it('should execute attack and advance turn', async () => {
      vi.useFakeTimers();
      const { result } = setupHook({ ...b2bProps, selectedEnemy: B2B_ENEMY_ID });
      const attack: MonsterAttack = {
        name: 'Greataxe',
        attackBonus: 5,
        damageRoll: '1d12+3',
        damageType: 'slashing',
        reach: 5,
        description: 'Greataxe',
      };

      await act(async () => {
        await result.current.handleEnemyAttack(attack);
      });

      // #621 B2b: the server rolls the enemy's attack and its damage. The browser sends the intent.
      expect(executeAuthoritativeCombatIntent).toHaveBeenCalledWith(
        B2B_ENCOUNTER_ID,
        enemyAttackClientIntent,
        'dm',
        expect.any(Number),
        'typed',
      );
      expect(mockTakeAction).not.toHaveBeenCalled();

      // Verify turn advancement
      expect(mockNextTurn).not.toHaveBeenCalled();
      act(() => {
        vi.advanceTimersByTime(1500);
      });
      expect(mockNextTurn).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('should send the same server attack when the menu attack has no damage roll', async () => {
      const { result } = setupHook({ ...b2bProps, selectedEnemy: B2B_ENEMY_ID });
      const attack: MonsterAttack = {
        name: 'Gaze',
        attackBonus: 0,
        damageRoll: '',
        damageType: 'psychic',
        reach: 30,
        description: 'Gaze',
      };

      await act(async () => {
        await result.current.handleEnemyAttack(attack);
      });

      expect(executeAuthoritativeCombatIntent).toHaveBeenCalledWith(
        B2B_ENCOUNTER_ID,
        enemyAttackClientIntent,
        'dm',
        expect.any(Number),
        'typed',
      );
    });

    it('sends no attack when the turn has no participant to target', async () => {
      const noTurn = { ...mockEncounter, currentTurnParticipantId: null };
      const { result } = setupHook({
        ...defaultProps,
        selectedEnemy: 'e1',
        activeEncounter: noTurn as any,
      });

      await act(async () => {
        await result.current.handleEnemyAttack({
          name: 'Gaze',
          attackBonus: 0,
          damageRoll: '',
          damageType: 'psychic',
          reach: 30,
          description: 'Gaze',
        });
      });

      expect(executeAuthoritativeCombatIntent).not.toHaveBeenCalled();
    });

    it('rolls no dice in the browser: the enemy attack carries no roll', async () => {
      const { result } = setupHook({ ...b2bProps, selectedEnemy: B2B_ENEMY_ID });
      await act(async () => {
        await result.current.handleEnemyAttack({
          name: 'Greataxe',
          attackBonus: 5,
          damageRoll: '1d12+3',
          damageType: 'slashing',
          reach: 5,
          description: 'Greataxe',
        });
      });
      const [, intent] = vi.mocked(executeAuthoritativeCombatIntent).mock.calls[0];
      expect(intent).not.toHaveProperty('d20');
      expect(intent).not.toHaveProperty('attackRoll');
    });

    describe('handleCombatAction server routing (#621 B2b)', () => {
      it('sends dash to the server intent, not the local engine', async () => {
        const { result } = setupHook(b2bProps);
        await act(async () => {
          await result.current.handleCombatAction('dash', B2B_PLAYER_ID);
        });
        expect(executeAuthoritativeCombatIntent).toHaveBeenCalledWith(
          B2B_ENCOUNTER_ID,
          dashClientIntent,
          'player',
          undefined,
          'action_bar',
        );
        expect(mockTakeAction).not.toHaveBeenCalled();
      });

      it('sends dodge to the server intent', async () => {
        const { result } = setupHook(b2bProps);
        await act(async () => {
          await result.current.handleCombatAction('dodge', B2B_PLAYER_ID);
        });
        expect(executeAuthoritativeCombatIntent).toHaveBeenCalledWith(
          B2B_ENCOUNTER_ID,
          dodgeClientIntent,
          'player',
          undefined,
          'action_bar',
        );
      });

      it('sends hide as a check with no target', async () => {
        const { result } = setupHook(b2bProps);
        await act(async () => {
          await result.current.handleCombatAction('hide', B2B_PLAYER_ID);
        });
        expect(executeAuthoritativeCombatIntent).toHaveBeenCalledWith(
          B2B_ENCOUNTER_ID,
          hideClientIntent,
          'player',
          undefined,
          'action_bar',
        );
      });

      it('sends grapple and shove as checks against the target, with no local roll', async () => {
        const { result } = setupHook(b2bProps);
        await act(async () => {
          await result.current.handleCombatAction('grapple', B2B_PLAYER_ID, B2B_ENEMY_ID);
          await result.current.handleCombatAction('shove', B2B_PLAYER_ID, B2B_ENEMY_ID);
        });
        expect(executeAuthoritativeCombatIntent).toHaveBeenNthCalledWith(
          1,
          B2B_ENCOUNTER_ID,
          grappleClientIntent,
          'player',
          undefined,
          'action_bar',
        );
        expect(executeAuthoritativeCombatIntent).toHaveBeenNthCalledWith(
          2,
          B2B_ENCOUNTER_ID,
          shoveClientIntent,
          'player',
          undefined,
          'action_bar',
        );
        expect(mockUpdateParticipant).not.toHaveBeenCalled();
      });

      it('sends nothing to the server for grapple with no target', async () => {
        const { result } = setupHook(b2bProps);
        await act(async () => {
          await result.current.handleCombatAction('grapple', B2B_PLAYER_ID);
        });
        expect(executeAuthoritativeCombatIntent).not.toHaveBeenCalled();
      });
    });
  });

  describe('handleApplyDamage (#621 Part B2a: the server applies damage)', () => {
    const encounterWith = (participant: Record<string, unknown>) =>
      ({
        id: 'enc-1',
        participants: [participant, mockEnemy],
        currentTurnParticipantId: 'p1',
      }) as any;
    const playerWithCharacter = { ...mockParticipant, characterId: 'character-1' };

    it('does nothing when there is no active encounter', async () => {
      const { result } = setupHook({ ...defaultProps, activeEncounter: null as any });
      await act(async () => {
        await result.current.handleApplyDamage('p1', 5, 'fire');
      });
      expect(userDataApi.applyCharacterDamage).not.toHaveBeenCalled();
      expect(mockUpdateParticipant).not.toHaveBeenCalled();
    });

    it('does nothing for a participant with no character: no server route, no local write', async () => {
      const { result } = setupHook({
        ...defaultProps,
        activeEncounter: encounterWith(mockParticipant),
      });
      await act(async () => {
        await result.current.handleApplyDamage('p1', 5, 'fire');
      });
      expect(userDataApi.applyCharacterDamage).not.toHaveBeenCalled();
      expect(mockUpdateParticipant).not.toHaveBeenCalled();
      expect(mockTakeAction).not.toHaveBeenCalled();
    });

    it('sends the damage and its type to the character damage route, with no local HP write', async () => {
      const { result } = setupHook({
        ...defaultProps,
        activeEncounter: encounterWith(playerWithCharacter),
      });
      await act(async () => {
        await result.current.handleApplyDamage('p1', 4, 'slashing');
      });
      expect(userDataApi.applyCharacterDamage).toHaveBeenCalledWith('character-1', 4, 'slashing');
      expect(mockUpdateParticipant).not.toHaveBeenCalled();
      expect(mockTakeAction).not.toHaveBeenCalled();
    });

    it('refreshes the encounter after the server accepts the damage', async () => {
      const refreshCombatState = vi.fn().mockResolvedValue(null);
      const { result } = setupHook({
        ...defaultProps,
        activeEncounter: encounterWith(playerWithCharacter),
        refreshCombatState,
      } as any);
      await act(async () => {
        await result.current.handleApplyDamage('p1', 4, 'slashing');
      });
      expect(refreshCombatState).toHaveBeenCalledTimes(1);
    });

    it('logs and does not refresh when the server refuses the damage', async () => {
      vi.mocked(userDataApi.applyCharacterDamage).mockRejectedValueOnce(new Error('network down'));
      const refreshCombatState = vi.fn().mockResolvedValue(null);
      const { result } = setupHook({
        ...defaultProps,
        activeEncounter: encounterWith(playerWithCharacter),
        refreshCombatState,
      } as any);
      await act(async () => {
        await result.current.handleApplyDamage('p1', 4, 'slashing');
      });
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to apply damage through the server:',
        expect.any(Error),
      );
      expect(refreshCombatState).not.toHaveBeenCalled();
    });
  });

  describe('handleHealing (#621 Part B2a: the server applies healing)', () => {
    const encounterWith = (participant: Record<string, unknown>) =>
      ({
        id: 'enc-1',
        participants: [participant, mockEnemy],
        currentTurnParticipantId: 'p1',
      }) as any;
    const playerWithCharacter = { ...mockParticipant, characterId: 'character-1' };

    it('does nothing for a participant with no character: no server route, no local write', async () => {
      const { result } = setupHook({
        ...defaultProps,
        activeEncounter: encounterWith(mockParticipant),
      });
      await act(async () => {
        await result.current.handleHealing('p1', 5);
      });
      expect(userDataApi.applyCharacterHealing).not.toHaveBeenCalled();
      expect(mockUpdateParticipant).not.toHaveBeenCalled();
      expect(mockTakeAction).not.toHaveBeenCalled();
    });

    it('sends the heal to the character heal route, with no local HP write', async () => {
      const { result } = setupHook({
        ...defaultProps,
        activeEncounter: encounterWith(playerWithCharacter),
      });
      await act(async () => {
        await result.current.handleHealing('p1', 5);
      });
      expect(userDataApi.applyCharacterHealing).toHaveBeenCalledWith('character-1', 5);
      expect(mockUpdateParticipant).not.toHaveBeenCalled();
      expect(mockTakeAction).not.toHaveBeenCalled();
    });

    it('refreshes the encounter after the server accepts the heal', async () => {
      const refreshCombatState = vi.fn().mockResolvedValue(null);
      const { result } = setupHook({
        ...defaultProps,
        activeEncounter: encounterWith(playerWithCharacter),
        refreshCombatState,
      } as any);
      await act(async () => {
        await result.current.handleHealing('p1', 5);
      });
      expect(refreshCombatState).toHaveBeenCalledTimes(1);
    });

    it('logs and does not refresh when the server refuses the heal', async () => {
      vi.mocked(userDataApi.applyCharacterHealing).mockRejectedValueOnce(new Error('network down'));
      const refreshCombatState = vi.fn().mockResolvedValue(null);
      const { result } = setupHook({
        ...defaultProps,
        activeEncounter: encounterWith(playerWithCharacter),
        refreshCombatState,
      } as any);
      await act(async () => {
        await result.current.handleHealing('p1', 5);
      });
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to heal through the server:',
        expect.any(Error),
      );
      expect(refreshCombatState).not.toHaveBeenCalled();
    });
  });
});
