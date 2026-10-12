import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InventoryMechanics } from '../server-bun/src/services/inventory/inventory-mechanics';
import { carryingCapacityForStrength } from '../shared/carrying-capacity';
import { useInventoryManager } from '../src/features/character/hooks/use-inventory-manager';
import { calculateCarryingCapacity } from '../src/utils/character/basic-math';
import { transformCharacterData } from '../src/utils/character/data-transformers';
import { calculateEncumbrance } from '../src/utils/character-calculations';

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const characterForStrength = (strength: number): ReturnType<typeof transformCharacterData> =>
  transformCharacterData(
    {
      id: 'capacity-character',
      user_id: 'capacity-owner',
      name: 'Carrier',
      race: 'Human',
      class: 'Fighter',
      level: 1,
    },
    { strength, dexterity: 10, constitution: 10, intelligence: 10, wisdom: 10, charisma: 10 },
    [],
  );

describe('shared carrying capacity', () => {
  it.each([
    [1, 15],
    [8, 120],
    [10, 150],
    [15, 225],
    [20, 300],
    [29, 435],
    [30, 450],
  ])('STR %i has capacity %i pounds on every client and server path', (strength, expected) => {
    const character = characterForStrength(strength);
    expect(carryingCapacityForStrength(strength)).toBe(expected);
    expect(calculateCarryingCapacity(character)).toBe(expected);
    expect(calculateEncumbrance(character).carryingCapacity).toBe(expected);
    expect(InventoryMechanics.calculateCarryingCapacity(strength)).toBe(expected);
    expect(InventoryMechanics.calculateEncumbrance(strength, 0).carryingCapacity).toBe(expected);
    const { result, unmount } = renderHook(() => useInventoryManager(character));
    expect(result.current.carryingCapacity).toBe(expected);
    unmount();
  });

  it('preserves client score defaults outside the shared arithmetic', () => {
    const zero = characterForStrength(0);
    expect(carryingCapacityForStrength(0)).toBe(0);
    expect(InventoryMechanics.calculateCarryingCapacity(0)).toBe(0);
    for (const character of [zero, { ...zero, abilityScores: undefined }]) {
      expect(calculateCarryingCapacity(character)).toBe(150);
      expect(calculateEncumbrance(character).carryingCapacity).toBe(150);
      const { result, unmount } = renderHook(() => useInventoryManager(character));
      expect(result.current.carryingCapacity).toBe(150);
      unmount();
    }
  });
});
