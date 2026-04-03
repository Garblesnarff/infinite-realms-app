/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';

import {
  getDamageRollForWeapon,
  createActionDescription,
  shouldTriggerDMNarration,
  formatCombatEventForDM,
  combatActionPrompts
} from '../ai-narration-utils';

import type { CombatEvent } from '@/types/combat';
import type { DetectedCombatAction } from '@/utils/combatDetection';
import type { DiceRoll } from '@/utils/diceUtils';

describe('ai-narration-utils', () => {
  describe('getDamageRollForWeapon', () => {
    it('should return correct damage for sword', () => {
      expect(getDamageRollForWeapon('sword')).toEqual({ dice: 8, count: 1, modifier: 3 });
    });

    it('should return correct damage for dagger', () => {
      expect(getDamageRollForWeapon('dagger')).toEqual({ dice: 4, count: 1, modifier: 3 });
    });

    it('should be case insensitive', () => {
      expect(getDamageRollForWeapon('SWORD')).toEqual({ dice: 8, count: 1, modifier: 3 });
    });

    it('should return fallback for unknown weapon', () => {
      expect(getDamageRollForWeapon('spoon')).toEqual({ dice: 6, count: 1, modifier: 2 });
    });
  });

  describe('createActionDescription', () => {
    const mockRoll: DiceRoll = {
      dieType: 20,
      count: 1,
      modifier: 5,
      results: [15],
      keptResults: [15],
      total: 20,
      naturalRoll: 15
    };

    it('should format attack hit', () => {
      const action: DetectedCombatAction = {
        actor: 'Aragorn',
        action: 'attack',
        target: 'Goblin',
        weapon: 'sword',
        rollNeeded: true,
        rollType: 'attack'
      };
      expect(createActionDescription(action, mockRoll, true)).toBe('Aragorn hits against Goblin with sword');
    });

    it('should format attack miss', () => {
      const action: DetectedCombatAction = {
        actor: 'Aragorn',
        action: 'attack',
        target: 'Goblin',
        weapon: 'sword',
        rollNeeded: true,
        rollType: 'attack'
      };
      expect(createActionDescription(action, mockRoll, false)).toBe('Aragorn misses against Goblin with sword');
    });

    it('should format critical hit', () => {
      const action: DetectedCombatAction = {
        actor: 'Aragorn',
        action: 'attack',
        target: 'Goblin',
        weapon: 'sword',
        rollNeeded: true,
        rollType: 'attack'
      };
      expect(createActionDescription(action, mockRoll, true, true)).toBe('Aragorn scores a critical hit against Goblin with sword!');
    });

    it('should format damage action', () => {
      const action: DetectedCombatAction = {
        actor: 'Aragorn',
        action: 'damage',
        target: 'Goblin',
        weapon: 'sword',
        rollNeeded: false,
        rollType: 'damage'
      };
      expect(createActionDescription(action, mockRoll)).toBe('Aragorn deals damage against Goblin with sword');
    });

    it('should format save action', () => {
      const action: DetectedCombatAction = {
        actor: 'Aragorn',
        action: 'save',
        rollNeeded: true,
        rollType: 'save'
      };
      expect(createActionDescription(action, mockRoll)).toBe('Aragorn makes a saving throw');
    });

    it('should format skill check', () => {
      const action: DetectedCombatAction = {
        actor: 'Aragorn',
        action: 'skill',
        rollNeeded: true,
        rollType: 'skill'
      };
      expect(createActionDescription(action, mockRoll)).toBe('Aragorn attempts a skill check');
    });

    it('should use default format for unknown rollType', () => {
      const action: DetectedCombatAction = {
        actor: 'Aragorn',
        action: 'jump',
        rollNeeded: true,
        rollType: 'other' as any
      };
      expect(createActionDescription(action, mockRoll)).toBe('Aragorn performs jump');
    });
  });

  describe('shouldTriggerDMNarration', () => {
    it('should return true for narrative events', () => {
      const events: CombatEvent['type'][] = [
        'COMBAT_START',
        'COMBAT_END',
        'ROUND_START',
        'ACTION_TAKEN',
        'PARTICIPANT_UNCONSCIOUS',
        'PARTICIPANT_DEAD'
      ];

      events.forEach(type => {
        expect(shouldTriggerDMNarration({ type } as any, {})).toBe(true);
      });
    });

    it('should return false for non-narrative events', () => {
      expect(shouldTriggerDMNarration({ type: 'TURN_START' } as any, {})).toBe(false);
      expect(shouldTriggerDMNarration({ type: 'INITIATIVE_ROLLED' } as any, {})).toBe(false);
    });
  });

  describe('formatCombatEventForDM', () => {
    it('should format COMBAT_START', () => {
      expect(formatCombatEventForDM({ type: 'COMBAT_START' } as any))
        .toContain('Combat has begun');
    });

    it('should format COMBAT_END', () => {
      expect(formatCombatEventForDM({ type: 'COMBAT_END' } as any))
        .toContain('Combat has ended');
    });

    it('should format ROUND_START', () => {
      expect(formatCombatEventForDM({ type: 'ROUND_START', roundNumber: 2 } as any))
        .toContain('Round 2');
    });

    it('should format ACTION_TAKEN with action description', () => {
      const event = {
        type: 'ACTION_TAKEN',
        action: { description: 'Aragorn hits Goblin' }
      };
      expect(formatCombatEventForDM(event as any)).toContain('Aragorn hits Goblin');
    });

    it('should format ACTION_TAKEN without action description', () => {
      expect(formatCombatEventForDM({ type: 'ACTION_TAKEN' } as any))
        .toContain('An action was taken');
    });

    it('should format PARTICIPANT_UNCONSCIOUS', () => {
      expect(formatCombatEventForDM({ type: 'PARTICIPANT_UNCONSCIOUS' } as any))
        .toContain('fallen unconscious');
    });

    it('should format PARTICIPANT_DEAD', () => {
      expect(formatCombatEventForDM({ type: 'PARTICIPANT_DEAD' } as any))
        .toContain('has died');
    });

    it('should return default message for unknown event', () => {
      expect(formatCombatEventForDM({ type: 'TURN_START' } as any))
        .toContain('Something significant happened');
    });
  });

  describe('combatActionPrompts', () => {
    it('should contain prompts for basic actions', () => {
      expect(combatActionPrompts.attack).toBeDefined();
      expect(combatActionPrompts.cast_spell).toBeDefined();
      expect(combatActionPrompts.dash).toBeDefined();
    });

    it('should contain prompts for special actions', () => {
      expect(combatActionPrompts.divine_smite).toBeDefined();
      expect(combatActionPrompts.use_racial_trait).toBeDefined();
    });
  });
});
