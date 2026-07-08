/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies BEFORE importing the hook
vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/utils/attackUtils', () => ({
  calculateAttackDamage: vi.fn(),
}));

vi.mock('@/utils/classFeatures', () => ({
  getRageDamageBonus: vi.fn(),
  canUseClassFeature: vi.fn(),
}));

vi.mock('@/utils/combat/deathSaves', () => ({
  needsDeathSaves: vi.fn(),
  rollDeathSave: vi.fn(),
}));

vi.mock('@/utils/diceUtils', () => ({
  rollDice: vi.fn(),
  rollAttack: vi.fn(),
}));

vi.mock('@/utils/equipmentUtils', () => ({
  createDefaultLightWeapons: vi.fn(),
  equipMainHandWeapon: vi.fn(),
  equipOffHandWeapon: vi.fn(),
}));

vi.mock('@/utils/character-calculations', () => ({
  calculateProficiencyBonus: vi.fn(),
}));

vi.mock('@/utils/racialTraits', () => ({
  canUseRacialTrait: vi.fn(),
}));

vi.mock('@/utils/twoWeaponFighting', () => ({
  canUseTwoWeaponFighting: vi.fn(),
  makeMainHandAttack: vi.fn(),
  canMakeOffHandAttack: vi.fn(),
  makeOffHandAttack: vi.fn(),
}));

import { useCombatMechanics } from '../use-combat-mechanics';

import * as attackUtils from '@/utils/attackUtils';
import * as characterCalculations from '@/utils/character-calculations';
import * as classFeatures from '@/utils/classFeatures';
import * as deathSaves from '@/utils/combat/deathSaves';
import * as diceUtils from '@/utils/diceUtils';
import * as equipmentUtils from '@/utils/equipmentUtils';
import * as racialTraits from '@/utils/racialTraits';
import * as twoWeaponFighting from '@/utils/twoWeaponFighting';

