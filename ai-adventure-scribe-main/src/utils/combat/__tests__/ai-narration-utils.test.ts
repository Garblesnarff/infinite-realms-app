/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';

import {
  shouldTriggerDMNarration,
  formatCombatEventForDM,
  combatActionPrompts,
} from '../ai-narration-utils';

import type { CombatEvent } from '@/types/combat';

describe('ai-narration-utils', () => {
  describe('shouldTriggerDMNarration', () => {
    it('should return true for narrative events', () => {
      const events: CombatEvent['type'][] = [
        'COMBAT_START',
        'COMBAT_END',
        'ROUND_START',
        'ACTION_TAKEN',
        'PARTICIPANT_UNCONSCIOUS',
        'PARTICIPANT_DEAD',
      ];

      events.forEach((type) => {
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
      expect(formatCombatEventForDM({ type: 'COMBAT_START' } as any)).toContain('Combat has begun');
    });

    it('should format COMBAT_END', () => {
      expect(formatCombatEventForDM({ type: 'COMBAT_END' } as any)).toContain('Combat has ended');
    });

    it('should format ROUND_START', () => {
      expect(formatCombatEventForDM({ type: 'ROUND_START', roundNumber: 2 } as any)).toContain(
        'Round 2',
      );
    });

    it('should format ACTION_TAKEN with action description', () => {
      const event = {
        type: 'ACTION_TAKEN',
        action: { description: 'Aragorn hits Goblin' },
      };
      expect(formatCombatEventForDM(event as any)).toContain('Aragorn hits Goblin');
    });

    it('should format ACTION_TAKEN without action description', () => {
      expect(formatCombatEventForDM({ type: 'ACTION_TAKEN' } as any)).toContain(
        'An action was taken',
      );
    });

    it('should format PARTICIPANT_UNCONSCIOUS', () => {
      expect(formatCombatEventForDM({ type: 'PARTICIPANT_UNCONSCIOUS' } as any)).toContain(
        'fallen unconscious',
      );
    });

    it('should format PARTICIPANT_DEAD', () => {
      expect(formatCombatEventForDM({ type: 'PARTICIPANT_DEAD' } as any)).toContain('has died');
    });

    it('should return default message for unknown event', () => {
      expect(formatCombatEventForDM({ type: 'TURN_START' } as any)).toContain(
        'Something significant happened',
      );
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
