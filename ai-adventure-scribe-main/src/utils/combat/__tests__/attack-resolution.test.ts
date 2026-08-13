/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { resolveAttack } from '../attack-resolution';

import { rollAttack } from '@/utils/diceUtils';

// Mock dependencies
vi.mock('@/utils/character-calculations', () => ({
  calculateProficiencyBonus: vi.fn((level) => Math.floor((level - 1) / 4) + 2),
}));

vi.mock('@/utils/combat/attack-damage', () => ({
  getAbilityModifier: vi.fn((participant, ability) => {
    return participant.abilityScores?.[ability]?.modifier || 0;
  }),
  getSpellcastingAbility: vi.fn((_participant) => {
    // Return a dummy value for spellcasting ability modifier
    return 4;
  }),
}));

vi.mock('@/utils/diceUtils', () => ({
  rollAttack: vi.fn(),
}));

describe('resolveAttack', () => {
  it('automatically crits a paralyzed target within 5 feet', () => {
    const target = { ...mockTarget, conditions: [{ name: 'paralyzed' }] } as any;
    vi.mocked(rollAttack).mockReturnValue({ total: 16, naturalRoll: 10 } as any);
    expect(resolveAttack(mockWeapon, mockAttacker, target, { distanceInFeet: 5 }).criticalHit).toBe(
      true,
    );
  });
  const mockAttacker: any = {
    id: 'attacker-1',
    name: 'Attacker',
    level: 5,
    abilityScores: {
      strength: { score: 16, modifier: 3 },
      dexterity: { score: 14, modifier: 2 },
    },
    conditions: [],
  };

  const mockTarget: any = {
    id: 'target-1',
    name: 'Target',
    armorClass: 15,
    conditions: [],
  };

  const mockWeapon: any = {
    name: 'Longsword',
    weaponProperties: {},
    attackBonus: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should resolve a standard melee attack', () => {
    // Proficiency (+3 for level 5) + STR (+3) = +6 bonus
    (rollAttack as any).mockReturnValue({
      total: 16,
      naturalRoll: 10,
    });

    const result = resolveAttack(mockWeapon, mockAttacker, mockTarget);

    expect(result.hit).toBe(true);
    expect(result.roll.total).toBe(16);
    expect(rollAttack).toHaveBeenCalledWith(6, { advantage: false, disadvantage: false });
  });

  it('should resolve a ranged attack using dexterity', () => {
    const rangedWeapon = { ...mockWeapon, range: '60/120' };
    (rollAttack as any).mockReturnValue({
      total: 10,
      naturalRoll: 5,
    });

    // Proficiency (+3) + DEX (+2) = +5 bonus
    const result = resolveAttack(rangedWeapon, mockAttacker, mockTarget);

    expect(result.hit).toBe(false);
    expect(rollAttack).toHaveBeenCalledWith(5, expect.anything());
  });

  it('should resolve a finesse attack using the higher modifier', () => {
    const finesseWeapon = { ...mockWeapon, weaponProperties: { finesse: true } };
    (rollAttack as any).mockReturnValue({ total: 15, naturalRoll: 9 });

    // Should use STR (3) over DEX (2) for this attacker
    resolveAttack(finesseWeapon, mockAttacker, mockTarget);
    expect(rollAttack).toHaveBeenCalledWith(6, expect.anything());

    // Switch to higher DEX
    const highDexAttacker = {
      ...mockAttacker,
      abilityScores: {
        strength: { modifier: 1 },
        dexterity: { modifier: 4 },
      },
    };
    resolveAttack(finesseWeapon, highDexAttacker, mockTarget);
    expect(rollAttack).toHaveBeenCalledWith(7, expect.anything()); // 3 (prof) + 4 (dex)
  });

  it('should resolve a spell attack', () => {
    (rollAttack as any).mockReturnValue({ total: 20, naturalRoll: 13 });

    // Spellcasting ability mock returns 4, prof is 3 -> +7
    resolveAttack(null, mockAttacker, mockTarget, { spellAttack: true });
    expect(rollAttack).toHaveBeenCalledWith(7, expect.anything());
  });

  it('should handle missing spellcasting ability', async () => {
    const { getSpellcastingAbility } = await import('@/utils/combat/attack-damage');
    (getSpellcastingAbility as any).mockReturnValueOnce(null);

    // Spellcasting ability is null, prof is 3 -> +3
    resolveAttack(null, mockAttacker, mockTarget, { spellAttack: true });
    expect(rollAttack).toHaveBeenCalledWith(3, expect.anything());
  });

  it('should handle natural 20 as an automatic hit', () => {
    (rollAttack as any).mockReturnValue({
      total: 10, // Total is lower than AC 15
      naturalRoll: 20,
    });

    const result = resolveAttack(mockWeapon, mockAttacker, mockTarget);
    expect(result.hit).toBe(true);
    expect(result.criticalHit).toBe(true);
  });

  it('should handle natural 1 as an automatic miss', () => {
    (rollAttack as any).mockReturnValue({
      total: 25, // Total is higher than AC 15
      naturalRoll: 1,
    });

    const result = resolveAttack(mockWeapon, mockAttacker, mockTarget);
    expect(result.hit).toBe(false);
    expect(result.criticalFail).toBe(true);
  });

  it('should apply advantage from attacker conditions (Invisibility)', () => {
    const invisibleAttacker = {
      ...mockAttacker,
      conditions: [{ name: 'invisible' }],
    };
    (rollAttack as any).mockReturnValue({ total: 18, naturalRoll: 12 });

    resolveAttack(mockWeapon, invisibleAttacker, mockTarget);
    expect(rollAttack).toHaveBeenCalledWith(6, expect.objectContaining({ advantage: true }));
  });

  it('should apply disadvantage from attacker conditions (Blinded)', () => {
    const blindedAttacker = {
      ...mockAttacker,
      conditions: [{ name: 'blinded' }],
    };
    (rollAttack as any).mockReturnValue({ total: 10, naturalRoll: 4 });

    resolveAttack(mockWeapon, blindedAttacker, mockTarget);
    expect(rollAttack).toHaveBeenCalledWith(6, expect.objectContaining({ disadvantage: true }));
  });

  it('should apply advantage against prone target for melee attacks', () => {
    const proneTarget = {
      ...mockTarget,
      conditions: [{ name: 'prone' }],
    };
    (rollAttack as any).mockReturnValue({ total: 18, naturalRoll: 12 });

    // Melee attack
    resolveAttack(mockWeapon, mockAttacker, proneTarget);
    expect(rollAttack).toHaveBeenCalledWith(6, expect.objectContaining({ advantage: true }));

    // Ranged attack
    const rangedWeapon = { ...mockWeapon, range: '30/60' };
    resolveAttack(rangedWeapon, mockAttacker, proneTarget);
    expect(rollAttack).toHaveBeenCalledWith(5, expect.objectContaining({ disadvantage: true }));
  });

  it('should cancel out advantage and disadvantage', () => {
    const invisibleAttacker = {
      ...mockAttacker,
      conditions: [{ name: 'invisible' }],
    };
    (rollAttack as any).mockReturnValue({ total: 15, naturalRoll: 9 });

    // Explicit disadvantage passed in options
    resolveAttack(mockWeapon, invisibleAttacker, mockTarget, { disadvantage: true });
    expect(rollAttack).toHaveBeenCalledWith(
      6,
      expect.objectContaining({
        advantage: false,
        disadvantage: false,
      }),
    );
  });

  it('should handle weapon attack bonus', () => {
    const magicWeapon = { ...mockWeapon, attackBonus: 2 };
    (rollAttack as any).mockReturnValue({ total: 20, naturalRoll: 12 });

    // 3 (prof) + 3 (str) + 2 (weapon) = 8
    resolveAttack(magicWeapon, mockAttacker, mockTarget);
    expect(rollAttack).toHaveBeenCalledWith(8, expect.anything());
  });

  it('should apply disadvantage if attacker is poisoned', () => {
    const poisonedAttacker = {
      ...mockAttacker,
      conditions: [{ name: 'poisoned' }],
    };
    (rollAttack as any).mockReturnValue({ total: 10, naturalRoll: 4 });

    resolveAttack(mockWeapon, poisonedAttacker, mockTarget);
    expect(rollAttack).toHaveBeenCalledWith(6, expect.objectContaining({ disadvantage: true }));
  });

  it('should apply advantage if target is paralyzed, stunned, or unconscious', () => {
    (rollAttack as any).mockReturnValue({ total: 18, naturalRoll: 12 });

    const conditions = ['paralyzed', 'stunned', 'unconscious', 'blinded'];

    conditions.forEach((conditionName) => {
      const conditionedTarget = {
        ...mockTarget,
        conditions: [{ name: conditionName }],
      };
      resolveAttack(mockWeapon, mockAttacker, conditionedTarget);
      expect(rollAttack).toHaveBeenLastCalledWith(6, expect.objectContaining({ advantage: true }));
    });
  });

  it('should use default level 1 if attacker level is missing', () => {
    const noLevelAttacker = { ...mockAttacker };
    delete noLevelAttacker.level;
    (rollAttack as any).mockReturnValue({ total: 10, naturalRoll: 5 });

    // Level 1 -> Prof +2. STR +3 -> +5 bonus
    resolveAttack(mockWeapon, noLevelAttacker, mockTarget);
    expect(rollAttack).toHaveBeenCalledWith(5, expect.anything());
  });
});
