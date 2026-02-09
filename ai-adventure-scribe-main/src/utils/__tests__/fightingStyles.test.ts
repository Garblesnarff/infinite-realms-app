/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect } from 'vitest';

import {
  hasFightingStyle,
  getFightingStyles,
  addFightingStyle,
  getFightingStyleACBonus,
  getFightingStyleAttackBonus,
  getFightingStyleDamageBonus,
  applyGreatWeaponFighting,
  canUseProtection,
  applyBlindFighting,
  getBlessedWarriorCantrips,
  weaponQualifiesForStyle,
  getFightingStyleRecommendations,
  getTotalAC,
  FIGHTING_STYLES
} from '../fightingStyles';

import type { CombatParticipant, WeaponProperties } from '@/types/combat';

describe('fightingStyles', () => {
  const mockParticipant: Partial<CombatParticipant> = {
    id: '1',
    name: 'Fighter',
    armorClass: 16,
    fightingStyles: [],
  };

  describe('hasFightingStyle', () => {
    it('should return true if the participant has the style', () => {
      const p = { ...mockParticipant, fightingStyles: [FIGHTING_STYLES.defense] } as CombatParticipant;
      expect(hasFightingStyle(p, 'defense')).toBe(true);
    });

    it('should return false if the participant does not have the style', () => {
      const p = { ...mockParticipant, fightingStyles: [] } as CombatParticipant;
      expect(hasFightingStyle(p, 'defense')).toBe(false);
    });

    it('should handle missing fightingStyles property', () => {
      const p = { ...mockParticipant, fightingStyles: undefined } as unknown as CombatParticipant;
      expect(hasFightingStyle(p, 'defense')).toBe(false);
    });
  });

  describe('getFightingStyles', () => {
    it('should return all fighting styles of the participant', () => {
      const styles = [FIGHTING_STYLES.defense, FIGHTING_STYLES.archery];
      const p = { ...mockParticipant, fightingStyles: styles } as CombatParticipant;
      expect(getFightingStyles(p)).toEqual(styles);
    });

    it('should return an empty array if participant has no styles', () => {
      const p = { ...mockParticipant, fightingStyles: undefined } as unknown as CombatParticipant;
      expect(getFightingStyles(p)).toEqual([]);
    });
  });

  describe('addFightingStyle', () => {
    it('should add a style to the participant', () => {
      const p = { ...mockParticipant, fightingStyles: [] } as CombatParticipant;
      const updated = addFightingStyle(p, 'archery');
      expect(updated.fightingStyles).toContainEqual(FIGHTING_STYLES.archery);
    });

    it('should not add duplicate styles', () => {
      const p = { ...mockParticipant, fightingStyles: [FIGHTING_STYLES.archery] } as CombatParticipant;
      const updated = addFightingStyle(p, 'archery');
      expect(updated.fightingStyles?.length).toBe(1);
    });
  });

  describe('getFightingStyleACBonus', () => {
    it('should return 1 for defense style', () => {
      const p = { ...mockParticipant, fightingStyles: [FIGHTING_STYLES.defense] } as CombatParticipant;
      expect(getFightingStyleACBonus(p)).toBe(1);
    });

    it('should return 0 for other styles', () => {
      const p = { ...mockParticipant, fightingStyles: [FIGHTING_STYLES.archery] } as CombatParticipant;
      expect(getFightingStyleACBonus(p)).toBe(0);
    });
  });

  describe('getFightingStyleAttackBonus', () => {
    it('should return 2 for archery style with ranged attack', () => {
      const p = { ...mockParticipant, fightingStyles: [FIGHTING_STYLES.archery] } as CombatParticipant;
      expect(getFightingStyleAttackBonus(p, true)).toBe(2);
    });

    it('should return 0 for archery style with melee attack', () => {
      const p = { ...mockParticipant, fightingStyles: [FIGHTING_STYLES.archery] } as CombatParticipant;
      expect(getFightingStyleAttackBonus(p, false)).toBe(0);
    });
  });

  describe('getFightingStyleDamageBonus', () => {
    const meleeWeapon = { properties: { twoHanded: false } as WeaponProperties };
    const twoHandedWeapon = { properties: { twoHanded: true } as WeaponProperties };

    it('should return 2 for dueling style with one-handed melee weapon', () => {
      const p = { ...mockParticipant, fightingStyles: [FIGHTING_STYLES.dueling] } as CombatParticipant;
      expect(getFightingStyleDamageBonus(p, meleeWeapon)).toBe(2);
    });

    it('should return 0 for dueling style if wielding off-hand weapon', () => {
      const p = {
        ...mockParticipant,
        fightingStyles: [FIGHTING_STYLES.dueling],
        offHandWeapon: {} as any
      } as CombatParticipant;
      expect(getFightingStyleDamageBonus(p, meleeWeapon)).toBe(0);
    });

    it('should return 0 for dueling style with two-handed weapon', () => {
      const p = { ...mockParticipant, fightingStyles: [FIGHTING_STYLES.dueling] } as CombatParticipant;
      expect(getFightingStyleDamageBonus(p, twoHandedWeapon)).toBe(0);
    });
  });

  describe('applyGreatWeaponFighting', () => {
    const twoHandedWeapon = { properties: { twoHanded: true } as WeaponProperties };
    const damageRoll = {
      dieType: 10,
      results: [1, 5],
      modifier: 2,
      total: 8
    };

    it('should reroll 1s and 2s if participant has style and weapon is two-handed', () => {
      const p = { ...mockParticipant, fightingStyles: [FIGHTING_STYLES.great_weapon_fighting] } as CombatParticipant;
      const result = applyGreatWeaponFighting(p, damageRoll as any, twoHandedWeapon);
      expect(result.results).toEqual([1, 5]); // Original results kept
      expect(result.keptResults![0]).not.toBe(1); // 1 should be rerolled
      expect(result.keptResults![1]).toBe(5); // 5 should stay
    });

    it('should not reroll if weapon is not two-handed', () => {
      const p = { ...mockParticipant, fightingStyles: [FIGHTING_STYLES.great_weapon_fighting] } as CombatParticipant;
      const result = applyGreatWeaponFighting(p, damageRoll as any, { properties: { twoHanded: false } });
      expect(result).toEqual(damageRoll);
    });
  });

  describe('canUseProtection', () => {
    it('should return true if all conditions are met', () => {
      const p = {
        ...mockParticipant,
        fightingStyles: [FIGHTING_STYLES.protection],
        reactionTaken: false,
        armorClass: 16 // Shield detection simplified
      } as CombatParticipant;
      const ally = { id: '2' } as CombatParticipant;
      const attacker = { id: '3' } as CombatParticipant;
      expect(canUseProtection(p, ally, attacker).canUse).toBe(true);
    });

    it('should return false if reaction already taken', () => {
      const p = {
        ...mockParticipant,
        fightingStyles: [FIGHTING_STYLES.protection],
        reactionTaken: true,
        armorClass: 16
      } as CombatParticipant;
      expect(canUseProtection(p, {} as any, {} as any).canUse).toBe(false);
    });
  });

  describe('applyBlindFighting', () => {
    it('should add blindsight if not present', () => {
      const p = {
        ...mockParticipant,
        fightingStyles: [FIGHTING_STYLES.blind_fighting],
        visionTypes: [{ type: 'normal', range: 60 }]
      } as any;
      const updated = applyBlindFighting(p);
      expect(updated.visionTypes).toContainEqual({ type: 'blindsight', range: 10 });
    });

    it('should not add duplicate blindsight', () => {
      const p = {
        ...mockParticipant,
        fightingStyles: [FIGHTING_STYLES.blind_fighting],
        visionTypes: [{ type: 'blindsight', range: 10 }]
      } as any;
      const updated = applyBlindFighting(p);
      expect(updated.visionTypes.filter((v: any) => v.type === 'blindsight').length).toBe(1);
    });

    it('should return participant as is if they do not have blind fighting style', () => {
      const p = { ...mockParticipant, fightingStyles: [] } as CombatParticipant;
      expect(applyBlindFighting(p)).toEqual(p);
    });
  });

  describe('getBlessedWarriorCantrips', () => {
    it('should return cantrips for blessed warrior style', () => {
      const p = { ...mockParticipant, fightingStyles: [FIGHTING_STYLES.blessed_warrior] } as CombatParticipant;
      const cantrips = getBlessedWarriorCantrips(p);
      expect(cantrips).toContain('guidance');
      expect(cantrips.length).toBeGreaterThan(0);
    });

    it('should return empty array for other styles', () => {
      const p = { ...mockParticipant, fightingStyles: [] } as CombatParticipant;
      expect(getBlessedWarriorCantrips(p)).toEqual([]);
    });
  });

  describe('weaponQualifiesForStyle', () => {
    it('should validate dueling style', () => {
      expect(weaponQualifiesForStyle({ properties: { twoHanded: false } }, 'dueling')).toBe(true);
      expect(weaponQualifiesForStyle({ properties: { twoHanded: true } }, 'dueling')).toBe(false);
    });

    it('should validate great weapon fighting style', () => {
      expect(weaponQualifiesForStyle({ properties: { twoHanded: true } }, 'great_weapon_fighting')).toBe(true);
      expect(weaponQualifiesForStyle({ properties: { versatile: true } }, 'great_weapon_fighting')).toBe(true);
      expect(weaponQualifiesForStyle({ properties: { twoHanded: false, versatile: false } }, 'great_weapon_fighting')).toBe(false);
    });

    it('should validate two weapon fighting style', () => {
      expect(weaponQualifiesForStyle({ properties: { light: true } }, 'two_weapon_fighting')).toBe(true);
      expect(weaponQualifiesForStyle({ properties: { light: false } }, 'two_weapon_fighting')).toBe(false);
    });
  });

  describe('getFightingStyleRecommendations', () => {
    it('should recommend dueling for one-handed preference', () => {
      const recommendations = getFightingStyleRecommendations('Fighter', 'one-handed');
      expect(recommendations).toContain('dueling');
    });

    it('should recommend archery for ranged preference', () => {
      const recommendations = getFightingStyleRecommendations('Fighter', 'ranged');
      expect(recommendations).toContain('archery');
    });

    it('should recommend blessed_warrior for paladins', () => {
      const recommendations = getFightingStyleRecommendations('Paladin', 'one-handed');
      expect(recommendations).toContain('blessed_warrior');
    });
  });

  describe('getTotalAC', () => {
    it('should include defense style bonus', () => {
      const p = {
        ...mockParticipant,
        armorClass: 15,
        fightingStyles: [FIGHTING_STYLES.defense]
      } as CombatParticipant;
      expect(getTotalAC(p)).toBe(16);
    });

    it('should include cover bonus', () => {
      const p = {
        ...mockParticipant,
        armorClass: 15,
        cover: { acBonus: 2 }
      } as any;
      expect(getTotalAC(p)).toBe(17);
    });
  });
});