describe('useCombatMechanics', () => {
  const mockHandleCombatAction = vi.fn();
  const mockTakeAction = vi.fn();
  const mockUpdateParticipant = vi.fn();

  const mockActiveEncounter = {
    participants: [
      {
        id: 'p1',
        name: 'Hero',
        level: 5,
        racialTraits: [{ name: 'lucky' }],
        isRaging: false,
        characterClass: 'fighter',
        abilityScores: {
          constitution: { modifier: 2 },
        },
        activeConcentration: null,
      },
      {
        id: 'p2',
        name: 'Enemy',
        level: 5,
      },
    ],
  };

  const defaultProps = {
    activeEncounter: mockActiveEncounter,
    handleCombatAction: mockHandleCombatAction,
    takeAction: mockTakeAction,
    updateParticipant: mockUpdateParticipant,
    selectedEnemy: 'p2',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useCombatMechanics(defaultProps));

    expect(result.current.showAdvantageModal).toBe(false);
    expect(result.current.pendingAttack).toBe(null);
  });

  describe('handleEnhancedAttack', () => {
    it('should execute a normal attack successfully', async () => {
      const { result } = renderHook(() => useCombatMechanics(defaultProps));

      vi.mocked(diceUtils.rollAttack).mockReturnValue({
        dieType: 20,
        count: 1,
        modifier: 5,
        results: [15],
        total: 20,
        critical: false,
        naturalRoll: 15,
      } as any);

      vi.mocked(attackUtils.calculateAttackDamage).mockReturnValue({
        rolls: [
          {
            dieType: 8,
            count: 1,
            modifier: 3,
            results: [5],
            total: 8,
          },
        ],
        totalBeforeResistance: 8,
      } as any);

      await act(async () => {
        await result.current.handleEnhancedAttack('p1', 'p2', 'attack');
      });

      expect(diceUtils.rollAttack).toHaveBeenCalledWith(
        5,
        expect.objectContaining({
          advantage: false,
          disadvantage: false,
          halflingLucky: true, // p1 has lucky trait in mock
        }),
      );

      expect(mockHandleCombatAction).toHaveBeenCalledWith(
        'attack',
        'p1',
        'p2',
        expect.objectContaining({
          damageDealt: 8,
          hit: true,
        }),
      );
    });

    it('should handle critical hits and divine smite', async () => {
      const { result } = renderHook(() => useCombatMechanics(defaultProps));

      vi.mocked(diceUtils.rollAttack).mockReturnValue({
        total: 25,
        critical: true,
        naturalRoll: 20,
      } as any);

      vi.mocked(attackUtils.calculateAttackDamage).mockReturnValue({
        rolls: [
          { total: 12 }, // base
          { total: 9 }, // smite
        ],
        totalBeforeResistance: 21,
      } as any);

      await act(async () => {
        await result.current.handleEnhancedAttack('p1', 'p2', 'attack', false, false, 1);
      });

      expect(mockHandleCombatAction).toHaveBeenCalledWith(
        'attack',
        'p1',
        'p2',
        expect.objectContaining({
          damageDealt: 21,
          description: expect.stringContaining('CRITICAL HIT!'),
        }),
      );
    });

    it('should rely on calculateAttackDamage for Rage damage if present', async () => {
      const barbarianProps = {
        ...defaultProps,
        activeEncounter: {
          participants: [
            {
              id: 'p1',
              name: 'Barbarian',
              level: 5,
              isRaging: true,
              characterClass: 'barbarian',
            },
            { id: 'p2', name: 'Enemy' },
          ],
        },
      };

      const { result } = renderHook(() => useCombatMechanics(barbarianProps));

      vi.mocked(diceUtils.rollAttack).mockReturnValue({ total: 18, critical: false } as any);
      vi.mocked(attackUtils.calculateAttackDamage).mockReturnValue({
        rolls: [{ total: 12, isRageBonus: true }], // 10 base + 2 rage
        totalBeforeResistance: 12,
      } as any);

      await act(async () => {
        await result.current.handleEnhancedAttack('p1', 'p2');
      });

      expect(mockHandleCombatAction).toHaveBeenCalledWith(
        'attack',
        'p1',
        'p2',
        expect.objectContaining({
          damageDealt: 12,
        }),
      );
      expect(classFeatures.getRageDamageBonus).not.toHaveBeenCalled();
    });

    it('should manually add Rage damage if utility misses it', async () => {
      const barbarianProps = {
        ...defaultProps,
        activeEncounter: {
          participants: [
            {
              id: 'p1',
              name: 'Barbarian',
              level: 5,
              isRaging: true,
              characterClass: 'barbarian',
            },
            { id: 'p2', name: 'Enemy' },
          ],
        },
      };

      const { result } = renderHook(() => useCombatMechanics(barbarianProps));

      vi.mocked(diceUtils.rollAttack).mockReturnValue({ total: 18, critical: false } as any);
      vi.mocked(attackUtils.calculateAttackDamage).mockReturnValue({
        rolls: [{ total: 10 }], // No isRageBonus
        totalBeforeResistance: 10,
      } as any);
      vi.mocked(classFeatures.getRageDamageBonus).mockReturnValue(2);

      await act(async () => {
        await result.current.handleEnhancedAttack('p1', 'p2');
      });

      expect(classFeatures.getRageDamageBonus).toHaveBeenCalledWith(5);
      expect(mockHandleCombatAction).toHaveBeenCalledWith(
        'attack',
        'p1',
        'p2',
        expect.objectContaining({
          damageDealt: 12, // 10 + 2
        }),
      );
    });

    it('should return early if participant not found', async () => {
      const { result } = renderHook(() => useCombatMechanics(defaultProps));
      await act(async () => {
        await result.current.handleEnhancedAttack('non-existent');
      });
      expect(diceUtils.rollAttack).not.toHaveBeenCalled();
    });

    it('should return early if activeEncounter is null', async () => {
      const nullProps = { ...defaultProps, activeEncounter: null };
      const { result } = renderHook(() => useCombatMechanics(nullProps));
      await act(async () => {
        await result.current.handleEnhancedAttack('p1');
      });
      expect(diceUtils.rollAttack).not.toHaveBeenCalled();
    });
  });

  describe('handleRacialTraitUse', () => {
    it('should handle breath_weapon trait', async () => {
      const dragonbornProps = {
        ...defaultProps,
        activeEncounter: {
          participants: [
            {
              id: 'p1',
              name: 'Dragonborn',
              racialTraits: [{ name: 'breath_weapon' }],
            },
          ],
        },
      };

      const { result } = renderHook(() => useCombatMechanics(dragonbornProps));
      vi.mocked(racialTraits.canUseRacialTrait).mockReturnValue(true);

      await act(async () => {
        await result.current.handleRacialTraitUse('p1', 'breath_weapon');
      });

      expect(mockHandleCombatAction).toHaveBeenCalledWith(
        'bonus_action',
        'p1',
        undefined,
        expect.objectContaining({
          traitUsed: 'breath_weapon',
          description: expect.stringContaining('uses their breath weapon'),
        }),
      );
    });

    it('should handle relentless_endurance trait', async () => {
      const halfOrcProps = {
        ...defaultProps,
        activeEncounter: {
          participants: [
            {
              id: 'p1',
              name: 'Half-Orc',
              racialTraits: [{ name: 'relentless_endurance' }],
            },
          ],
        },
      };

      const { result } = renderHook(() => useCombatMechanics(halfOrcProps));
      vi.mocked(racialTraits.canUseRacialTrait).mockReturnValue(true);

      await act(async () => {
        await result.current.handleRacialTraitUse('p1', 'relentless_endurance');
      });

      expect(mockHandleCombatAction).toHaveBeenCalledWith(
        'bonus_action',
        'p1',
        undefined,
        expect.objectContaining({
          traitUsed: 'relentless_endurance',
          description: expect.stringContaining('drops to 1 hit point'),
        }),
      );
    });

    it('should not use trait if requirements not met', async () => {
      const { result } = renderHook(() => useCombatMechanics(defaultProps));
      vi.mocked(racialTraits.canUseRacialTrait).mockReturnValue(false);

      await act(async () => {
        await result.current.handleRacialTraitUse('p1', 'lucky');
      });

      expect(mockHandleCombatAction).not.toHaveBeenCalled();
    });

    it('should handle default case for unknown trait', async () => {
      const unknownProps = {
        ...defaultProps,
        activeEncounter: {
          participants: [
            {
              id: 'p1',
              name: 'Hero',
              racialTraits: [{ name: 'mysterious_power' }],
            },
          ],
        },
      };

      const { result } = renderHook(() => useCombatMechanics(unknownProps));
      vi.mocked(racialTraits.canUseRacialTrait).mockReturnValue(true);

      await act(async () => {
        await result.current.handleRacialTraitUse('p1', 'mysterious_power');
      });

      expect(mockHandleCombatAction).toHaveBeenCalledWith(
        'bonus_action',
        'p1',
        undefined,
        expect.objectContaining({
          traitUsed: 'mysterious_power',
          description: expect.stringContaining('uses mysterious_power'),
        }),
      );
    });
  });

  describe('handleClassFeature', () => {
    it('should handle rage activation', async () => {
      const rageProps = {
        ...defaultProps,
        activeEncounter: {
          participants: [
            {
              id: 'p1',
              name: 'Barbarian',
              classFeatures: [{ name: 'rage' }],
              resources: { rage: { current: 2 } },
              isRaging: false,
            },
          ],
        },
      };

      const { result } = renderHook(() => useCombatMechanics(rageProps));
      vi.mocked(classFeatures.canUseClassFeature).mockReturnValue(true);

      await act(async () => {
        await result.current.handleClassFeature('p1', 'rage');
      });

      expect(mockHandleCombatAction).toHaveBeenCalledWith(
        'use_class_feature',
        'p1',
        undefined,
        expect.objectContaining({
          featureUsed: 'rage',
          description: expect.stringContaining('enters a rage'),
        }),
      );
    });

    it('should handle rage deactivation', async () => {
      const rageProps = {
        ...defaultProps,
        activeEncounter: {
          participants: [
            {
              id: 'p1',
              name: 'Barbarian',
              classFeatures: [{ name: 'rage' }],
              resources: { rage: { current: 2 } },
              isRaging: true,
            },
          ],
        },
      };

      const { result } = renderHook(() => useCombatMechanics(rageProps));
      vi.mocked(classFeatures.canUseClassFeature).mockReturnValue(true);

      await act(async () => {
        await result.current.handleClassFeature('p1', 'rage');
      });

      expect(mockHandleCombatAction).toHaveBeenCalledWith(
        'end_rage',
        'p1',
        undefined,
        expect.objectContaining({
          featureUsed: 'rage',
          description: expect.stringContaining('stops raging'),
        }),
      );
    });

    it('should handle Action Surge', async () => {
      const fighterProps = {
        ...defaultProps,
        activeEncounter: {
          participants: [
            {
              id: 'p1',
              name: 'Fighter',
              classFeatures: [{ name: 'action_surge' }],
              resources: { action_surge: { current: 1 } },
            },
          ],
        },
      };

      const { result } = renderHook(() => useCombatMechanics(fighterProps));
      vi.mocked(classFeatures.canUseClassFeature).mockReturnValue(true);

      await act(async () => {
        await result.current.handleClassFeature('p1', 'action_surge');
      });

      expect(mockHandleCombatAction).toHaveBeenCalledWith(
        'action_surge',
        'p1',
        undefined,
        expect.objectContaining({
          featureUsed: 'action_surge',
        }),
      );
    });

    it('should handle Second Wind', async () => {
      const fighterProps = {
        ...defaultProps,
        activeEncounter: {
          participants: [
            {
              id: 'p1',
              name: 'Fighter',
              level: 5,
              classFeatures: [{ name: 'second_wind' }],
              resources: { second_wind: { current: 1 } },
            },
          ],
        },
      };

      const { result } = renderHook(() => useCombatMechanics(fighterProps));
      vi.mocked(classFeatures.canUseClassFeature).mockReturnValue(true);
      vi.mocked(diceUtils.rollDice).mockReturnValue({ total: 12 } as any);

      await act(async () => {
        await result.current.handleClassFeature('p1', 'second_wind');
      });

      expect(diceUtils.rollDice).toHaveBeenCalledWith(10, 1, 5);
      expect(mockHandleCombatAction).toHaveBeenCalledWith(
        'second_wind',
        'p1',
        undefined,
        expect.objectContaining({
          description: 'Fighter uses Second Wind to heal 12 hit points',
        }),
      );
    });

    it('should handle default case for unknown feature', async () => {
      const unknownProps = {
        ...defaultProps,
        activeEncounter: {
          participants: [
            {
              id: 'p1',
              name: 'Hero',
              classFeatures: [{ name: 'unknown_talent' }],
              resources: { unknown_talent: { current: 1 } },
            },
          ],
        },
      };

      const { result } = renderHook(() => useCombatMechanics(unknownProps));
      vi.mocked(classFeatures.canUseClassFeature).mockReturnValue(true);

      await act(async () => {
        await result.current.handleClassFeature('p1', 'unknown_talent');
      });

      expect(mockHandleCombatAction).toHaveBeenCalledWith(
        'use_class_feature',
        'p1',
        undefined,
        expect.objectContaining({
          featureUsed: 'unknown_talent',
          description: expect.stringContaining('uses unknown_talent'),
        }),
      );
    });
  });

  describe('handleDeathSave', () => {
    it('should execute death save and update participant', async () => {
      const dyingProps = {
        ...defaultProps,
        activeEncounter: {
          participants: [
            {
              id: 'p1',
              name: 'Dying Hero',
              currentHitPoints: 0,
              deathSaves: { successes: 0, failures: 0 },
            },
          ],
        },
      };

      const { result } = renderHook(() => useCombatMechanics(dyingProps));

      vi.mocked(deathSaves.needsDeathSaves).mockReturnValue(true);
      vi.mocked(deathSaves.rollDeathSave).mockReturnValue({
        roll: { total: 15, critical: false },
        updatedParticipant: {
          deathSaves: { successes: 1, failures: 0 },
          isStable: false,
          isDead: false,
          currentHitPoints: 0,
          isUnconscious: true,
        },
      } as any);

      await act(async () => {
        await result.current.handleDeathSave('p1');
      });

      expect(mockUpdateParticipant).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({
          deathSaves: { successes: 1, failures: 0 },
        }),
      );

      expect(mockTakeAction).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'death_save',
          description: 'Dying Hero death save: 15 (Success) (1/3, 0/3)',
        }),
      );
    });

    it('should return early if participant not found', async () => {
      const { result } = renderHook(() => useCombatMechanics(defaultProps));
      await act(async () => {
        await result.current.handleDeathSave('non-existent');
      });
      expect(deathSaves.rollDeathSave).not.toHaveBeenCalled();
    });
  });

  describe('handleConcentrationSave', () => {
    it('should handle successful concentration save', async () => {
      const concentratingProps = {
        ...defaultProps,
        activeEncounter: {
          participants: [
            {
              id: 'p1',
              name: 'Wizard',
              activeConcentration: { spellName: 'Haste' },
              abilityScores: { constitution: { modifier: 2 } },
              level: 5,
            },
          ],
        },
      };

      const { result } = renderHook(() => useCombatMechanics(concentratingProps));
      vi.mocked(characterCalculations.calculateProficiencyBonus).mockReturnValue(3);
      // Math.random() is used in handleConcentrationSave
      vi.spyOn(Math, 'random').mockReturnValue(0.95); // (0.95 * 20) + 1 = 20. Total = 20 + 2 + 3 = 25.

      await act(async () => {
        await result.current.handleConcentrationSave('p1', 10);
      });

      expect(mockTakeAction).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'concentration_save',
          concentrationResult: expect.objectContaining({ succeeded: true, roll: 25 }),
        }),
      );
      expect(mockUpdateParticipant).not.toHaveBeenCalled();
    });

    it('should handle failed concentration save and drop concentration', async () => {
      const concentratingProps = {
        ...defaultProps,
        activeEncounter: {
          participants: [
            {
              id: 'p1',
              name: 'Wizard',
              activeConcentration: { spellName: 'Haste' },
              abilityScores: { constitution: { modifier: 0 } },
              level: 1,
            },
          ],
        },
      };

      const { result } = renderHook(() => useCombatMechanics(concentratingProps));
      vi.mocked(characterCalculations.calculateProficiencyBonus).mockReturnValue(2);
      vi.spyOn(Math, 'random').mockReturnValue(0.05); // (0.05 * 20) + 1 = 2. Total = 2 + 0 + 2 = 4.

      await act(async () => {
        await result.current.handleConcentrationSave('p1', 10);
      });

      expect(mockTakeAction).toHaveBeenCalledWith(
        expect.objectContaining({
          concentrationResult: expect.objectContaining({ succeeded: false }),
        }),
      );
      expect(mockUpdateParticipant).toHaveBeenCalledWith('p1', { activeConcentration: null });
    });

    it('should return early if participant not found or not concentrating', async () => {
      const { result } = renderHook(() => useCombatMechanics(defaultProps));
      await act(async () => {
        await result.current.handleConcentrationSave('non-existent', 10);
      });
      expect(mockTakeAction).not.toHaveBeenCalled();

      await act(async () => {
        await result.current.handleConcentrationSave('p1', 10); // p1 is not concentrating in defaultProps
      });
      expect(mockTakeAction).not.toHaveBeenCalled();
    });
  });

  describe('handleTwoWeaponAttack', () => {
    it('should handle two-weapon fighting and execute both attacks', async () => {
      const fighterProps = {
        ...defaultProps,
        activeEncounter: {
          participants: [
            {
              id: 'p1',
              name: 'Dual Wielder',
              mainHandWeapon: { name: 'Scimitar' },
              offHandWeapon: { name: 'Shortsword' },
            },
          ],
        },
      };

      const { result } = renderHook(() => useCombatMechanics(fighterProps));
      vi.mocked(twoWeaponFighting.canUseTwoWeaponFighting).mockReturnValue(true);
      vi.mocked(twoWeaponFighting.canMakeOffHandAttack).mockReturnValue(true);
      vi.mocked(twoWeaponFighting.makeMainHandAttack).mockReturnValue({ type: 'main' } as any);
      vi.mocked(twoWeaponFighting.makeOffHandAttack).mockReturnValue({ type: 'off' } as any);

      await act(async () => {
        await result.current.handleTwoWeaponAttack('p1', 'p2');
      });

      expect(twoWeaponFighting.makeMainHandAttack).toHaveBeenCalled();
      expect(twoWeaponFighting.makeOffHandAttack).toHaveBeenCalled();
      expect(mockTakeAction).toHaveBeenCalledTimes(2);
    });

    it('should equip default weapons if none present', async () => {
      const unarmedProps = {
        ...defaultProps,
        activeEncounter: {
          participants: [
            {
              id: 'p1',
              name: 'Unarmed',
              mainHandWeapon: null,
              offHandWeapon: null,
            },
          ],
        },
      };

      const { result } = renderHook(() => useCombatMechanics(unarmedProps));
      const mockWeapons = { scimitar: { name: 'S' }, shortsword: { name: 'SS' } };
      vi.mocked(equipmentUtils.createDefaultLightWeapons).mockReturnValue(mockWeapons as any);
      vi.mocked(equipmentUtils.equipMainHandWeapon).mockReturnValue({
        mainHandWeapon: mockWeapons.scimitar,
      } as any);
      vi.mocked(equipmentUtils.equipOffHandWeapon).mockReturnValue({
        mainHandWeapon: mockWeapons.scimitar,
        offHandWeapon: mockWeapons.shortsword,
      } as any);
      vi.mocked(twoWeaponFighting.canUseTwoWeaponFighting).mockReturnValue(true);

      await act(async () => {
        await result.current.handleTwoWeaponAttack('p1', 'p2');
      });

      expect(equipmentUtils.createDefaultLightWeapons).toHaveBeenCalled();
      expect(equipmentUtils.equipMainHandWeapon).toHaveBeenCalled();
      expect(equipmentUtils.equipOffHandWeapon).toHaveBeenCalled();
    });

    it('should log warning if two-weapon fighting is not allowed', async () => {
      const { result } = renderHook(() => useCombatMechanics(defaultProps));
      vi.mocked(twoWeaponFighting.canUseTwoWeaponFighting).mockReturnValue(false);

      await act(async () => {
        await result.current.handleTwoWeaponAttack('p1', 'p2');
      });

      // No attacks should be made
      expect(mockTakeAction).not.toHaveBeenCalled();
    });

    it('should handle missing target and selectedEnemy', async () => {
      const noEnemyProps = {
        ...defaultProps,
        selectedEnemy: null,
      };
      const { result } = renderHook(() => useCombatMechanics(noEnemyProps));
      vi.mocked(twoWeaponFighting.canUseTwoWeaponFighting).mockReturnValue(true);

      await act(async () => {
        await result.current.handleTwoWeaponAttack('p1');
      });

      expect(twoWeaponFighting.makeMainHandAttack).toHaveBeenCalledWith(expect.anything(), '');
    });

    it('should not make off-hand attack if not allowed', async () => {
      const { result } = renderHook(() => useCombatMechanics(defaultProps));
      vi.mocked(twoWeaponFighting.canUseTwoWeaponFighting).mockReturnValue(true);
      vi.mocked(twoWeaponFighting.canMakeOffHandAttack).mockReturnValue(false);

      await act(async () => {
        await result.current.handleTwoWeaponAttack('p1', 'p2');
      });

      expect(twoWeaponFighting.makeMainHandAttack).toHaveBeenCalled();
      expect(twoWeaponFighting.makeOffHandAttack).not.toHaveBeenCalled();
    });
  });
});
