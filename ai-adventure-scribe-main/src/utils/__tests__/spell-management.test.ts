/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  calculateSpellSlots,
  deductSpellSlot,
  restoreSpellSlots,
  castSpell,
  checkConcentration,
} from '../spell-management';

import type { Character } from '@/types/character';
import type { CombatParticipant } from '@/types/combat';

import { spellApi } from '@/services/spellApi';

vi.mock('@/services/spellApi', () => ({
  spellApi: {
    getSpellById: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/utils/spellComponents', () => ({
  validateSpellCast: vi.fn().mockReturnValue({ canCast: true, reasons: [] }),
  consumeMaterialComponents: vi.fn().mockReturnValue({ consumed: false }),
  trackComponentUsage: vi.fn().mockReturnValue({ componentsTracked: true, trackingMessage: '' }),
}));

describe('spell-management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('calculateSpellSlots', () => {
    it('should return zero slots for a character without class levels', () => {
      const character = { classLevels: [] } as unknown as Character;
      const slots = calculateSpellSlots(character);
      expect(slots[1].max).toBe(0);
      expect(slots[9].max).toBe(0);
    });

    it('should calculate slots for a level 1 Wizard (full caster)', () => {
      const character = {
        classLevels: [{ className: 'Wizard', level: 1, hitDie: 6 }],
      } as unknown as Character;
      const slots = calculateSpellSlots(character);
      expect(slots[1].max).toBe(2);
      expect(slots[2].max).toBe(0);
    });

    it('should calculate slots for a level 5 Wizard', () => {
      const character = {
        classLevels: [{ className: 'Wizard', level: 5, hitDie: 6 }],
      } as unknown as Character;
      const slots = calculateSpellSlots(character);
      expect(slots[1].max).toBe(4);
      expect(slots[2].max).toBe(3);
      expect(slots[3].max).toBe(2);
    });

    it('should calculate slots for a level 5 Paladin (half caster)', () => {
      const character = {
        classLevels: [{ className: 'Paladin', level: 5, hitDie: 10 }],
      } as unknown as Character;
      const slots = calculateSpellSlots(character);
      // Level 5 Paladin should have Level 1: 4, Level 2: 2 slots
      expect(slots[1].max).toBe(4);
      expect(slots[2].max).toBe(2);
    });

    it('should handle multiclassing Wizard 3 / Cleric 2 (full 3 + full 2 = 5)', () => {
      const character = {
        classLevels: [
          { className: 'Wizard', level: 3, hitDie: 6 },
          { className: 'Cleric', level: 2, hitDie: 8 },
        ],
      } as unknown as Character;
      const slots = calculateSpellSlots(character);
      expect(slots[1].max).toBe(4);
      expect(slots[2].max).toBe(3);
      expect(slots[3].max).toBe(2);
    });

    it('should handle multiclassing Wizard 3 / Paladin 4 (full 3 + half 2 = 5)', () => {
      const character = {
        classLevels: [
          { className: 'Wizard', level: 3, hitDie: 6 },
          { className: 'Paladin', level: 4, hitDie: 10 },
        ],
      } as unknown as Character;
      const slots = calculateSpellSlots(character);
      expect(slots[1].max).toBe(4);
      expect(slots[2].max).toBe(3);
      expect(slots[3].max).toBe(2);
    });

    it('should NOT count Warlock levels towards combined caster level', () => {
      const character = {
        classLevels: [
          { className: 'Wizard', level: 3, hitDie: 6 },
          { className: 'Warlock', level: 2, hitDie: 8 },
        ],
      } as unknown as Character;
      const slots = calculateSpellSlots(character);
      // Should be level 3 caster slots
      expect(slots[1].max).toBe(4);
      expect(slots[2].max).toBe(2);
      expect(slots[3].max).toBe(0);
    });

    it('should calculate slots for a level 20 Wizard', () => {
      const character = {
        classLevels: [{ className: 'Wizard', level: 20, hitDie: 6 }],
      } as unknown as Character;
      const slots = calculateSpellSlots(character);
      expect(slots[1].max).toBe(4);
      expect(slots[3].max).toBe(3);
      expect(slots[5].max).toBe(3);
      expect(slots[9].max).toBe(1);
    });
  });

  describe('deductSpellSlot', () => {
    it('should deduct a slot when available', () => {
      const character = {
        spellSlots: {
          1: { max: 4, current: 4 },
        },
      } as unknown as Character;
      const updated = deductSpellSlot(character, 1);
      expect(updated.spellSlots![1].current).toBe(3);
    });

    it('should throw error when no slots available', () => {
      const character = {
        spellSlots: {
          1: { max: 4, current: 0 },
        },
      } as unknown as Character;
      expect(() => deductSpellSlot(character, 1)).toThrow('No available spell slots at level 1');
    });
  });

  describe('restoreSpellSlots', () => {
    it('should restore all slots to maximum', () => {
      const character = {
        classLevels: [{ className: 'Wizard', level: 1, hitDie: 6 }],
        spellSlots: {
          1: { max: 2, current: 0 },
        },
        activeConcentration: 'Shield',
      } as unknown as Character;
      const restored = restoreSpellSlots(character);
      expect(restored.spellSlots![1].current).toBe(2);
      expect(restored.activeConcentration).toBeNull();
    });
  });

  describe('castSpell', () => {
    it('should successfully cast a spell and update participant', async () => {
      const spell = {
        id: 'fireball',
        name: 'Fireball',
        level: 3,
        concentration: false,
        components_verbal: true,
        components_somatic: true,
        components_material: true,
        material_components: 'a tiny ball of bat guano and sulfur',
      };
      (spellApi.getSpellById as any).mockResolvedValue(spell);

      const participant = {
        name: 'Gandalf',
        spellSlots: {
          3: { max: 2, current: 2 },
        },
        preparedSpells: ['Fireball'],
      } as unknown as CombatParticipant;

      const action = { description: 'Gandalf casts a spell' };

      const result = await castSpell(action, participant, 'fireball', 3);

      expect(result.updatedParticipant.spellSlots![3].current).toBe(1);
      expect(result.updatedAction.spellName).toBe('Fireball');
      expect(result.updatedAction.description).toContain('Cast Fireball using level 3 slot');
      expect(result.updatedAction.description).toContain('Components: V, S, M');
    });

    it('should set concentration when casting a concentration spell', async () => {
      const spell = {
        id: 'haste',
        name: 'Haste',
        level: 3,
        concentration: true,
      };
      (spellApi.getSpellById as any).mockResolvedValue(spell);

      const participant = {
        name: 'Gandalf',
        spellSlots: {
          3: { max: 2, current: 2 },
        },
        activeConcentration: null,
      } as unknown as CombatParticipant;

      const action = { description: 'Gandalf casts haste' };

      const result = await castSpell(action, participant, 'haste', 3);

      expect(result.updatedParticipant.activeConcentration).toBe('Haste');
    });

    it('should throw error if already concentrating', async () => {
      const spell = {
        id: 'haste',
        name: 'Haste',
        level: 3,
        concentration: true,
      };
      (spellApi.getSpellById as any).mockResolvedValue(spell);

      const participant = {
        name: 'Gandalf',
        spellSlots: {
          3: { max: 2, current: 2 },
        },
        activeConcentration: 'Fly',
      } as unknown as CombatParticipant;

      const action = { description: 'Gandalf casts haste' };

      await expect(castSpell(action, participant, 'haste', 3)).rejects.toThrow(
        'Gandalf is already concentrating on Fly',
      );
    });

    it('should throw error if spell not found', async () => {
      (spellApi.getSpellById as any).mockResolvedValue(null);

      const participant = { name: 'Gandalf' } as unknown as CombatParticipant;
      const action = { description: 'Gandalf casts unknown' };

      await expect(castSpell(action, participant, 'unknown', 3)).rejects.toThrow(
        'Spell unknown not found',
      );
    });
  });

  describe('checkConcentration', () => {
    it('should return true if not concentrating', () => {
      const participant = { activeConcentration: null } as unknown as CombatParticipant;
      expect(checkConcentration(participant, 10)).toBe(true);
    });

    it('should return true if no damage taken', () => {
      const participant = { activeConcentration: 'Haste' } as unknown as CombatParticipant;
      expect(checkConcentration(participant, 0)).toBe(true);
    });

    it('should maintain concentration on successful save', () => {
      const participant = {
        activeConcentration: 'Haste',
        abilityScores: { constitution: { modifier: 2 } },
      } as unknown as any;

      vi.spyOn(Math, 'random').mockReturnValue(0.9); // Roll 19 + 2 = 21

      const result = checkConcentration(participant, 20); // DC 10
      expect(result).toBe(true);
      expect(participant.activeConcentration).toBe('Haste');
    });

    it('should drop concentration on failed save', () => {
      const participant = {
        activeConcentration: 'Haste',
        abilityScores: { constitution: { modifier: 0 } },
      } as unknown as any;

      vi.spyOn(Math, 'random').mockReturnValue(0.1); // Roll 3 + 0 = 3

      const result = checkConcentration(participant, 20); // DC 10
      expect(result).toBe(false);
      expect(participant.activeConcentration).toBeNull();
    });

    it('should use higher DC for high damage', () => {
      const participant = {
        activeConcentration: 'Haste',
        abilityScores: { constitution: { modifier: 0 } },
      } as unknown as any;

      // Damage 40 -> DC 20
      vi.spyOn(Math, 'random').mockReturnValue(0.7); // Roll 15 + 0 = 15

      const result = checkConcentration(participant, 40);
      expect(result).toBe(false);
    });
  });
});
