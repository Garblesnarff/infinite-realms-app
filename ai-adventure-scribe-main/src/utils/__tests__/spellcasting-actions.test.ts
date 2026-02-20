/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { castSpell, checkConcentration } from '../combat/spellcasting-actions';

import type { CombatParticipant, CombatAction } from '@/types/combat';

import { spellApi } from '@/services/spellApi';

vi.mock('@/services/spellApi', () => ({
  spellApi: {
    getSpellById: vi.fn(),
  },
}));

describe('spellcasting-actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('castSpell', () => {
    const mockSpell = {
      id: 'fireball',
      name: 'Fireball',
      level: 3,
      concentration: false,
      components_verbal: true,
      components_somatic: true,
      components_material: true,
      material_components: 'a tiny ball of bat guano and sulfur',
    };

    const mockParticipant: CombatParticipant = {
      id: 'p1',
      name: 'Wizard',
      spellSlots: {
        3: { current: 2, max: 2 },
      },
      activeConcentration: null,
    } as any;

    const mockAction: Partial<CombatAction> = {
      description: 'Casts a spell',
    };

    it('should successfully cast a spell and deduct a slot', async () => {
      vi.mocked(spellApi.getSpellById).mockResolvedValue(mockSpell as any);

      const { updatedParticipant, updatedAction } = await castSpell(
        mockAction,
        mockParticipant,
        'fireball',
        3,
      );

      expect(updatedParticipant.spellSlots?.[3].current).toBe(1);
      expect(updatedAction.spellName).toBe('Fireball');
      expect(updatedAction.description).toContain('Cast Fireball using level 3 slot');
      expect(updatedAction.description).toContain('[Components: V, S, M]');
      expect(updatedAction.description).toContain('[Material: a tiny ball of bat guano and sulfur]');
    });

    it('should set concentration if the spell requires it', async () => {
      const concentrationSpell = {
        ...mockSpell,
        name: 'Haste',
        concentration: true,
      };
      vi.mocked(spellApi.getSpellById).mockResolvedValue(concentrationSpell as any);

      const { updatedParticipant } = await castSpell(
        mockAction,
        mockParticipant,
        'haste',
        3,
      );

      expect(updatedParticipant.activeConcentration).toBe('Haste');
    });

    it('should throw error if spell not found', async () => {
      vi.mocked(spellApi.getSpellById).mockResolvedValue(null as any);

      await expect(castSpell(mockAction, mockParticipant, 'unknown', 3)).rejects.toThrow(
        'Spell unknown not found',
      );
    });

    it('should throw error if no spell slots available', async () => {
      vi.mocked(spellApi.getSpellById).mockResolvedValue(mockSpell as any);
      const lowSlotsParticipant = {
        ...mockParticipant,
        spellSlots: { 3: { current: 0, max: 2 } },
      };

      await expect(castSpell(mockAction, lowSlotsParticipant as any, 'fireball', 3)).rejects.toThrow(
        'No available spell slots at level 3 for Wizard',
      );
    });

    it('should throw error if already concentrating', async () => {
      const concentrationSpell = {
        ...mockSpell,
        name: 'Haste',
        concentration: true,
      };
      vi.mocked(spellApi.getSpellById).mockResolvedValue(concentrationSpell as any);
      const busyParticipant = {
        ...mockParticipant,
        activeConcentration: 'Fly',
      };

      await expect(castSpell(mockAction, busyParticipant as any, 'haste', 3)).rejects.toThrow(
        'Wizard is already concentrating on Fly',
      );
    });
  });

  describe('checkConcentration', () => {
    let mockParticipant: CombatParticipant;

    beforeEach(() => {
      mockParticipant = {
        name: 'Wizard',
        activeConcentration: 'Haste',
        abilityScores: {
          constitution: { modifier: 2 },
        },
      } as any;
      vi.spyOn(Math, 'random');
    });

    it('should return true if not concentrating', () => {
      mockParticipant.activeConcentration = null;
      expect(checkConcentration(mockParticipant, 10)).toBe(true);
    });

    it('should return true if no damage taken', () => {
      expect(checkConcentration(mockParticipant, 0)).toBe(true);
    });

    it('should maintain concentration on a successful save', () => {
      // DC 10
      vi.mocked(Math.random).mockReturnValue(0.45);

      const result = checkConcentration(mockParticipant, 20);

      expect(result).toBe(true);
      expect(mockParticipant.activeConcentration).toBe('Haste');
    });

    it('should lose concentration on a failed save', () => {
      // DC 15
      vi.mocked(Math.random).mockReturnValue(0.1);

      const result = checkConcentration(mockParticipant, 30);

      expect(result).toBe(false);
      expect(mockParticipant.activeConcentration).toBe(null);
    });

    it('should use default DC 10 for low damage', () => {
      // DC 10
      vi.mocked(Math.random).mockReturnValue(0.05);

      const result = checkConcentration(mockParticipant, 10);

      expect(result).toBe(false);
      expect(mockParticipant.activeConcentration).toBe(null);
    });

    it('should handle missing constitution modifier', () => {
      const poorParticipant = {
        name: 'Wizard',
        activeConcentration: 'Haste',
      } as any;
      vi.mocked(Math.random).mockReturnValue(0.4);

      const result = checkConcentration(poorParticipant, 10);

      expect(result).toBe(false);
      expect(poorParticipant.activeConcentration).toBe(null);
    });
  });
});
