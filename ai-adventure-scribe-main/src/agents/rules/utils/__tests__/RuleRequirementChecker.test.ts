/* eslint-disable max-lines */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { logger } from '../../../../lib/logger';
import { RuleRequirementChecker } from '../RuleRequirementChecker';

import type { RuleRequirement } from '@/types/agent';

vi.mock('../../../../lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('RuleRequirementChecker', () => {
  let checker: RuleRequirementChecker;

  beforeEach(() => {
    checker = new RuleRequirementChecker();
    vi.clearAllMocks();
  });

  it('should return true if requirement is null or undefined', async () => {
    expect(await checker.check(null as unknown as RuleRequirement)).toBe(true);
    expect(await checker.check(undefined as unknown as RuleRequirement)).toBe(true);
  });

  describe('prerequisite', () => {
    it('should return true if all prerequisites are met', async () => {
      const requirement: RuleRequirement = {
        type: 'prerequisite',
        data: {
          prerequisites: [
            { type: 'feature', value: 'Rage' },
            { type: 'spell', value: 'Fireball' },
            { type: 'proficiency', value: 'Athletics' },
          ],
        },
        description: 'Prerequisite check',
        context: {
          character: {
            features: ['Rage', 'Unarmored Defense'],
            spells: ['Fireball', 'Magic Missile'],
            proficiencies: ['Athletics', 'Perception'],
          },
        },
      };
      expect(await checker.check(requirement as RuleRequirement)).toBe(true);
    });

    it('should return false if any prerequisite is missing', async () => {
      const requirement: RuleRequirement = {
        type: 'prerequisite',
        data: {
          prerequisites: [
            { type: 'feature', value: 'Rage' },
            { type: 'feature', value: 'Action Surge' },
          ],
        },
        description: 'Prerequisite check',
        context: {
          character: {
            features: ['Rage'],
          },
        },
      };
      expect(await checker.check(requirement as RuleRequirement)).toBe(false);
    });

    it('should return false if character or prerequisites are missing in context/data', async () => {
      const requirement: RuleRequirement = {
        type: 'prerequisite',
        data: {},
        description: 'Prerequisite check',
        context: {},
      };
      expect(await checker.check(requirement as RuleRequirement)).toBe(false);
    });

    it('should return false for unknown prerequisite types', async () => {
        const requirement: RuleRequirement = {
          type: 'prerequisite',
          data: {
            prerequisites: [
              { type: 'unknown', value: 'something' },
            ],
          },
          description: 'Prerequisite check',
          context: {
            character: {}
          },
        };
        expect(await checker.check(requirement as RuleRequirement)).toBe(false);
      });
  });

  describe('proficiency', () => {
    it('should return true if all required proficiencies are present', async () => {
      const requirement: RuleRequirement = {
        type: 'proficiency',
        data: { requiredProficiencies: ['Stealth', 'Thieves Tools'] },
        description: 'Proficiency check',
        context: {
          character: {
            proficiencies: ['Stealth', 'Thieves Tools', 'Perception'],
          },
        },
      };
      expect(await checker.check(requirement as RuleRequirement)).toBe(true);
    });

    it('should return false if any required proficiency is missing', async () => {
      const requirement: RuleRequirement = {
        type: 'proficiency',
        data: { requiredProficiencies: ['Stealth', 'Thieves Tools'] },
        description: 'Proficiency check',
        context: {
          character: {
            proficiencies: ['Stealth'],
          },
        },
      };
      expect(await checker.check(requirement as RuleRequirement)).toBe(false);
    });
  });

  describe('spell_slot', () => {
    it('should return true if enough spell slots are available', async () => {
      const requirement: RuleRequirement = {
        type: 'spell_slot',
        data: { level: 3, count: 1 },
        description: 'Spell slot check',
        context: {
          spellSlots: { 3: 2 },
        },
      };
      expect(await checker.check(requirement as RuleRequirement)).toBe(true);
    });

    it('should return false if not enough spell slots are available', async () => {
      const requirement: RuleRequirement = {
        type: 'spell_slot',
        data: { level: 3, count: 1 },
        description: 'Spell slot check',
        context: {
          spellSlots: { 3: 0 },
        },
      };
      expect(await checker.check(requirement as RuleRequirement)).toBe(false);
    });

    it('should return false if level is missing in spellSlots context', async () => {
        const requirement: RuleRequirement = {
          type: 'spell_slot',
          data: { level: 1, count: 1 },
          description: 'Spell slot check',
          context: {
            spellSlots: {},
          },
        };
        expect(await checker.check(requirement as RuleRequirement)).toBe(false);
      });
  });

  describe('action_economy', () => {
    it('should return true if enough actions are available', async () => {
      const requirement: RuleRequirement = {
        type: 'action_economy',
        data: { actionType: 'bonus_action', cost: 1 },
        description: 'Action economy check',
        context: {
          actions: { bonus_action: 1 },
        },
      };
      expect(await checker.check(requirement as RuleRequirement)).toBe(true);
    });

    it('should return false if not enough actions are available', async () => {
      const requirement: RuleRequirement = {
        type: 'action_economy',
        data: { actionType: 'action', cost: 1 },
        description: 'Action economy check',
        context: {
          actions: { action: 0 },
        },
      };
      expect(await checker.check(requirement as RuleRequirement)).toBe(false);
    });
  });

  describe('component', () => {
    it('should return true if material component with cost is present and enough value', async () => {
      const requirement: RuleRequirement = {
        type: 'component',
        data: {
          components: [{ type: 'material', name: 'Diamond', cost: 300 }],
        },
        description: 'Component check',
        context: {
          components: [{ name: 'Diamond', type: 'material', value: 500 }],
        },
      };
      expect(await checker.check(requirement as RuleRequirement)).toBe(true);
    });

    it('should return false if material component with cost is present but not enough value', async () => {
        const requirement: RuleRequirement = {
          type: 'component',
          data: {
            components: [{ type: 'material', name: 'Diamond', cost: 300 }],
          },
          description: 'Component check',
          context: {
            components: [{ name: 'Diamond', type: 'material', value: 200 }],
          },
        };
        expect(await checker.check(requirement as RuleRequirement)).toBe(false);
      });

    it('should return true if non-material component is present', async () => {
      const requirement: RuleRequirement = {
        type: 'component',
        data: {
          components: [{ type: 'somatic', name: 'Free Hand' }],
        },
        description: 'Component check',
        context: {
          components: [{ name: 'Free Hand', type: 'somatic' }],
        },
      };
      expect(await checker.check(requirement as RuleRequirement)).toBe(true);
    });

    it('should return false if component is missing', async () => {
      const requirement: RuleRequirement = {
        type: 'component',
        data: {
          components: [{ type: 'material', name: 'Ruby' }],
        },
        description: 'Component check',
        context: {
          components: [{ name: 'Diamond', type: 'material' }],
        },
      };
      expect(await checker.check(requirement as RuleRequirement)).toBe(false);
    });
  });

  it('should log a warning and return true for unknown requirement types', async () => {
    const requirement: unknown = {
      type: 'unknown_type',
      description: 'Unknown check',
    };
    expect(await checker.check(requirement as RuleRequirement)).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith('Unknown requirement type: unknown_type');
  });
});
