/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  detectHazard,
  interactWithHazard,
  checkHazardImmunities,
  applyHazardEffects,
} from '../../environmentalHazards';
import { commonHazards } from '../common-hazards';

import * as diceUtils from '@/utils/diceUtils';

vi.mock('@/utils/diceUtils', () => ({
  rollDice: vi.fn(),
  rollSavingThrow: vi.fn(),
}));

describe('commonHazards definitions and integration tests', () => {
  const mockCharacter: any = {
    id: 'hero-123',
    name: 'Squire Arthur',
    level: 1,
    abilityScores: {
      strength: { modifier: 1 },
      dexterity: { modifier: 3 },
      constitution: { modifier: 2 },
      intelligence: { modifier: 0 },
      wisdom: { modifier: 1 },
      charisma: { modifier: -1 },
    },
    skillProficiencies: ['Perception'],
    hitPoints: { current: 15, max: 15 },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Definitions Schema & Basic Integrity Checks', () => {
    it('should have 5 common hazards defined', () => {
      expect(Array.isArray(commonHazards)).toBe(true);
      expect(commonHazards.length).toBe(5);
    });

    it('should have unique IDs and correct field formats', () => {
      const ids = commonHazards.map((h) => h.id);
      const uniqueIds = Array.from(new Set(ids));
      expect(ids.length).toBe(uniqueIds.length);

      for (const hazard of commonHazards) {
        expect(hazard.id).toBeDefined();
        expect(hazard.name).toBeDefined();
        expect(hazard.type).toBeDefined();
        expect(hazard.description).toBeDefined();
        expect(hazard.trigger).toBeDefined();
      }
    });
  });

  describe('Hazard integration tests', () => {
    // 1. Acid Pool Hazard
    describe('Acid Pool (acid_pool)', () => {
      const acidPool = commonHazards.find((h) => h.id === 'acid_pool')!;

      it('should exist and match exact specs', () => {
        expect(acidPool).toBeDefined();
        expect(acidPool.name).toBe('Acid Pool');
        expect(acidPool.isHidden).toBe(true);
        expect(acidPool.detectDC).toBe(15);
        expect(acidPool.detectSkill).toBe('perception');
        expect(acidPool.saveDC).toBe(15);
        expect(acidPool.saveAbility).toBe('dex');
        expect(acidPool.damage?.type).toBe('acid');
        expect(acidPool.damage?.dice).toBe('2d6');
      });

      it('should detect the acid pool on a successful perception check', () => {
        // Roll: 20-sided die + Wisdom mod (+1) + Perception Prof (+2 for lvl 1)
        vi.mocked(diceUtils.rollDice).mockReturnValue({ total: 16 } as any);

        const result = detectHazard(mockCharacter, acidPool);

        expect(result.detected).toBe(true);
        expect(result.rollResult).toBe(16);
        expect(result.dc).toBe(15);
        expect(result.description).toContain('You notice the Acid Pool!');
        expect(diceUtils.rollDice).toHaveBeenCalledWith(20, 1, 3);
      });

      it('should fail to detect the acid pool on a low perception check', () => {
        vi.mocked(diceUtils.rollDice).mockReturnValue({ total: 10 } as any);

        const result = detectHazard(mockCharacter, acidPool);

        expect(result.detected).toBe(false);
        expect(result.rollResult).toBe(10);
        expect(result.description).toContain("You don't notice anything unusual.");
      });

      it('should resolve full damage on a failed dex save', () => {
        vi.mocked(diceUtils.rollSavingThrow).mockReturnValue({ total: 10 } as any);
        vi.mocked(diceUtils.rollDice).mockReturnValue({ total: 8 } as any); // 2d6 roll

        const saveResult = interactWithHazard(mockCharacter, acidPool);

        expect(saveResult.saved).toBe(false);
        expect(saveResult.damageTaken).toBe(8);
        expect(saveResult.rollResult).toBe(10);
        expect(saveResult.dc).toBe(15);
        expect(diceUtils.rollSavingThrow).toHaveBeenCalledWith(3, 0); // Dex mod is 3, no special class save proficiency
        expect(diceUtils.rollDice).toHaveBeenCalledWith(6, 2, 0); // Damage roll
      });

      it('should resolve half damage on a successful dex save', () => {
        vi.mocked(diceUtils.rollSavingThrow).mockReturnValue({ total: 18 } as any);
        vi.mocked(diceUtils.rollDice).mockReturnValue({ total: 9 } as any); // 2d6 roll

        const saveResult = interactWithHazard(mockCharacter, acidPool);

        expect(saveResult.saved).toBe(true);
        expect(saveResult.damageTaken).toBe(4); // floor(9/2)
        expect(saveResult.rollResult).toBe(18);
      });

      it('should correctly reduce character HP when damage is applied', () => {
        const saveResult = { saved: false, damageTaken: 5 };
        const updatedChar = applyHazardEffects(mockCharacter, acidPool, saveResult);
        expect(updatedChar.hitPoints.current).toBe(10);
      });
    });

    // 2. Spiked Pit Hazard
    describe('Spiked Pit (spiked_pit)', () => {
      const spikedPit = commonHazards.find((h) => h.id === 'spiked_pit')!;

      it('should exist and match exact specs', () => {
        expect(spikedPit).toBeDefined();
        expect(spikedPit.name).toBe('Spiked Pit');
        expect(spikedPit.isHidden).toBe(true);
        expect(spikedPit.detectDC).toBe(12);
        expect(spikedPit.saveDC).toBe(15);
        expect(spikedPit.saveAbility).toBe('dex');
        expect(spikedPit.damage?.onSuccess).toBe('none');
        expect(spikedPit.conditions).toEqual([{ name: 'prone', duration: 1 }]);
      });

      it('should resolve full damage and prone condition on a failed save', () => {
        vi.mocked(diceUtils.rollSavingThrow).mockReturnValue({ total: 8 } as any);
        vi.mocked(diceUtils.rollDice).mockReturnValue({ total: 12 } as any); // 3d6 roll

        const saveResult = interactWithHazard(mockCharacter, spikedPit);

        expect(saveResult.saved).toBe(false);
        expect(saveResult.damageTaken).toBe(12);
        expect(saveResult.conditionsApplied).toEqual(['prone']);
      });

      it('should resolve zero damage and no condition on a successful save', () => {
        vi.mocked(diceUtils.rollSavingThrow).mockReturnValue({ total: 17 } as any);
        vi.mocked(diceUtils.rollDice).mockReturnValue({ total: 12 } as any); // 3d6 roll

        const saveResult = interactWithHazard(mockCharacter, spikedPit);

        expect(saveResult.saved).toBe(true);
        expect(saveResult.damageTaken).toBe(0); // onSuccess: none
        expect(saveResult.conditionsApplied).toEqual([]);
      });
    });

    // 3. Extreme Heat Hazard
    describe('Extreme Heat (extreme_heat)', () => {
      const extremeHeat = commonHazards.find((h) => h.id === 'extreme_heat')!;

      it('should exist and match exact specs', () => {
        expect(extremeHeat).toBeDefined();
        expect(extremeHeat.name).toBe('Extreme Heat');
        expect(extremeHeat.isHidden).toBeUndefined(); // defaults to visible/not hidden
        expect(extremeHeat.isAreaEffect).toBe(true);
        expect(extremeHeat.areaOfEffect).toEqual({ shape: 'sphere', size: 20 });
        expect(extremeHeat.saveDC).toBe(15);
        expect(extremeHeat.saveAbility).toBe('con');
        expect(extremeHeat.damage?.type).toBe('fire');
        expect(extremeHeat.exhaustionLevel).toBe(1);
      });

      it('should detect extreme heat automatically since it is not hidden', () => {
        const result = detectHazard(mockCharacter, extremeHeat);
        expect(result.detected).toBe(true);
        expect(result.description).toContain('You notice the Extreme Heat.');
      });

      it('should resolve full damage and exhaustion level 1 on failed save', () => {
        vi.mocked(diceUtils.rollSavingThrow).mockReturnValue({ total: 10 } as any);
        vi.mocked(diceUtils.rollDice).mockReturnValue({ total: 4 } as any); // 1d6 roll

        const saveResult = interactWithHazard(mockCharacter, extremeHeat);

        expect(saveResult.saved).toBe(false);
        expect(saveResult.damageTaken).toBe(4);
        expect(saveResult.exhaustionApplied).toBe(1);
        expect(diceUtils.rollSavingThrow).toHaveBeenCalledWith(2, 0); // Con mod is 2, no monk/barb con bonus here
      });

      it('should resolve zero damage and zero exhaustion on successful save', () => {
        vi.mocked(diceUtils.rollSavingThrow).mockReturnValue({ total: 16 } as any);
        vi.mocked(diceUtils.rollDice).mockReturnValue({ total: 5 } as any);

        const saveResult = interactWithHazard(mockCharacter, extremeHeat);

        expect(saveResult.saved).toBe(true);
        expect(saveResult.damageTaken).toBe(0); // onSuccess: none
        expect(saveResult.exhaustionApplied).toBe(0);
      });
    });

    // 4. Poisonous Spores Hazard
    describe('Poisonous Spores (poisonous_spores)', () => {
      const poisonousSpores = commonHazards.find((h) => h.id === 'poisonous_spores')!;

      it('should exist and match exact specs', () => {
        expect(poisonousSpores).toBeDefined();
        expect(poisonousSpores.name).toBe('Poisonous Spores');
        expect(poisonousSpores.isAreaEffect).toBe(true);
        expect(poisonousSpores.areaOfEffect).toEqual({ shape: 'cone', size: 15 });
        expect(poisonousSpores.saveDC).toBe(13);
        expect(poisonousSpores.saveAbility).toBe('con');
        expect(poisonousSpores.conditions).toEqual([
          { name: 'poisoned', duration: 1, saveEnds: true },
        ]);
        expect(poisonousSpores.damage).toBeUndefined();
      });

      it('should apply poisoned condition on a failed con save', () => {
        vi.mocked(diceUtils.rollSavingThrow).mockReturnValue({ total: 11 } as any);

        const saveResult = interactWithHazard(mockCharacter, poisonousSpores);

        expect(saveResult.saved).toBe(false);
        expect(saveResult.damageTaken).toBe(0); // No damage component
        expect(saveResult.conditionsApplied).toEqual(['poisoned']);
      });

      it('should not apply poisoned condition on a successful con save', () => {
        vi.mocked(diceUtils.rollSavingThrow).mockReturnValue({ total: 14 } as any);

        const saveResult = interactWithHazard(mockCharacter, poisonousSpores);

        expect(saveResult.saved).toBe(true);
        expect(saveResult.conditionsApplied).toEqual([]);
      });
    });

    // 5. Slippery Ice Hazard
    describe('Slippery Ice (slippery_ice)', () => {
      const slipperyIce = commonHazards.find((h) => h.id === 'slippery_ice')!;

      it('should exist and match exact specs', () => {
        expect(slipperyIce).toBeDefined();
        expect(slipperyIce.name).toBe('Slippery Ice');
        expect(slipperyIce.saveDC).toBe(10);
        expect(slipperyIce.saveAbility).toBe('dex');
        expect(slipperyIce.conditions).toEqual([{ name: 'prone', duration: 1 }]);
        expect(slipperyIce.movementModifier).toBe(0.5);
        expect(slipperyIce.damage).toBeUndefined();
      });

      it('should apply prone condition on failed dex save', () => {
        vi.mocked(diceUtils.rollSavingThrow).mockReturnValue({ total: 7 } as any);

        const saveResult = interactWithHazard(mockCharacter, slipperyIce);

        expect(saveResult.saved).toBe(false);
        expect(saveResult.conditionsApplied).toEqual(['prone']);
      });

      it('should not apply prone condition on successful dex save', () => {
        vi.mocked(diceUtils.rollSavingThrow).mockReturnValue({ total: 12 } as any);

        const saveResult = interactWithHazard(mockCharacter, slipperyIce);

        expect(saveResult.saved).toBe(true);
        expect(saveResult.conditionsApplied).toEqual([]);
      });
    });
  });

  describe('Immunities & Resistance integration', () => {
    it('should correctly evaluate character immunities/resistances against Acid Pool', () => {
      const acidPool = commonHazards.find((h) => h.id === 'acid_pool')!;

      // Acid immune character
      const immuneArthur = { ...mockCharacter, damageImmunities: ['acid'] };
      const immuneStatus = checkHazardImmunities(immuneArthur, acidPool);
      expect(immuneStatus.immune).toBe(true);
      expect(immuneStatus.resistant).toBe(false);

      // Acid resistant character
      const resistantArthur = { ...mockCharacter, damageResistances: ['acid'] };
      const resistantStatus = checkHazardImmunities(resistantArthur, acidPool);
      expect(resistantStatus.immune).toBe(false);
      expect(resistantStatus.resistant).toBe(true);

      // Vulnerable character
      const vulnerableArthur = { ...mockCharacter, damageVulnerabilities: ['acid'] };
      const vulnerableStatus = checkHazardImmunities(vulnerableArthur, acidPool);
      expect(vulnerableStatus.vulnerable).toBe(true);
    });
  });
});
