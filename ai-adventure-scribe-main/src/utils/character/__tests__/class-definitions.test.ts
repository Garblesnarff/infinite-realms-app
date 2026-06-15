import { describe, it, expect } from 'vitest';

import {
  CLASS_FEATURES_MAP,
  getHitDie,
  getInitialCharacterResources
} from '../class-definitions';

describe('class-definitions', () => {
  describe('CLASS_FEATURES_MAP', () => {
    it('should provide barbarian features at different levels and test rage scaling', () => {
      const level1 = CLASS_FEATURES_MAP.barbarian(1);
      expect(level1).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'rage' }),
        expect.objectContaining({ name: 'unarmored_defense' })
      ]));

      expect(CLASS_FEATURES_MAP.barbarian(1).find(f => f.name === 'rage')?.maxUses).toBe(2);
      expect(CLASS_FEATURES_MAP.barbarian(2).find(f => f.name === 'rage')?.maxUses).toBe(2);
      expect(CLASS_FEATURES_MAP.barbarian(3).find(f => f.name === 'rage')?.maxUses).toBe(3);
      expect(CLASS_FEATURES_MAP.barbarian(5).find(f => f.name === 'rage')?.maxUses).toBe(3);
      expect(CLASS_FEATURES_MAP.barbarian(6).find(f => f.name === 'rage')?.maxUses).toBe(4);
      expect(CLASS_FEATURES_MAP.barbarian(11).find(f => f.name === 'rage')?.maxUses).toBe(4);
      expect(CLASS_FEATURES_MAP.barbarian(12).find(f => f.name === 'rage')?.maxUses).toBe(5);
      expect(CLASS_FEATURES_MAP.barbarian(16).find(f => f.name === 'rage')?.maxUses).toBe(5);
      expect(CLASS_FEATURES_MAP.barbarian(17).find(f => f.name === 'rage')?.maxUses).toBe(6);
      expect(CLASS_FEATURES_MAP.barbarian(20).find(f => f.name === 'rage')?.maxUses).toBe(6);
    });

    it('should provide rogue features at different levels', () => {
      const level1 = CLASS_FEATURES_MAP.rogue(1);
      expect(level1).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'sneak_attack' })
      ]));
      expect(level1.find(f => f.name === 'uncanny_dodge')).toBeUndefined();

      const level5 = CLASS_FEATURES_MAP.rogue(5);
      expect(level5).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'sneak_attack' }),
        expect.objectContaining({ name: 'uncanny_dodge' })
      ]));
    });

    it('should provide fighter features at different levels', () => {
      const level1 = CLASS_FEATURES_MAP.fighter(1);
      expect(level1).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'second_wind' })
      ]));

      const level2 = CLASS_FEATURES_MAP.fighter(2);
      expect(level2).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'action_surge' })
      ]));
      expect(level2.find(f => f.name === 'action_surge')?.maxUses).toBe(1);

      const level17 = CLASS_FEATURES_MAP.fighter(17);
      expect(level17.find(f => f.name === 'action_surge')?.maxUses).toBe(2);
    });

    it('should provide paladin features at different levels', () => {
      const level1 = CLASS_FEATURES_MAP.paladin(1);
      expect(level1).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'lay_on_hands' })
      ]));

      const level2 = CLASS_FEATURES_MAP.paladin(2);
      expect(level2).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'divine_smite' })
      ]));
    });

    it('should provide monk features at different levels', () => {
      const level1 = CLASS_FEATURES_MAP.monk(1);
      expect(level1).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'unarmored_defense' })
      ]));

      const level3 = CLASS_FEATURES_MAP.monk(3);
      expect(level3).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'deflect_missiles' })
      ]));
    });

    it('should provide bard features and test inspiration scaling', () => {
      const level1 = CLASS_FEATURES_MAP.bard(1);
      expect(level1).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'bardic_inspiration' })
      ]));
      expect(level1.find(f => f.name === 'bardic_inspiration')?.maxUses).toBe(2);
      expect(CLASS_FEATURES_MAP.bard(5).find(f => f.name === 'bardic_inspiration')?.maxUses).toBe(3);
      expect(CLASS_FEATURES_MAP.bard(14).find(f => f.name === 'bardic_inspiration')?.maxUses).toBe(3);
      expect(CLASS_FEATURES_MAP.bard(15).find(f => f.name === 'bardic_inspiration')?.maxUses).toBe(4);
    });

    it('should provide cleric features and test channel divinity scaling', () => {
      const level1 = CLASS_FEATURES_MAP.cleric(1);
      expect(level1).toHaveLength(0);

      const level2 = CLASS_FEATURES_MAP.cleric(2);
      expect(level2).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'channel_divinity' })
      ]));
      expect(level2.find(f => f.name === 'channel_divinity')?.maxUses).toBe(1);
      expect(CLASS_FEATURES_MAP.cleric(6).find(f => f.name === 'channel_divinity')?.maxUses).toBe(2);
      expect(CLASS_FEATURES_MAP.cleric(17).find(f => f.name === 'channel_divinity')?.maxUses).toBe(2);
      expect(CLASS_FEATURES_MAP.cleric(18).find(f => f.name === 'channel_divinity')?.maxUses).toBe(3);
    });
  });

  describe('getHitDie', () => {
    it('should return correct hit die for various classes', () => {
      expect(getHitDie('barbarian')).toBe(12);
      expect(getHitDie('fighter')).toBe(10);
      expect(getHitDie('paladin')).toBe(10);
      expect(getHitDie('ranger')).toBe(10);
      expect(getHitDie('bard')).toBe(8);
      expect(getHitDie('cleric')).toBe(8);
      expect(getHitDie('druid')).toBe(8);
      expect(getHitDie('monk')).toBe(8);
      expect(getHitDie('rogue')).toBe(8);
      expect(getHitDie('warlock')).toBe(8);
      expect(getHitDie('sorcerer')).toBe(6);
      expect(getHitDie('wizard')).toBe(6);
    });

    it('should handle unknown classes with default 8', () => {
      expect(getHitDie('commoner')).toBe(8);
    });
  });

  describe('getInitialCharacterResources', () => {
    it('should initialize barbarian resources and test rage scaling', () => {
      const res1 = getInitialCharacterResources('barbarian', 1);
      expect(res1.hitDice?.d12).toBeDefined();
      expect(res1.rages?.max).toBe(2);

      expect(getInitialCharacterResources('barbarian', 3).rages?.max).toBe(3);
      expect(getInitialCharacterResources('barbarian', 6).rages?.max).toBe(4);
      expect(getInitialCharacterResources('barbarian', 12).rages?.max).toBe(5);
      expect(getInitialCharacterResources('barbarian', 17).rages?.max).toBe(6);
    });

    it('should initialize fighter resources', () => {
      const res = getInitialCharacterResources('fighter', 2);
      expect(res.actionSurge?.max).toBe(1);
      expect(getInitialCharacterResources('fighter', 17).actionSurge?.max).toBe(2);
    });

    it('should initialize monk resources', () => {
      const res = getInitialCharacterResources('monk', 2);
      expect(res.kiPoints?.max).toBe(2);
    });

    it('should initialize sorcerer resources', () => {
      const res = getInitialCharacterResources('sorcerer', 2);
      expect(res.sorceryPoints?.max).toBe(2);
    });

    it('should initialize bard resources', () => {
      const res = getInitialCharacterResources('bard', 1);
      expect(res.bardic_inspiration?.max).toBe(2);
      expect(getInitialCharacterResources('bard', 5).bardic_inspiration?.max).toBe(3);
      expect(getInitialCharacterResources('bard', 15).bardic_inspiration?.max).toBe(4);
    });

    it('should initialize cleric resources', () => {
      const res = getInitialCharacterResources('cleric', 2);
      expect(res.channelDivinity?.max).toBe(1);
      expect(getInitialCharacterResources('cleric', 6).channelDivinity?.max).toBe(2);
      expect(getInitialCharacterResources('cleric', 18).channelDivinity?.max).toBe(3);
    });

    it('should initialize paladin resources', () => {
      const res = getInitialCharacterResources('paladin', 2);
      expect(res.layOnHands?.max).toBe(10);
      expect(res.channelDivinity?.max).toBe(1);
      expect(getInitialCharacterResources('paladin', 6).channelDivinity?.max).toBe(2);
      expect(getInitialCharacterResources('paladin', 18).channelDivinity?.max).toBe(3);
    });

    it('should handle classes without special resources', () => {
        const res = getInitialCharacterResources('rogue', 1);
        expect(res.hitDice?.d8).toBeDefined();
        expect(Object.keys(res)).toHaveLength(1);
    });
  });
});
