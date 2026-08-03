/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { castSpell, checkConcentration } from '../spellcasting-actions';

import type { CombatAction } from '@/types/combat';

import { spellApi } from '@/services/spellApi';

// Mock spellApi
vi.mock('@/services/spellApi', () => ({
  spellApi: {
    getSpellById: vi.fn(),
  },
}));

// Mock basic-math
vi.mock('@/utils/character/basic-math', () => ({
  calculateProficiencyBonus: vi.fn((level) => Math.floor((level - 1) / 4) + 2),
}));

describe('spellcasting-actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // deterministic d20 roll: 0.5 * 20 = 10 -> Math.floor + 1 = 11
  });

  describe('castSpell', () => {
    const mockSpellApi = vi.mocked(spellApi);

    it('should throw an error if spell is not found', async () => {
      mockSpellApi.getSpellById.mockResolvedValue(null as any);

      const participant: any = {
        name: 'Gandalf',
        spellSlots: {
          1: { current: 3, max: 4 },
        },
      };

      await expect(castSpell({}, participant, 'missing-spell', '1')).rejects.toThrow(
        'Spell missing-spell not found'
      );
    });

    it('should throw an error if no slots are available', async () => {
      const spell = { id: 'fireball', name: 'Fireball', level: 3, concentration: false };
      mockSpellApi.getSpellById.mockResolvedValue(spell as any);

      const participant: any = {
        name: 'Gandalf',
        spellSlots: {
          3: { current: 0, max: 2 },
        },
      };

      await expect(castSpell({}, participant, 'fireball', '3')).rejects.toThrow(
        'No available spell slots at level 3 for Gandalf'
      );
    });

    it('should cast a non-concentration spell successfully and deduct a slot', async () => {
      const spell = {
        id: 'fireball',
        name: 'Fireball',
        level: 3,
        concentration: false,
        components_verbal: true,
        components_somatic: true,
      };
      mockSpellApi.getSpellById.mockResolvedValue(spell as any);

      const participant: any = {
        name: 'Gandalf',
        spellSlots: {
          3: { current: 2, max: 3 },
        },
        activeConcentration: null,
      };

      const action: Partial<CombatAction> = {
        description: 'Gandalf unleashes a fiery blast',
      };

      const result = await castSpell(action, participant, 'fireball', '3');

      expect(result.updatedParticipant.spellSlots['3'].current).toBe(1);
      expect(result.updatedParticipant.activeConcentration).toBeNull();
      expect(result.updatedAction.spellName).toBe('Fireball');
      expect(result.updatedAction.spellLevel).toBe(3);
      expect(result.updatedAction.description).toBe(
        'Gandalf unleashes a fiery blast (Cast Fireball using level 3 slot) [Components: V, S]'
      );
      expect(result.updatedAction.components).toEqual({
        verbal: true,
        somatic: true,
        material: false,
        materialDescription: undefined,
        materialCost: undefined,
        materialConsumed: false,
      });
    });

    it('should start concentration when casting a concentration spell without prior concentration', async () => {
      const spell = {
        id: 'haste',
        name: 'Haste',
        level: 3,
        concentration: true,
        components_verbal: true,
        components_somatic: true,
        components_material: true,
        material_components: 'a shaving of licorice root',
        material_cost: 'free',
        material_consumed: false,
      };
      mockSpellApi.getSpellById.mockResolvedValue(spell as any);

      const participant: any = {
        name: 'Gandalf',
        spellSlots: {
          3: { current: 1, max: 3 },
        },
        activeConcentration: null,
      };

      const action: Partial<CombatAction> = {
        description: 'Gandalf speeds up his ally',
      };

      const result = await castSpell(action, participant, 'haste', '3');

      expect(result.updatedParticipant.spellSlots['3'].current).toBe(0);
      expect(result.updatedParticipant.activeConcentration).toBe('Haste');
      expect(result.updatedAction.description).toBe(
        'Gandalf speeds up his ally (Cast Haste using level 3 slot) [Components: V, S, M] [Material: a shaving of licorice root]'
      );
      expect(result.updatedAction.components).toEqual({
        verbal: true,
        somatic: true,
        material: true,
        materialDescription: 'a shaving of licorice root',
        materialCost: 'free',
        materialConsumed: false,
      });
    });

    it('should throw an error when casting a concentration spell while already concentrating', async () => {
      const spell = {
        id: 'haste',
        name: 'Haste',
        level: 3,
        concentration: true,
      };
      mockSpellApi.getSpellById.mockResolvedValue(spell as any);

      const participant: any = {
        name: 'Gandalf',
        spellSlots: {
          3: { current: 1, max: 3 },
        },
        activeConcentration: 'Invisibility',
      };

      await expect(castSpell({}, participant, 'haste', '3')).rejects.toThrow(
        'Gandalf is already concentrating on Invisibility'
      );
    });
  });

  describe('checkConcentration', () => {
    it('should return true if participant is not concentrating', () => {
      const participant: any = {
        activeConcentration: null,
      };
      expect(checkConcentration(participant, 20)).toBe(true);
    });

    it('should return true if damage taken is 0', () => {
      const participant: any = {
        activeConcentration: 'Haste',
      };
      expect(checkConcentration(participant, 0)).toBe(true);
    });

    it('should maintain concentration if the roll succeeds DC 10 (damage < 20)', () => {
      const participant: any = {
        level: 1,
        activeConcentration: 'Haste',
        abilityScores: {
          constitution: { modifier: 2, savingThrow: false },
        },
      };

      // Math.random() is mocked to 0.5, so d20 roll is 11.
      // Total roll = 11 + 2 (conMod) + 0 (not proficient) = 13.
      // DC is Math.max(10, floor(15 / 2)) = 10.
      // 13 >= 10, so should succeed and maintain concentration.
      const result = checkConcentration(participant, 15);
      expect(result).toBe(true);
      expect(participant.activeConcentration).toBe('Haste');
    });

    it('should break concentration and set activeConcentration to null if the roll fails DC 10', () => {
      const participant: any = {
        level: 1,
        activeConcentration: 'Haste',
        abilityScores: {
          constitution: { modifier: -2, savingThrow: false },
        },
      };

      // Math.random() is mocked to 0.5, so d20 roll is 11.
      // Total roll = 11 - 2 (conMod) = 9.
      // DC is Math.max(10, floor(10 / 2)) = 10.
      // 9 < 10, so should fail.
      const result = checkConcentration(participant, 10);
      expect(result).toBe(false);
      expect(participant.activeConcentration).toBeNull();
    });

    it('should use savingThrowProficiencies to apply proficiency bonus to the roll', () => {
      const participant: any = {
        level: 5, // proficiency bonus = +3
        activeConcentration: 'Haste',
        savingThrowProficiencies: ['constitution'],
        abilityScores: {
          constitution: { modifier: 2, savingThrow: false },
        },
      };

      // Math.random() is mocked to 0.5, so d20 roll is 11.
      // Total roll = 11 + 2 (conMod) + 3 (proficient) = 16.
      // DC is floor(30 / 2) = 15.
      // 16 >= 15, so should succeed.
      const result = checkConcentration(participant, 30);
      expect(result).toBe(true);
      expect(participant.activeConcentration).toBe('Haste');
    });

    it('should use constitution.savingThrow to apply proficiency bonus to the roll', () => {
      const participant: any = {
        level: 5, // proficiency bonus = +3
        activeConcentration: 'Haste',
        abilityScores: {
          constitution: { modifier: 2, savingThrow: true },
        },
      };

      // Math.random() is mocked to 0.5, so d20 roll is 11.
      // Total roll = 11 + 2 (conMod) + 3 (proficient) = 16.
      // DC is floor(30 / 2) = 15.
      // 16 >= 15, so should succeed.
      const result = checkConcentration(participant, 30);
      expect(result).toBe(true);
      expect(participant.activeConcentration).toBe('Haste');
    });

    it('should calculate higher DCs properly for high damage', () => {
      const participant: any = {
        level: 1,
        activeConcentration: 'Haste',
        abilityScores: {
          constitution: { modifier: 2, savingThrow: false },
        },
      };

      // Math.random() is mocked to 0.5, so d20 roll is 11.
      // Total roll = 11 + 2 = 13.
      // DC is floor(40 / 2) = 20.
      // 13 < 20, so should fail.
      const result = checkConcentration(participant, 40);
      expect(result).toBe(false);
      expect(participant.activeConcentration).toBeNull();
    });
  });
});
