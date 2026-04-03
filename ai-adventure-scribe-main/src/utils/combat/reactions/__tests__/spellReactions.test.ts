/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';

import {
  checkShieldSpellOpportunities,
  canCastShieldSpell,
  checkAbsorbElementsOpportunities,
  canCastAbsorbElements,
  checkHellishRebukeOpportunities,
  canCastHellishRebuke,
} from '../spellReactions';

describe('spellReactions', () => {
  const encounter: any = { participants: [] };

  describe('checkShieldSpellOpportunities', () => {
    it('should return opportunity if shield can be cast', () => {
      const p: any = {
        id: 'p1',
        currentHitPoints: 10,
        reactionTaken: false,
        preparedSpells: ['shield'],
        spellSlots: { 1: { current: 1 } }
      };
      const opps = checkShieldSpellOpportunities(p, encounter);
      expect(opps).toHaveLength(1);
      expect(opps[0].availableReactions).toContain('shield_spell');
    });

    it('should return empty if dead', () => {
      const p: any = {
        id: 'p1',
        currentHitPoints: 0,
        reactionTaken: false,
        preparedSpells: ['shield'],
        spellSlots: { 1: { current: 1 } }
      };
      const opps = checkShieldSpellOpportunities(p, encounter);
      expect(opps).toHaveLength(0);
    });
  });

  describe('canCastShieldSpell', () => {
    it('should return true if prepared and has slots', () => {
      const p: any = {
        preparedSpells: ['shield'],
        spellSlots: { 1: { current: 1 } }
      };
      expect(canCastShieldSpell(p)).toBe(true);
    });

    it('should return false if not prepared', () => {
      const p: any = {
        preparedSpells: ['magic_missile'],
        spellSlots: { 1: { current: 1 } }
      };
      expect(canCastShieldSpell(p)).toBe(false);
    });

    it('should return false if no slots', () => {
      const p: any = {
        preparedSpells: ['shield'],
        spellSlots: { 1: { current: 0 } }
      };
      expect(canCastShieldSpell(p)).toBe(false);
    });
  });

  describe('checkAbsorbElementsOpportunities', () => {
    it('should return opportunity if can cast', () => {
      const p: any = {
        id: 'p1',
        currentHitPoints: 10,
        reactionTaken: false,
        preparedSpells: ['absorb_elements'],
        spellSlots: { 1: { current: 1 } }
      };
      const opps = checkAbsorbElementsOpportunities(p, encounter, 'fire');
      expect(opps).toHaveLength(1);
      expect(opps[0].availableReactions).toContain('absorb_elements');
    });
  });

  describe('canCastAbsorbElements', () => {
    it('should return true if prepared and has slots', () => {
      const p: any = {
        preparedSpells: ['absorb_elements'],
        spellSlots: { 1: { current: 1 } }
      };
      expect(canCastAbsorbElements(p, 'fire')).toBe(true);
    });

    it('should return false if no spellSlots or preparedSpells', () => {
      expect(canCastAbsorbElements({} as any, 'fire')).toBe(false);
      expect(canCastAbsorbElements({ spellSlots: {} } as any, 'fire')).toBe(false);
    });
  });

  describe('checkHellishRebukeOpportunities', () => {
    it('should return opportunity if can cast', () => {
      const target: any = {
        id: 'p1',
        currentHitPoints: 10,
        reactionTaken: false,
        preparedSpells: ['hellish_rebuke'],
        spellSlots: { 1: { current: 1 } }
      };
      const attacker: any = { id: 'a1', name: 'Orc' };
      const opps = checkHellishRebukeOpportunities(target, attacker, encounter);
      expect(opps).toHaveLength(1);
      expect(opps[0].availableReactions).toContain('hellish_rebuke');
    });
  });

  describe('canCastHellishRebuke', () => {
    it('should return true if prepared and has slots', () => {
      const p: any = {
        preparedSpells: ['hellish_rebuke'],
        spellSlots: { 1: { current: 1 } }
      };
      expect(canCastHellishRebuke(p)).toBe(true);
    });

    it('should return false if no spellSlots or preparedSpells', () => {
      expect(canCastHellishRebuke({} as any)).toBe(false);
      expect(canCastHellishRebuke({ spellSlots: {} } as any)).toBe(false);
    });
  });
});
