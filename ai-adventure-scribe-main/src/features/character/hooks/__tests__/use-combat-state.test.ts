import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useCombatState } from '../use-combat-state';

import { userDataApi } from '@/services/user-data-api';

vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    applyCharacterDamage: vi.fn(),
    applyCharacterHealing: vi.fn(),
    applyCharacterTempHp: vi.fn(),
    updateCharacterStats: vi.fn(),
  },
}));

describe('useCombatState', () => {
  it('should initialize with correct default values', () => {
    const maxHp = 20;
    const { result } = renderHook(() => useCombatState(maxHp));

    expect(result.current.combatState).toEqual({
      currentHp: maxHp,
      tempHp: 0,
      deathSaves: { successes: 0, failures: 0 },
      conditions: [],
      initiative: 0,
    });
    expect(result.current.damageInput).toBe('');
    expect(result.current.healingInput).toBe('');
  });

  describe('applyDamage', () => {
    it('should reduce current HP', async () => {
      const { result } = renderHook(() => useCombatState(20));

      act(() => {
        result.current.setDamageInput('5');
      });

      await act(async () => {
        await result.current.applyDamage();
      });

      expect(result.current.combatState.currentHp).toBe(15);
      expect(result.current.damageInput).toBe('');
    });

    it('should reduce temp HP first', async () => {
      const { result } = renderHook(() => useCombatState(20));

      act(() => {
        result.current.setCombatState(prev => ({ ...prev, tempHp: 10 }));
      });

      act(() => {
        result.current.setDamageInput('4');
      });

      await act(async () => {
        await result.current.applyDamage();
      });

      expect(result.current.combatState.tempHp).toBe(6);
      expect(result.current.combatState.currentHp).toBe(20);
    });

    it('should overflow damage from temp HP to current HP', async () => {
      const { result } = renderHook(() => useCombatState(20));

      act(() => {
        result.current.setCombatState(prev => ({ ...prev, tempHp: 10 }));
      });

      act(() => {
        result.current.setDamageInput('15');
      });

      await act(async () => {
        await result.current.applyDamage();
      });

      expect(result.current.combatState.tempHp).toBe(0);
      expect(result.current.combatState.currentHp).toBe(15);
    });

    it('should not reduce current HP below 0', async () => {
      const { result } = renderHook(() => useCombatState(20));

      act(() => {
        result.current.setDamageInput('100');
      });

      await act(async () => {
        await result.current.applyDamage();
      });

      expect(result.current.combatState.currentHp).toBe(0);
    });

    it('should ignore non-numeric or zero damage input', async () => {
      const { result } = renderHook(() => useCombatState(20));

      act(() => {
        result.current.setDamageInput('abc');
      });
      await act(async () => {
        await result.current.applyDamage();
      });
      expect(result.current.combatState.currentHp).toBe(20);

      act(() => {
        result.current.setDamageInput('0');
      });
      await act(async () => {
        await result.current.applyDamage();
      });
      expect(result.current.combatState.currentHp).toBe(20);

      act(() => {
        result.current.setDamageInput('-5');
      });
      await act(async () => {
        await result.current.applyDamage();
      });
      expect(result.current.combatState.currentHp).toBe(20);
    });
  });

  describe('applyHealing', () => {
    it('should increase current HP', async () => {
      const { result } = renderHook(() => useCombatState(20));

      // First damage the character
      act(() => {
        result.current.setCombatState(prev => ({ ...prev, currentHp: 10 }));
      });

      act(() => {
        result.current.setHealingInput('5');
      });

      await act(async () => {
        await result.current.applyHealing();
      });

      expect(result.current.combatState.currentHp).toBe(15);
      expect(result.current.healingInput).toBe('');
    });

    it('should not exceed max HP', async () => {
      const { result } = renderHook(() => useCombatState(20));

      act(() => {
        result.current.setCombatState(prev => ({ ...prev, currentHp: 18 }));
      });

      act(() => {
        result.current.setHealingInput('10');
      });

      await act(async () => {
        await result.current.applyHealing();
      });

      expect(result.current.combatState.currentHp).toBe(20);
    });

    it('should ignore non-numeric or zero healing input', async () => {
      const { result } = renderHook(() => useCombatState(20));

      act(() => {
        result.current.setCombatState(prev => ({ ...prev, currentHp: 10 }));
      });

      act(() => {
        result.current.setHealingInput('abc');
      });
      await act(async () => {
        await result.current.applyHealing();
      });
      expect(result.current.combatState.currentHp).toBe(10);

      act(() => {
        result.current.setHealingInput('0');
      });
      await act(async () => {
        await result.current.applyHealing();
      });
      expect(result.current.combatState.currentHp).toBe(10);

      act(() => {
        result.current.setHealingInput('-5');
      });
      await act(async () => {
        await result.current.applyHealing();
      });
      expect(result.current.combatState.currentHp).toBe(10);
    });
  });

  describe('deathSaves', () => {
    it('should update successes and failures', () => {
      const { result } = renderHook(() => useCombatState(20));

      act(() => {
        result.current.updateDeathSave('success', true);
      });
      expect(result.current.combatState.deathSaves.successes).toBe(1);

      act(() => {
        result.current.updateDeathSave('failure', true);
      });
      expect(result.current.combatState.deathSaves.failures).toBe(1);

      act(() => {
        result.current.updateDeathSave('success', false);
      });
      expect(result.current.combatState.deathSaves.successes).toBe(0);
    });

    it('should cap successes and failures between 0 and 3', () => {
      const { result } = renderHook(() => useCombatState(20));

      // Cap at 3
      act(() => {
        result.current.updateDeathSave('success', true);
        result.current.updateDeathSave('success', true);
        result.current.updateDeathSave('success', true);
        result.current.updateDeathSave('success', true);
      });
      expect(result.current.combatState.deathSaves.successes).toBe(3);

      // Cap at 0
      act(() => {
        result.current.updateDeathSave('success', false);
        result.current.updateDeathSave('success', false);
        result.current.updateDeathSave('success', false);
        result.current.updateDeathSave('success', false);
      });
      expect(result.current.combatState.deathSaves.successes).toBe(0);
    });

    it('should reset death saves', () => {
      const { result } = renderHook(() => useCombatState(20));

      act(() => {
        result.current.updateDeathSave('success', true);
        result.current.updateDeathSave('failure', true);
      });

      act(() => {
        result.current.resetDeathSaves();
      });

      expect(result.current.combatState.deathSaves).toEqual({ successes: 0, failures: 0 });
    });
  });

  // #214 (QA-035): with a characterId, damage persists through the server.
  describe('server-persisted damage', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('calls POST /v1/characters/:id/damage and updates from the response', async () => {
      const onPersisted = vi.fn();
      (userDataApi.applyCharacterDamage as any).mockResolvedValue({
        currentHitPoints: 5,
        temporaryHitPoints: 0,
      });

      const { result } = renderHook(() =>
        useCombatState(8, 8, { characterId: 'char-1', onPersisted }),
      );

      act(() => {
        result.current.setDamageInput('3');
      });

      await act(async () => {
        await result.current.applyDamage();
      });

      expect(userDataApi.applyCharacterDamage).toHaveBeenCalledWith('char-1', 3);
      expect(result.current.combatState.currentHp).toBe(5);
      expect(result.current.damageInput).toBe('');
      // The sheet refreshes so the header shows the stored HP.
      expect(onPersisted).toHaveBeenCalled();
    });

    it('does not change local HP when the server write fails', async () => {
      (userDataApi.applyCharacterDamage as any).mockRejectedValue(new Error('nope'));

      const { result } = renderHook(() => useCombatState(8, 8, { characterId: 'char-1' }));

      act(() => {
        result.current.setDamageInput('3');
      });

      await act(async () => {
        await result.current.applyDamage();
      });

      expect(result.current.combatState.currentHp).toBe(8);
      expect(result.current.damageInput).toBe('3');
    });
  });

  // #214 (QA-036, B2): temp HP persists through the server and rejects garbage.
  // 2014 5e: temp HP do not stack — POST /:id/temp-hp keeps the higher value.
  describe('server-persisted temp HP', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('POSTs to /:id/temp-hp and updates local state from the response', async () => {
      const onPersisted = vi.fn();
      (userDataApi.applyCharacterTempHp as any).mockResolvedValue({
        temporaryHitPoints: 5,
      });

      const { result } = renderHook(() =>
        useCombatState(20, 20, { characterId: 'char-1', onPersisted }),
      );

      act(() => {
        result.current.setTempHpInput('5');
      });

      await act(async () => {
        await result.current.applyTempHp();
      });

      expect(userDataApi.applyCharacterTempHp).toHaveBeenCalledWith('char-1', 5);
      expect(result.current.combatState.tempHp).toBe(5);
      expect(result.current.tempHpInput).toBe('');
      expect(onPersisted).toHaveBeenCalled();
    });

    it('rejects non-numeric input instead of persisting 0', async () => {
      const { result } = renderHook(() => useCombatState(20, 20, { characterId: 'char-1' }));

      act(() => {
        result.current.setCombatState((prev) => ({ ...prev, tempHp: 7 }));
        result.current.setTempHpInput('abc');
      });

      await act(async () => {
        await result.current.applyTempHp();
      });

      expect(userDataApi.applyCharacterTempHp).not.toHaveBeenCalled();
      // Existing temp HP is untouched.
      expect(result.current.combatState.tempHp).toBe(7);
    });
  });

  // #214 (QA-036, strategist round 5): healing is a server-side delta. The
  // client sends the amount; the server adds it and clamps to max HP, so a
  // combat or DM HP change made in between is not lost.
  describe('server-persisted healing', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('POSTs the heal amount and updates from the server-computed response', async () => {
      const onPersisted = vi.fn();
      (userDataApi.applyCharacterHealing as any).mockResolvedValue({
        currentHitPoints: 12,
        temporaryHitPoints: 0,
      });

      const { result } = renderHook(() =>
        useCombatState(20, 8, { characterId: 'char-1', onPersisted }),
      );

      act(() => {
        result.current.setHealingInput('4');
      });

      await act(async () => {
        await result.current.applyHealing();
      });

      // The amount goes to the server; no absolute HP is computed client-side.
      expect(userDataApi.applyCharacterHealing).toHaveBeenCalledWith('char-1', 4);
      expect(result.current.combatState.currentHp).toBe(12);
      expect(result.current.healingInput).toBe('');
      expect(onPersisted).toHaveBeenCalled();
    });

    it('does not change local HP when the server write fails', async () => {
      (userDataApi.applyCharacterHealing as any).mockRejectedValue(new Error('nope'));

      const { result } = renderHook(() => useCombatState(20, 8, { characterId: 'char-1' }));

      act(() => {
        result.current.setHealingInput('4');
      });

      await act(async () => {
        await result.current.applyHealing();
      });

      expect(result.current.combatState.currentHp).toBe(8);
      expect(result.current.healingInput).toBe('4');
    });
  });
});
