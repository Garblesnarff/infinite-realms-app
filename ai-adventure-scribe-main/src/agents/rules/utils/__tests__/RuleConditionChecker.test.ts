/* eslint-disable max-lines */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { logger } from '../../../../lib/logger';
import { RuleConditionChecker } from '../RuleConditionChecker';

import type { RuleCondition } from '@/types/agent';

vi.mock('../../../../lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('RuleConditionChecker', () => {
  let checker: RuleConditionChecker;

  beforeEach(() => {
    checker = new RuleConditionChecker();
    vi.clearAllMocks();
  });

  it('should return true if condition is null or undefined', async () => {
    expect(await checker.check(null as unknown as RuleCondition)).toBe(true);
    expect(await checker.check(undefined as unknown as RuleCondition)).toBe(true);
  });

  describe('ability_score', () => {
    it('should return true if score is within range', async () => {
      const condition: RuleCondition = {
        type: 'ability_score',
        data: { ability: 'strength', minimum: 10, maximum: 15 },
        description: 'Strength check',
        context: {
          abilityScores: {
            strength: { score: 12 },
          },
        },
      };
      expect(await checker.check(condition as RuleCondition)).toBe(true);
    });

    it('should return false if score is below minimum', async () => {
      const condition: RuleCondition = {
        type: 'ability_score',
        data: { ability: 'strength', minimum: 10 },
        description: 'Strength check',
        context: {
          abilityScores: {
            strength: { score: 8 },
          },
        },
      };
      expect(await checker.check(condition as RuleCondition)).toBe(false);
    });

    it('should return false if score is above maximum', async () => {
      const condition: RuleCondition = {
        type: 'ability_score',
        data: { ability: 'strength', maximum: 10 },
        description: 'Strength check',
        context: {
          abilityScores: {
            strength: { score: 12 },
          },
        },
      };
      expect(await checker.check(condition as RuleCondition)).toBe(false);
    });

    it('should return false if ability score is missing in context', async () => {
      const condition: RuleCondition = {
        type: 'ability_score',
        data: { ability: 'strength', minimum: 10 },
        description: 'Strength check',
        context: {
          abilityScores: {},
        },
      };
      expect(await checker.check(condition as RuleCondition)).toBe(false);
    });
  });

  describe('class_requirement', () => {
    it('should return true if class matches', async () => {
      const condition: RuleCondition = {
        type: 'class_requirement',
        data: { requiredClass: 'Fighter' },
        description: 'Class check',
        context: { class: 'Fighter' },
      };
      expect(await checker.check(condition as RuleCondition)).toBe(true);
    });

    it('should return false if class does not match', async () => {
      const condition: RuleCondition = {
        type: 'class_requirement',
        data: { requiredClass: 'Fighter' },
        description: 'Class check',
        context: { class: 'Wizard' },
      };
      expect(await checker.check(condition as RuleCondition)).toBe(false);
    });
  });

  describe('race_requirement', () => {
    it('should return true if race matches', async () => {
      const condition: RuleCondition = {
        type: 'race_requirement',
        data: { requiredRace: 'Elf' },
        description: 'Race check',
        context: { race: 'Elf' },
      };
      expect(await checker.check(condition as RuleCondition)).toBe(true);
    });

    it('should return false if race does not match', async () => {
      const condition: RuleCondition = {
        type: 'race_requirement',
        data: { requiredRace: 'Elf' },
        description: 'Race check',
        context: { race: 'Dwarf' },
      };
      expect(await checker.check(condition as RuleCondition)).toBe(false);
    });
  });

  describe('level_requirement', () => {
    it('should return true if level is at or above minimum', async () => {
      const condition: RuleCondition = {
        type: 'level_requirement',
        data: { minimumLevel: 5 },
        description: 'Level check',
        context: { level: 5 },
      };
      expect(await checker.check(condition as RuleCondition)).toBe(true);
    });

    it('should return false if level is below minimum', async () => {
      const condition: RuleCondition = {
        type: 'level_requirement',
        data: { minimumLevel: 5 },
        description: 'Level check',
        context: { level: 4 },
      };
      expect(await checker.check(condition as RuleCondition)).toBe(false);
    });

    it('should use default level 1 if missing in context', async () => {
      const condition: RuleCondition = {
        type: 'level_requirement',
        data: { minimumLevel: 2 },
        description: 'Level check',
        context: {},
      };
      expect(await checker.check(condition as RuleCondition)).toBe(false);
    });
  });

  describe('equipment_requirement', () => {
    it('should return true if all required items are present', async () => {
      const condition: RuleCondition = {
        type: 'equipment_requirement',
        data: { requiredItems: ['Sword', 'Shield'] },
        description: 'Equipment check',
        context: { equipment: ['Sword', 'Shield', 'Armor'] },
      };
      expect(await checker.check(condition as RuleCondition)).toBe(true);
    });

    it('should return false if any required item is missing', async () => {
      const condition: RuleCondition = {
        type: 'equipment_requirement',
        data: { requiredItems: ['Sword', 'Shield'] },
        description: 'Equipment check',
        context: { equipment: ['Sword', 'Armor'] },
      };
      expect(await checker.check(condition as RuleCondition)).toBe(false);
    });

    it('should return false if equipment is missing in context', async () => {
      const condition: RuleCondition = {
        type: 'equipment_requirement',
        data: { requiredItems: ['Sword'] },
        description: 'Equipment check',
        context: {},
      };
      expect(await checker.check(condition as RuleCondition)).toBe(false);
    });
  });

  describe('resource_requirement', () => {
    it('should return true if enough resource is available', async () => {
      const condition: RuleCondition = {
        type: 'resource_requirement',
        data: { resource: 'Ki', minimum: 2 },
        description: 'Resource check',
        context: { resources: { Ki: 3 } },
      };
      expect(await checker.check(condition as RuleCondition)).toBe(true);
    });

    it('should return false if not enough resource is available', async () => {
      const condition: RuleCondition = {
        type: 'resource_requirement',
        data: { resource: 'Ki', minimum: 2 },
        description: 'Resource check',
        context: { resources: { Ki: 1 } },
      };
      expect(await checker.check(condition as RuleCondition)).toBe(false);
    });

    it('should return false if resource is missing in context', async () => {
      const condition: RuleCondition = {
        type: 'resource_requirement',
        data: { resource: 'Ki', minimum: 1 },
        description: 'Resource check',
        context: { resources: {} },
      };
      expect(await checker.check(condition as RuleCondition)).toBe(false);
    });
  });

  it('should log a warning and return true for unknown condition types', async () => {
    const condition: unknown = {
      type: 'unknown_type',
      description: 'Unknown check',
    };
    expect(await checker.check(condition as RuleCondition)).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith('Unknown condition type: unknown_type');
  });
});
