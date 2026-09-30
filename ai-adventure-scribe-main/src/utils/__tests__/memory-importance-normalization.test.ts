import { describe, it, expect } from 'vitest';

import { processContent } from '../memory/classification';

describe('Memory Importance Scale (1-10, #2283)', () => {
  it('should keep importance scores in the 1-10 range', () => {
    // Test content that would normally generate high importance scores
    const content = `
      Title: The Epic Quest of Golden Dragon
      Players: Sir Reginald the Brave, Lady Eleanor the Wise
      Location: Castle Dreadmoor, Forgotten Kingdom
      Quest: Recover the legendary Golden Dragon artifact from the ancient tomb
      Danger: The undead guardians and deadly traps protect the treasure
      Mission: This critical quest will determine the fate of the entire realm
      campaign Quest danger threat kingdom artifact tomb undead deadly critical
    `;

    const segments = processContent(content);

    // All segments should have importance in the 1-10 range
    segments.forEach((segment) => {
      expect(segment.importance).toBeGreaterThanOrEqual(1);
      expect(segment.importance).toBeLessThanOrEqual(10);
    });
  });

  it('should handle empty content gracefully', () => {
    const segments = processContent('');
    expect(segments).toEqual([]);
  });

  it('should preserve memory types while scoring importance', () => {
    const content = 'The brave knight Sir Reginald entered the dark cave.';
    const segments = processContent(content);

    expect(segments.length).toBeGreaterThan(0);
    segments.forEach((segment) => {
      expect(typeof segment.type).toBe('string');
      expect(segment.content).toBeTruthy();
      expect(segment.importance).toBeGreaterThanOrEqual(1);
      expect(segment.importance).toBeLessThanOrEqual(10);
    });
  });

  it('should assign higher importance to content with critical keywords', () => {
    // Content with lots of keywords that should trigger higher importance
    const content = `
      CRITICAL QUEST: The golden kingdom is in grave DANGER!
      MISSION DEFEND the realm from the deadly undead threat.
      This CAMPAIGN involves the legendary artifact quest.
      Castle under siege requires immediate ACTION to save kingdom.
    `;

    const segments = processContent(content);

    // At least one segment should have importance >= 7: the 1-10 value that the old
    // Math.round(x / 2) halving mapped to 4, so this is the same threshold on the new scale.
    const hasHighImportance = segments.some((segment) => segment.importance >= 7);
    expect(hasHighImportance).toBe(true);

    // All segments should still be in the 1-10 range
    segments.forEach((segment) => {
      expect(segment.importance).toBeGreaterThanOrEqual(1);
      expect(segment.importance).toBeLessThanOrEqual(10);
    });
  });
});
