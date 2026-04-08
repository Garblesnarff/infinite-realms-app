import { describe, it, expect } from 'vitest';

import {
  getSortedConditions,
  getPrimaryCondition,
  getConditionIcon,
  getExhaustionLevel,
  formatExhaustionDescription,
  shouldConditionPulse,
  getConditionBorderColor,
  CONDITION_ICONS,
} from '../condition-icons';

import type { ConditionName } from '@/types/combat';

describe('condition-icons', () => {
  describe('getSortedConditions', () => {
    it('should sort conditions by priority', () => {
      const conditions: ConditionName[] = ['blinded', 'unconscious', 'paralyzed'];
      // Priorities: blinded (5), unconscious (0), paralyzed (1)
      const sorted = getSortedConditions(conditions);
      expect(sorted).toEqual(['unconscious', 'paralyzed', 'blinded']);
    });

    it('should handle empty array', () => {
      expect(getSortedConditions([])).toEqual([]);
    });

    it('should handle unknown conditions by putting them at the end', () => {
      const conditions = ['blinded', 'unknown'] as ConditionName[];
      const sorted = getSortedConditions(conditions);
      expect(sorted).toEqual(['blinded', 'unknown']);
    });
  });

  describe('getPrimaryCondition', () => {
    it('should return the condition with the lowest priority number', () => {
      const conditions: ConditionName[] = ['poisoned', 'stunned', 'prone'];
      // Priorities: poisoned (5), stunned (2), prone (6)
      expect(getPrimaryCondition(conditions)).toBe('stunned');
    });

    it('should return null for empty array', () => {
      expect(getPrimaryCondition([])).toBeNull();
    });
  });

  describe('getConditionIcon', () => {
    it('should return the config for a valid condition', () => {
      const config = getConditionIcon('blinded');
      expect(config).toBe(CONDITION_ICONS.blinded);
      expect(config?.priority).toBe(5);
    });

    it('should return null for an invalid condition', () => {
      expect(getConditionIcon('invalid' as ConditionName)).toBeNull();
    });
  });

  describe('getExhaustionLevel', () => {
    it('should return the level from the exhaustion condition', () => {
      const conditions = [
        { name: 'blinded' as ConditionName },
        { name: 'exhaustion' as ConditionName, level: 3 },
      ];
      expect(getExhaustionLevel(conditions)).toBe(3);
    });

    it('should return 0 if exhaustion condition is missing', () => {
      const conditions = [{ name: 'blinded' as ConditionName }];
      expect(getExhaustionLevel(conditions)).toBe(0);
    });

    it('should return 0 if level is missing in exhaustion condition', () => {
      const conditions = [{ name: 'exhaustion' as ConditionName }];
      expect(getExhaustionLevel(conditions)).toBe(0);
    });
  });

  describe('formatExhaustionDescription', () => {
    it('should return the correct description for each level', () => {
      expect(formatExhaustionDescription(1)).toContain('Disadvantage on ability checks');
      expect(formatExhaustionDescription(2)).toContain('Speed halved');
      expect(formatExhaustionDescription(6)).toContain('Death');
    });

    it('should return "Unknown" for out of range levels', () => {
      expect(formatExhaustionDescription(7)).toContain('Unknown');
      expect(formatExhaustionDescription(-1)).toContain('Unknown');
    });

    it('should return "No effect" for level 0', () => {
      expect(formatExhaustionDescription(0)).toContain('No effect');
    });
  });

  describe('shouldConditionPulse', () => {
    it('should return true for high-priority conditions', () => {
      expect(shouldConditionPulse('unconscious')).toBe(true);
      expect(shouldConditionPulse('stunned')).toBe(true);
      expect(shouldConditionPulse('paralyzed')).toBe(true);
    });

    it('should return false for less severe conditions', () => {
      expect(shouldConditionPulse('blinded')).toBe(false);
      expect(shouldConditionPulse('poisoned')).toBe(false);
    });
  });

  describe('getConditionBorderColor', () => {
    it('should return the background color of the primary condition', () => {
      const conditions: ConditionName[] = ['blinded', 'unconscious'];
      // unconscious is primary (priority 0)
      const color = getConditionBorderColor(conditions);
      expect(color).toBe(CONDITION_ICONS.unconscious.backgroundColor);
    });

    it('should return null for empty array', () => {
      expect(getConditionBorderColor([])).toBeNull();
    });

    it('should return null if primary condition has no config', () => {
      expect(getConditionBorderColor(['unknown' as ConditionName])).toBeNull();
    });
  });
});
