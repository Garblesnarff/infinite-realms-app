/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';

import { shouldEndCombat, getDiceRollRequirements } from '../utils';

describe('combat detection utils', () => {
  describe('shouldEndCombat', () => {
    it('should return true for combat ending phrases', () => {
      expect(shouldEndCombat('The battle is over')).toBe(true);
      expect(shouldEndCombat('Combat has ended')).toBe(true);
      expect(shouldEndCombat('Enemies defeated')).toBe(true);
      expect(shouldEndCombat('You are victorious')).toBe(true);
    });

    it('should be case-insensitive', () => {
      expect(shouldEndCombat('COMBAT ENDS')).toBe(true);
    });

    it('should return false for phrases that do not end combat', () => {
      expect(shouldEndCombat('The battle continues')).toBe(false);
      expect(shouldEndCombat('A new enemy appears')).toBe(false);
      expect(shouldEndCombat('You take 10 damage')).toBe(false);
    });
  });

  describe('getDiceRollRequirements', () => {
    it('should return zeros for empty actions', () => {
      expect(getDiceRollRequirements([])).toEqual({
        attackRolls: 0,
        damageRolls: 0,
        savingThrows: 0,
        skillChecks: 0
      });
    });

    it('should count attack and damage rolls for attack actions', () => {
      const actions = [
        {
          actor: 'Goblin',
          action: 'attack',
          rollNeeded: true,
          rollType: 'attack' as any,
          target: '',
          weapon: 'sword'
        }
      ];
      expect(getDiceRollRequirements(actions)).toMatchObject({
        attackRolls: 1,
        damageRolls: 1
      });
    });

    it('should count saving throws for spell actions', () => {
      const actions = [
        {
          actor: 'Cultist',
          action: 'spell',
          rollNeeded: true,
          rollType: 'save' as any,
          target: '',
          weapon: ''
        }
      ];
      expect(getDiceRollRequirements(actions)).toMatchObject({
        savingThrows: 1
      });
    });

    it('should count skill checks for skill actions', () => {
      const actions = [
        {
          actor: 'Player',
          action: 'hide',
          rollNeeded: true,
          rollType: 'skill' as any,
          target: '',
          weapon: ''
        }
      ];
      expect(getDiceRollRequirements(actions)).toMatchObject({
        skillChecks: 1
      });
    });

    it('should skip actions that do not need rolls', () => {
      const actions = [
        {
          actor: 'Player',
          action: 'damage',
          rollNeeded: false,
          rollType: 'damage' as any,
          target: '',
          weapon: ''
        }
      ];
      expect(getDiceRollRequirements(actions)).toMatchObject({
        damageRolls: 0
      });
    });

    it('should aggregate multiple actions correctly', () => {
      const actions = [
        { actor: 'A', action: 'attack', rollNeeded: true, rollType: 'attack' as any, target: '', weapon: '' },
        { actor: 'B', action: 'spell', rollNeeded: true, rollType: 'save' as any, target: '', weapon: '' },
        { actor: 'C', action: 'damage', rollNeeded: true, rollType: 'damage' as any, target: '', weapon: '' }
      ];
      const result = getDiceRollRequirements(actions);
      expect(result).toEqual({
        attackRolls: 1,
        damageRolls: 2, // 1 from attack + 1 from damage action
        savingThrows: 1,
        skillChecks: 0
      });
    });
  });
});
