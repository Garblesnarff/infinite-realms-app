import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { useCombatState } from '../use-combat-state';

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
    it('should reduce current HP', () => {
      const { result } = renderHook(() => useCombatState(20));

      act(() => {
        result.current.setDamageInput('5');
      });

      act(() => {
        result.current.applyDamage();
      });

      expect(result.current.combatState.currentHp).toBe(15);
      expect(result.current.damageInput).toBe('');
    });

    it('should reduce temp HP first', () => {
      const { result } = renderHook(() => useCombatState(20));

      act(() => {
        result.current.setCombatState(prev => ({ ...prev, tempHp: 10 }));
      });

      act(() => {
        result.current.setDamageInput('4');
      });

      act(() => {
        result.current.applyDamage();
      });

      expect(result.current.combatState.tempHp).toBe(6);
      expect(result.current.combatState.currentHp).toBe(20);
    });

    it('should overflow damage from temp HP to current HP', () => {
      const { result } = renderHook(() => useCombatState(20));

      act(() => {
        result.current.setCombatState(prev => ({ ...prev, tempHp: 10 }));
      });

      act(() => {
        result.current.setDamageInput('15');
      });

      act(() => {
        result.current.applyDamage();
      });

      expect(result.current.combatState.tempHp).toBe(0);
      expect(result.current.combatState.currentHp).toBe(15);
    });

    it('should not reduce current HP below 0', () => {
      const { result } = renderHook(() => useCombatState(20));

      act(() => {
        result.current.setDamageInput('100');
      });

      act(() => {
        result.current.applyDamage();
      });

      expect(result.current.combatState.currentHp).toBe(0);
    });

    it('should ignore non-numeric or zero damage input', () => {
      const { result } = renderHook(() => useCombatState(20));

      act(() => {
        result.current.setDamageInput('abc');
      });
      act(() => {
        result.current.applyDamage();
      });
      expect(result.current.combatState.currentHp).toBe(20);

      act(() => {
        result.current.setDamageInput('0');
      });
      act(() => {
        result.current.applyDamage();
      });
      expect(result.current.combatState.currentHp).toBe(20);

      act(() => {
        result.current.setDamageInput('-5');
      });
      act(() => {
        result.current.applyDamage();
      });
      expect(result.current.combatState.currentHp).toBe(20);
    });
  });

  describe('applyHealing', () => {
    it('should increase current HP', () => {
      const { result } = renderHook(() => useCombatState(20));

      // First damage the character
      act(() => {
        result.current.setCombatState(prev => ({ ...prev, currentHp: 10 }));
      });

      act(() => {
        result.current.setHealingInput('5');
      });

      act(() => {
        result.current.applyHealing();
      });

      expect(result.current.combatState.currentHp).toBe(15);
      expect(result.current.healingInput).toBe('');
    });

    it('should not exceed max HP', () => {
      const { result } = renderHook(() => useCombatState(20));

      act(() => {
        result.current.setCombatState(prev => ({ ...prev, currentHp: 18 }));
      });

      act(() => {
        result.current.setHealingInput('10');
      });

      act(() => {
        result.current.applyHealing();
      });

      expect(result.current.combatState.currentHp).toBe(20);
    });

    it('should ignore non-numeric or zero healing input', () => {
      const { result } = renderHook(() => useCombatState(20));

      act(() => {
        result.current.setCombatState(prev => ({ ...prev, currentHp: 10 }));
      });

      act(() => {
        result.current.setHealingInput('abc');
      });
      act(() => {
        result.current.applyHealing();
      });
      expect(result.current.combatState.currentHp).toBe(10);

      act(() => {
        result.current.setHealingInput('0');
      });
      act(() => {
        result.current.applyHealing();
      });
      expect(result.current.combatState.currentHp).toBe(10);

      act(() => {
        result.current.setHealingInput('-5');
      });
      act(() => {
        result.current.applyHealing();
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
});
