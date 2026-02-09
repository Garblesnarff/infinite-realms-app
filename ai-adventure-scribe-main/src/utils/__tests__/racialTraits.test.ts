import { describe, it, expect } from 'vitest';

import {
  getRacialTraits,
  getRacialResistances,
  hasRacialSaveAdvantage,
  shouldApplyHalflingLucky,
  getBreathWeaponSaveDC,
  canUseRacialTrait,
  useRacialTrait,
  restoreRacialTraits,
} from '../racialTraits';

import type { RacialTrait } from '@/types/combat';

describe('racialTraits', () => {
  describe('getRacialTraits', () => {
    it('should return traits for halfling', () => {
      const traits = getRacialTraits('halfling');
      expect(traits.some((t) => t.name === 'lucky')).toBe(true);
      expect(traits.some((t) => t.name === 'brave')).toBe(true);
    });

    it('should return traits for dragonborn', () => {
      const traits = getRacialTraits('dragonborn');
      expect(traits.some((t) => t.name === 'draconic_resistance')).toBe(true);
      expect(traits.some((t) => t.name === 'breath_weapon')).toBe(true);
    });

    it('should return traits for tiefling', () => {
      const traits = getRacialTraits('tiefling');
      expect(traits.some((t) => t.name === 'hellish_resistance')).toBe(true);
      expect(traits.some((t) => t.name === 'infernal_legacy')).toBe(true);
    });

    it('should be case-insensitive', () => {
      const traits = getRacialTraits('HALFLING');
      expect(traits.length).toBeGreaterThan(0);
      expect(traits.some((t) => t.name === 'lucky')).toBe(true);
    });

    it('should return empty array for unknown race', () => {
      const traits = getRacialTraits('unknown');
      expect(traits).toEqual([]);
    });
  });

  describe('getRacialResistances', () => {
    it('should extract resistances from passive traits', () => {
      const traits: RacialTrait[] = [
        { name: 'draconic_resistance', type: 'passive', description: '', damageType: 'fire' },
        { name: 'lucky', type: 'passive', description: '' },
      ];
      expect(getRacialResistances(traits)).toEqual(['fire']);
    });

    it('should ignore active traits for resistances', () => {
      const traits: RacialTrait[] = [
        { name: 'active_res', type: 'active', description: '', damageType: 'cold' },
      ];
      expect(getRacialResistances(traits)).toEqual([]);
    });

    it('should return multiple resistances', () => {
      const traits: RacialTrait[] = [
        { name: 'res1', type: 'passive', description: '', damageType: 'fire' },
        { name: 'res2', type: 'passive', description: '', damageType: 'poison' },
      ];
      expect(getRacialResistances(traits)).toEqual(['fire', 'poison']);
    });
  });

  describe('hasRacialSaveAdvantage', () => {
    it('should return true for brave against frightened', () => {
      const traits: RacialTrait[] = [{ name: 'brave', type: 'passive', description: '' }];
      expect(hasRacialSaveAdvantage(traits, 'frightened')).toBe(true);
    });

    it('should return true for fey_ancestry against charmed', () => {
      const traits: RacialTrait[] = [{ name: 'fey_ancestry', type: 'passive', description: '' }];
      expect(hasRacialSaveAdvantage(traits, 'charmed')).toBe(true);
    });

    it('should return true for poison_resistance against poison', () => {
      const traits: RacialTrait[] = [{ name: 'poison_resistance', type: 'passive', description: '' }];
      expect(hasRacialSaveAdvantage(traits, 'poison')).toBe(true);
    });

    it('should return false if trait is missing', () => {
      expect(hasRacialSaveAdvantage([], 'frightened')).toBe(false);
    });

    it('should return false for unknown save type', () => {
      const traits: RacialTrait[] = [{ name: 'brave', type: 'passive', description: '' }];
      expect(hasRacialSaveAdvantage(traits, 'dexterity')).toBe(false);
    });
  });

  describe('shouldApplyHalflingLucky', () => {
    const luckyTrait: RacialTrait[] = [{ name: 'lucky', type: 'passive', description: '' }];

    it('should return true for lucky trait and roll of 1', () => {
      expect(shouldApplyHalflingLucky(luckyTrait, 1)).toBe(true);
    });

    it('should return false for lucky trait and roll other than 1', () => {
      expect(shouldApplyHalflingLucky(luckyTrait, 2)).toBe(false);
      expect(shouldApplyHalflingLucky(luckyTrait, 20)).toBe(false);
    });

    it('should return false if lucky trait is missing', () => {
      expect(shouldApplyHalflingLucky([], 1)).toBe(false);
    });
  });

  describe('getBreathWeaponSaveDC', () => {
    it('should calculate DC correctly', () => {
      // 8 + 3 (Con) + 2 (Prof) = 13
      expect(getBreathWeaponSaveDC(3, 2)).toBe(13);
      // 8 + 0 (Con) + 2 (Prof) = 10
      expect(getBreathWeaponSaveDC(0, 2)).toBe(10);
      // 8 - 1 (Con) + 4 (Prof) = 11
      expect(getBreathWeaponSaveDC(-1, 4)).toBe(11);
    });
  });

  describe('trait usage', () => {
    const activeTrait: RacialTrait = {
      name: 'breath_weapon',
      type: 'active',
      description: '',
      maxUses: 1,
      currentUses: 1,
    };

    describe('canUseRacialTrait', () => {
      it('should return true for passive traits', () => {
        const passive: RacialTrait = { name: 'lucky', type: 'passive', description: '' };
        expect(canUseRacialTrait(passive)).toBe(true);
      });

      it('should return true if no maxUses is defined', () => {
        const noMax: RacialTrait = { name: 'feature', type: 'active', description: '' };
        expect(canUseRacialTrait(noMax)).toBe(true);
      });

      it('should return true if currentUses > 0', () => {
        expect(canUseRacialTrait(activeTrait)).toBe(true);
      });

      it('should return false if currentUses is 0', () => {
        const exhausted = { ...activeTrait, currentUses: 0 };
        expect(canUseRacialTrait(exhausted)).toBe(false);
      });

      it('should return false if currentUses is undefined but maxUses is set', () => {
        const undefinedUses = { ...activeTrait, currentUses: undefined };
        expect(canUseRacialTrait(undefinedUses)).toBe(false);
      });
    });

    describe('useRacialTrait', () => {
      it('should decrement currentUses', () => {
        const result = useRacialTrait(activeTrait);
        expect(result.currentUses).toBe(0);
      });

      it('should not decrement below 0', () => {
        const exhausted = { ...activeTrait, currentUses: 0 };
        const result = useRacialTrait(exhausted);
        expect(result.currentUses).toBe(0);
      });

      it('should return same trait if currentUses is undefined', () => {
        const noUses = { ...activeTrait, currentUses: undefined };
        const result = useRacialTrait(noUses);
        expect(result).toEqual(noUses);
      });
    });

    describe('restoreRacialTraits', () => {
      const traits: RacialTrait[] = [
        { name: 'short_trait', type: 'active', description: '', usesPerRest: 'short', maxUses: 1, currentUses: 0 },
        { name: 'long_trait', type: 'active', description: '', usesPerRest: 'long', maxUses: 1, currentUses: 0 },
        { name: 'none_trait', type: 'active', description: '', usesPerRest: 'none', maxUses: 1, currentUses: 0 },
      ];

      it('should restore short rest traits on short rest', () => {
        const restored = restoreRacialTraits(traits, 'short');
        expect(restored.find((t) => t.name === 'short_trait')?.currentUses).toBe(1);
        expect(restored.find((t) => t.name === 'long_trait')?.currentUses).toBe(0);
      });

      it('should restore both short and long rest traits on long rest', () => {
        const restored = restoreRacialTraits(traits, 'long');
        expect(restored.find((t) => t.name === 'short_trait')?.currentUses).toBe(1);
        expect(restored.find((t) => t.name === 'long_trait')?.currentUses).toBe(1);
      });

      it('should not restore traits with usesPerRest: none', () => {
        const restored = restoreRacialTraits(traits, 'long');
        expect(restored.find((t) => t.name === 'none_trait')?.currentUses).toBe(0);
      });

      it('should handle restore for trait without maxUses', () => {
        const noMaxTraits: RacialTrait[] = [
          { name: 'no_max', type: 'active', description: '', usesPerRest: 'short', currentUses: 0 },
        ];
        const restored = restoreRacialTraits(noMaxTraits, 'short');
        expect(restored[0].currentUses).toBe(0);
      });
    });
  });
});
