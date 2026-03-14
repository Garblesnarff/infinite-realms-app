/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';

import {
  createReactionOpportunity,
  canMakeOpportunityAttack,
  canCastCounterspell,
  canDeflectMissiles,
  hasUncannyDodge,
  hasProtectionFightingStyle,
  hasPolearmMaster,
  isWithinReach,
  isWithinCounterspellRange,
} from '../reactionUtils';

describe('reactionUtils', () => {
  describe('createReactionOpportunity', () => {
    it('should create a reaction opportunity with unique ID', () => {
      const opp = createReactionOpportunity('p1', 'damage_taken', 'Hit', ['shield_spell']);
      expect(opp.id).toMatch(/^reaction_/);
      expect(opp.participantId).toBe('p1');
      expect(opp.availableReactions).toEqual(['shield_spell']);
    });
  });

  describe('canMakeOpportunityAttack', () => {
    const target: any = { id: 't1' };

    it('should return true for healthy participant', () => {
      const p: any = { conditions: [] };
      expect(canMakeOpportunityAttack(p, target)).toBe(true);
    });

    it('should return false if incapacitated', () => {
      const p: any = { conditions: [{ name: 'stunned' }] };
      expect(canMakeOpportunityAttack(p, target)).toBe(false);
    });

    it('should return false if blinded', () => {
      const p: any = { conditions: [{ name: 'blinded' }] };
      // This is currently a bug, it should be false
      expect(canMakeOpportunityAttack(p, target)).toBe(false);
    });
  });

  describe('canCastCounterspell', () => {
    it('should return false if no spell slots', () => {
      const p: any = { preparedSpells: ['counterspell'] };
      expect(canCastCounterspell(p)).toBe(false);
    });

    it('should return true if has 3rd level slots and counterspell prepared', () => {
      const p: any = {
        preparedSpells: ['counterspell'],
        spellSlots: { 3: { current: 1 } }
      };
      // Currently fails because counterspell preparation is not checked
      expect(canCastCounterspell(p)).toBe(true);
    });

    it('should return false if counterspell not prepared', () => {
      const p: any = {
        preparedSpells: ['fireball'],
        spellSlots: { 3: { current: 1 } }
      };
      expect(canCastCounterspell(p)).toBe(false);
    });
  });

  describe('canDeflectMissiles', () => {
    it('should return true if has feature', () => {
      const p: any = { classFeatures: [{ name: 'deflect_missiles' }] };
      expect(canDeflectMissiles(p)).toBe(true);
    });

    it('should return false if missing feature', () => {
      const p: any = { classFeatures: [] };
      expect(canDeflectMissiles(p)).toBe(false);
    });
  });

  describe('hasUncannyDodge', () => {
    it('should return true if has feature', () => {
      const p: any = { classFeatures: [{ name: 'uncanny_dodge' }] };
      expect(hasUncannyDodge(p)).toBe(true);
    });
  });

  describe('hasProtectionFightingStyle', () => {
    it('should return true if has style', () => {
      const p: any = { fightingStyles: [{ name: 'protection' }] };
      expect(hasProtectionFightingStyle(p)).toBe(true);
    });
  });

  describe('hasPolearmMaster', () => {
    it('should return true if has feature', () => {
      const p: any = { classFeatures: [{ name: 'polearm_master' }] };
      expect(hasPolearmMaster(p)).toBe(true);
    });
  });

  describe('isWithinReach', () => {
    const p: any = {};
    const t: any = {};
    it('should return true if not far', () => {
      expect(isWithinReach(p, t, 'melee')).toBe(true);
    });
    it('should return false if far', () => {
      expect(isWithinReach(p, t, 'far')).toBe(false);
    });
  });

  describe('isWithinCounterspellRange', () => {
    it('should return true', () => {
      expect(isWithinCounterspellRange({} as any, {} as any)).toBe(true);
    });
  });
});
