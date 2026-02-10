/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';

import {
  createDefaultLightWeapons,
  equipMainHandWeapon,
  equipOffHandWeapon,
  canDualWield,
  getEquippedWeapons,
  getWeaponProficiencyBonus
} from '../equipmentUtils';

import type { CombatParticipant } from '@/types/combat';

describe('equipmentUtils', () => {
  describe('createDefaultLightWeapons', () => {
    it('should create a set of default light weapons', () => {
      const weapons = createDefaultLightWeapons();
      expect(weapons.scimitar.name).toBe('Scimitar');
      expect(weapons.scimitar.weaponProperties?.light).toBe(true);
      expect(weapons.shortsword.name).toBe('Shortsword');
      expect(weapons.shortsword.weaponProperties?.light).toBe(true);
      expect(weapons.handaxe.name).toBe('Handaxe');
      expect(weapons.handaxe.weaponProperties?.light).toBe(true);
      expect(weapons.dagger.name).toBe('Dagger');
      expect(weapons.dagger.weaponProperties?.light).toBe(true);
    });
  });

  describe('equip weapons', () => {
    const mockParticipant: CombatParticipant = {
      id: '1',
      name: 'Test Hero',
      currentHitPoints: 10,
      maxHitPoints: 10,
    } as any;

    const weapons = createDefaultLightWeapons();

    it('should equip main hand weapon', () => {
      const updated = equipMainHandWeapon(mockParticipant, weapons.scimitar);
      expect(updated.mainHandWeapon).toEqual(weapons.scimitar);
    });

    it('should equip off hand weapon', () => {
      const updated = equipOffHandWeapon(mockParticipant, weapons.shortsword);
      expect(updated.offHandWeapon).toEqual(weapons.shortsword);
    });
  });

  describe('canDualWield', () => {
    const weapons = createDefaultLightWeapons();
    const heavyWeapon: any = {
      name: 'Greataxe',
      weaponProperties: { heavy: true }
    };

    it('should return true if both weapons are light', () => {
      const participant: any = {
        mainHandWeapon: weapons.scimitar,
        offHandWeapon: weapons.shortsword
      };
      expect(canDualWield(participant)).toBe(true);
    });

    it('should return false if main hand is missing', () => {
      const participant: any = {
        offHandWeapon: weapons.shortsword
      };
      expect(canDualWield(participant)).toBe(false);
    });

    it('should return false if off hand is missing', () => {
      const participant: any = {
        mainHandWeapon: weapons.scimitar
      };
      expect(canDualWield(participant)).toBe(false);
    });

    it('should return false if one weapon is not light', () => {
      const participant: any = {
        mainHandWeapon: heavyWeapon,
        offHandWeapon: weapons.shortsword
      };
      expect(canDualWield(participant)).toBe(false);
    });
  });

  describe('getEquippedWeapons', () => {
    const weapons = createDefaultLightWeapons();

    it('should return all equipped weapons', () => {
      const participant: any = {
        mainHandWeapon: weapons.scimitar,
        offHandWeapon: weapons.shortsword
      };
      const equipped = getEquippedWeapons(participant);
      expect(equipped.mainHand).toEqual(weapons.scimitar);
      expect(equipped.offHand).toEqual(weapons.shortsword);
      expect(equipped.allWeapons).toHaveLength(2);
      expect(equipped.allWeapons).toContain(weapons.scimitar);
      expect(equipped.allWeapons).toContain(weapons.shortsword);
    });

    it('should handle only main hand equipped', () => {
      const participant: any = {
        mainHandWeapon: weapons.scimitar
      };
      const equipped = getEquippedWeapons(participant);
      expect(equipped.allWeapons).toHaveLength(1);
      expect(equipped.allWeapons).toContain(weapons.scimitar);
    });
  });

  describe('getWeaponProficiencyBonus', () => {
    const simpleWeapon: any = { weaponType: 'simple' };
    const martialWeapon: any = { weaponType: 'martial' };

    it('should return +2 for level 1 simple weapon', () => {
      const participant: any = { level: 1, characterClass: 'Wizard' };
      expect(getWeaponProficiencyBonus(participant, simpleWeapon)).toBe(2);
    });

    it('should return +2 for level 4 simple weapon', () => {
      const participant: any = { level: 4, characterClass: 'Wizard' };
      // D&D 5e rule: Level 4 is +2.
      expect(getWeaponProficiencyBonus(participant, simpleWeapon)).toBe(2);
    });

    it('should return +3 for level 5 simple weapon', () => {
      const participant: any = { level: 5, characterClass: 'Wizard' };
      expect(getWeaponProficiencyBonus(participant, simpleWeapon)).toBe(3);
    });

    it('should handle martial proficiency for Fighter', () => {
      const participant: any = { level: 1, characterClass: 'Fighter' };
      expect(getWeaponProficiencyBonus(participant, martialWeapon)).toBe(2);
    });

    it('should not handle martial proficiency for Wizard', () => {
      const participant: any = { level: 1, characterClass: 'Wizard' };
      expect(getWeaponProficiencyBonus(participant, martialWeapon)).toBe(0);
    });

    it('should default to level 1 if level is missing', () => {
      const participant: any = { characterClass: 'Wizard' };
      expect(getWeaponProficiencyBonus(participant, simpleWeapon)).toBe(2);
    });
  });
});
