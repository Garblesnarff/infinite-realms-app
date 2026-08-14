/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCombatDetection } from '../use-combat-detection';

import { createActionDescription, getDamageRollForWeapon } from '@/utils/combat/ai-narration-utils';
import { rollDice } from '@/utils/diceUtils';

vi.mock('@/utils/diceUtils', () => ({ rollDice: vi.fn() }));
vi.mock('@/utils/combat/ai-narration-utils', () => ({
  getDamageRollForWeapon: vi.fn(),
  createActionDescription: vi.fn(),
}));

describe('useCombatDetection', () => {
  beforeEach(() => vi.clearAllMocks());

  const setupHook = () => renderHook(() => useCombatDetection());

  describe('createCombatActionRoll legacy helper', () => {
    it('handles attack rolls', async () => {
      vi.mocked(rollDice).mockReturnValue({ total: 18, results: [13] } as never);
      vi.mocked(createActionDescription).mockReturnValue('Orc hits Player');
      const { result } = setupHook();

      const rollData = await result.current.createCombatActionRoll({
        rollType: 'attack',
        actor: 'Orc',
        target: 'Player',
      } as any);

      expect(rollDice).toHaveBeenCalledWith(20, 1, 5);
      expect(rollData).toMatchObject({ type: 'attack_roll', success: true });
    });

    it('handles damage rolls with and without a weapon', async () => {
      vi.mocked(getDamageRollForWeapon).mockReturnValue({ dice: 8, count: 1, modifier: 3 });
      vi.mocked(rollDice).mockReturnValue({ total: 7, results: [4] } as never);
      const { result } = setupHook();

      expect(
        await result.current.createCombatActionRoll({
          rollType: 'damage',
          actor: 'Orc',
          weapon: 'sword',
        } as any),
      ).toMatchObject({ type: 'damage_roll' });
      expect(getDamageRollForWeapon).toHaveBeenCalledWith('sword');

      expect(
        await result.current.createCombatActionRoll({
          rollType: 'damage',
          actor: 'Orc',
        } as any),
      ).toMatchObject({ type: 'damage_roll' });
      expect(rollDice).toHaveBeenLastCalledWith(8, 1, 3);
    });

    it('handles saves and skill checks and rejects unknown roll types', async () => {
      vi.mocked(rollDice)
        .mockReturnValueOnce({ total: 10, results: [8] } as never)
        .mockReturnValueOnce({ total: 15, results: [14] } as never);
      const { result } = setupHook();

      expect(
        await result.current.createCombatActionRoll({ rollType: 'save', actor: 'Player' } as any),
      ).toMatchObject({ type: 'saving_throw', success: false });
      expect(
        await result.current.createCombatActionRoll({ rollType: 'skill', actor: 'Player' } as any),
      ).toMatchObject({ type: 'skill_check', success: true });
      expect(
        await result.current.createCombatActionRoll({ rollType: 'unknown' } as any),
      ).toBeNull();
    });
  });
});
