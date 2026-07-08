/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';

import { CLASS_FEATURES_MAP, getHitDie, getInitialCharacterResources } from '../class-definitions';
import { classes } from '@/data/classes';

describe('class-definitions', () => {
  it('provides subclass feature progression for every class', () => {
    expect(classes).toHaveLength(12);
    for (const characterClass of classes) {
      expect(characterClass.subclasses.length).toBeGreaterThan(0);
      expect(characterClass.subclasses[0].features.length).toBeGreaterThan(0);
      expect(characterClass.subclasses[0].features.every((feature) => feature.level >= 1)).toBe(true);
    }
  });
  describe('getHitDie', () => {
    it('should return correct hit die for all classes', () => {
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

    it('should return 8 as default for unknown class', () => {
      expect(getHitDie('commoner')).toBe(8);
    });

    it('should be case-insensitive', () => {
      expect(getHitDie('Barbarian')).toBe(12);
      expect(getHitDie('WIZARD')).toBe(6);
    });
  });

  describe('getInitialCharacterResources', () => {
    it('should initialize hit dice based on level', () => {
      const resources = getInitialCharacterResources('fighter', 5);
      expect(resources.hitDice).toEqual({ d10: { max: 5, current: 5 } });
    });

    describe('Barbarian Rage scaling', () => {
      it('should have 2 rages at level 1', () => {
        expect(getInitialCharacterResources('barbarian', 1).rages?.max).toBe(2);
      });
      it('should have 3 rages at level 3', () => {
        expect(getInitialCharacterResources('barbarian', 3).rages?.max).toBe(3);
      });
      it('should have 4 rages at level 6', () => {
        expect(getInitialCharacterResources('barbarian', 6).rages?.max).toBe(4);
      });
      it('should have 5 rages at level 12', () => {
        expect(getInitialCharacterResources('barbarian', 12).rages?.max).toBe(5);
      });
      it('should have 6 rages at level 17', () => {
        expect(getInitialCharacterResources('barbarian', 17).rages?.max).toBe(6);
      });
      it('should have unlimited (999) rages at level 20', () => {
        expect(getInitialCharacterResources('barbarian', 20).rages?.max).toBe(999);
      });
    });

    describe('Fighter Action Surge scaling', () => {
      it('should have 1 action surge at level 2', () => {
        expect(getInitialCharacterResources('fighter', 2).actionSurge?.max).toBe(1);
      });
      it('should have 2 action surges at level 17', () => {
        expect(getInitialCharacterResources('fighter', 17).actionSurge?.max).toBe(2);
      });
    });

    describe('Monk Ki scaling', () => {
      it('should have no ki at level 1', () => {
        expect(getInitialCharacterResources('monk', 1).kiPoints).toBeUndefined();
      });
      it('should have level amount of ki at level 2+', () => {
        expect(getInitialCharacterResources('monk', 2).kiPoints?.max).toBe(2);
        expect(getInitialCharacterResources('monk', 10).kiPoints?.max).toBe(10);
      });
    });

    describe('Sorcerer Sorcery Points scaling', () => {
      it('should have no sorcery points at level 1', () => {
        expect(getInitialCharacterResources('sorcerer', 1).sorceryPoints).toBeUndefined();
      });
      it('should have level amount of sorcery points at level 2+', () => {
        expect(getInitialCharacterResources('sorcerer', 2).sorceryPoints?.max).toBe(2);
        expect(getInitialCharacterResources('sorcerer', 20).sorceryPoints?.max).toBe(20);
      });
    });

    describe('Bardic Inspiration scaling', () => {
      it('should have 2 at level 1', () => {
        expect(getInitialCharacterResources('bard', 1).bardic_inspiration?.max).toBe(2);
      });
      it('should have 3 at level 5', () => {
        expect(getInitialCharacterResources('bard', 5).bardic_inspiration?.max).toBe(3);
      });
      it('should have 4 at level 15', () => {
        expect(getInitialCharacterResources('bard', 15).bardic_inspiration?.max).toBe(4);
      });
    });

    describe('Cleric Channel Divinity scaling', () => {
      it('should have none at level 1', () => {
        expect(getInitialCharacterResources('cleric', 1).channelDivinity).toBeUndefined();
      });
      it('should have 1 at level 2', () => {
        expect(getInitialCharacterResources('cleric', 2).channelDivinity?.max).toBe(1);
      });
      it('should have 2 at level 6', () => {
        expect(getInitialCharacterResources('cleric', 6).channelDivinity?.max).toBe(2);
      });
      it('should have 3 at level 18', () => {
        expect(getInitialCharacterResources('cleric', 18).channelDivinity?.max).toBe(3);
      });
    });

    describe('Paladin Resource initialization', () => {
      it('should have level * 5 Lay on Hands', () => {
        expect(getInitialCharacterResources('paladin', 1).layOnHands?.max).toBe(5);
        expect(getInitialCharacterResources('paladin', 10).layOnHands?.max).toBe(50);
      });
      it('should have no Channel Divinity before level 3', () => {
        expect(getInitialCharacterResources('paladin', 2).channelDivinity).toBeUndefined();
      });
      it('should have exactly 1 Channel Divinity at level 3+', () => {
        expect(getInitialCharacterResources('paladin', 3).channelDivinity?.max).toBe(1);
        expect(getInitialCharacterResources('paladin', 20).channelDivinity?.max).toBe(1);
      });
    });

    describe('Druid Wild Shape scaling', () => {
      it('should have none at level 1', () => {
        expect(getInitialCharacterResources('druid', 1).wildShape).toBeUndefined();
      });
      it('should have 2 at level 2', () => {
        expect(getInitialCharacterResources('druid', 2).wildShape?.max).toBe(2);
      });
      it('should have unlimited (999) at level 20', () => {
        expect(getInitialCharacterResources('druid', 20).wildShape?.max).toBe(999);
      });
    });
  });

  describe('CLASS_FEATURES_MAP', () => {
    it('should return empty features for unknown class', () => {
      expect(CLASS_FEATURES_MAP['unknown']).toBeUndefined();
    });

    it('should return correct features for Barbarian', () => {
      const getFeatures = CLASS_FEATURES_MAP['barbarian'];
      const lvl1 = getFeatures(1);
      expect(lvl1.some(f => f.name === 'rage')).toBe(true);
      expect(lvl1.some(f => f.name === 'unarmored_defense')).toBe(true);

      const rage = lvl1.find(f => f.name === 'rage');
      expect(rage?.maxUses).toBe(2);

      const lvl20 = getFeatures(20);
      const rage20 = lvl20.find(f => f.name === 'rage');
      expect(rage20?.maxUses).toBe(999); // Unlimited
    });

    it('should return correct features for Rogue', () => {
      const getFeatures = CLASS_FEATURES_MAP['rogue'];
      expect(getFeatures(1).some(f => f.name === 'sneak_attack')).toBe(true);
      expect(getFeatures(1).some(f => f.name === 'uncanny_dodge')).toBe(false);
      expect(getFeatures(5).some(f => f.name === 'uncanny_dodge')).toBe(true);
    });

    it('should return correct features for Fighter', () => {
      const getFeatures = CLASS_FEATURES_MAP['fighter'];
      expect(getFeatures(1).some(f => f.name === 'second_wind')).toBe(true);
      expect(getFeatures(2).some(f => f.name === 'action_surge')).toBe(true);
    });

    it('should return correct features for Monk', () => {
      const getFeatures = CLASS_FEATURES_MAP['monk'];
      expect(getFeatures(1).some(f => f.name === 'unarmored_defense')).toBe(true);
      expect(getFeatures(2).some(f => f.name === 'ki')).toBe(true);
      expect(getFeatures(3).some(f => f.name === 'deflect_missiles')).toBe(true);
    });

    it('should return correct features for Bard', () => {
      const getFeatures = CLASS_FEATURES_MAP['bard'];
      expect(getFeatures(1).some(f => f.name === 'bardic_inspiration')).toBe(true);
    });

    it('should return correct features for Cleric', () => {
      const getFeatures = CLASS_FEATURES_MAP['cleric'];
      expect(getFeatures(2).some(f => f.name === 'channel_divinity')).toBe(true);
    });

    it('should return correct features for Paladin', () => {
      const getFeatures = CLASS_FEATURES_MAP['paladin'];
      expect(getFeatures(1).some(f => f.name === 'lay_on_hands')).toBe(true);
      expect(getFeatures(2).some(f => f.name === 'divine_smite')).toBe(true);
      expect(getFeatures(3).some(f => f.name === 'channel_divinity')).toBe(true);

      const cd = getFeatures(3).find(f => f.name === 'channel_divinity');
      expect(cd?.maxUses).toBe(1);
    });

    it('should return correct features for Druid', () => {
      const getFeatures = CLASS_FEATURES_MAP['druid'];
      expect(getFeatures(1).some(f => f.name === 'wild_shape')).toBe(false);
      expect(getFeatures(2).some(f => f.name === 'wild_shape')).toBe(true);

      const ws2 = getFeatures(2).find(f => f.name === 'wild_shape');
      expect(ws2?.maxUses).toBe(2);

      const ws20 = getFeatures(20).find(f => f.name === 'wild_shape');
      expect(ws20?.maxUses).toBe(999);
    });
  });
});
