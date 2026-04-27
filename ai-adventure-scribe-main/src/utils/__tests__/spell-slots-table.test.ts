import { describe, it, expect } from 'vitest';
import { fullCasterProgression } from '../spell-slots-table';

describe('spell-slots-table', () => {
  it('should have 20 levels of progression', () => {
    expect(Object.keys(fullCasterProgression)).toHaveLength(20);
  });

  it('should provide correct slots for level 1 (2 1st-level)', () => {
    expect(fullCasterProgression[1]).toEqual({ 1: 2 });
  });

  it('should provide correct slots for level 3 (4 1st-level, 2 2nd-level)', () => {
    expect(fullCasterProgression[3]).toEqual({ 1: 4, 2: 2 });
  });

  it('should provide correct slots for level 5 (4 1st, 3 2nd, 2 3rd)', () => {
    expect(fullCasterProgression[5]).toEqual({ 1: 4, 2: 3, 3: 2 });
  });

  it('should provide correct slots for level 11 (4 1st, 3 2nd, 3 3rd, 3 4th, 2 5th, 1 6th)', () => {
    expect(fullCasterProgression[11]).toEqual({ 1: 4, 2: 3, 3: 3, 4: 3, 5: 2, 6: 1 });
  });

  it('should provide correct slots for level 17 (9th level slots)', () => {
    expect(fullCasterProgression[17][9]).toBe(1);
  });

  it('should provide correct slots for level 20', () => {
    expect(fullCasterProgression[20]).toEqual({
      1: 4,
      2: 3,
      3: 3,
      4: 3,
      5: 3,
      6: 2,
      7: 2,
      8: 1,
      9: 1,
    });
  });

  it('should not have slots above 9th level', () => {
    Object.values(fullCasterProgression).forEach(levelSlots => {
      const levels = Object.keys(levelSlots).map(Number);
      expect(Math.max(...levels)).toBeLessThanOrEqual(9);
    });
  });
});
