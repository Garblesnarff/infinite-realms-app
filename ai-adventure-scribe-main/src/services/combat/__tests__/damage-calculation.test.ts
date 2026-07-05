import { describe, it, expect, vi } from 'vitest';
import { calculateModifiedDamage } from '../damage-calculation';
import logger from '@/lib/logger';

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('calculateModifiedDamage', () => {
  it('should return base damage when no modifiers apply', () => {
    const result = calculateModifiedDamage(10, 'fire', [], [], []);
    expect(result).toBe(10);
  });

  it('should return 0 when damage type is immune', () => {
    const result = calculateModifiedDamage(10, 'fire', [], ['fire'], []);
    expect(result).toBe(0);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('immune - 0 damage'));
  });

  it('should half damage (rounded down) when damage type is resisted', () => {
    // 11 / 2 = 5.5 -> 5
    const result = calculateModifiedDamage(11, 'cold', ['cold'], [], []);
    expect(result).toBe(5);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('is resisted - 11 → 5'));
  });

  it('should double damage when damage type is vulnerable', () => {
    const result = calculateModifiedDamage(10, 'acid', [], [], ['acid']);
    expect(result).toBe(20);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('is vulnerable - 10 → 20'));
  });

  it('should apply BOTH resistance and vulnerability (resistance first)', () => {
    // D&D 5e rule: resistance then vulnerability
    // 11 damage -> Resistance (floor(11/2)=5) -> Vulnerability (5*2=10)
    const result = calculateModifiedDamage(11, 'necrotic', ['necrotic'], [], ['necrotic']);
    expect(result).toBe(10);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('is resisted - 11 → 5'));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('is vulnerable - 5 → 10'));
  });

  it('should prioritize immunity over resistance and vulnerability', () => {
    const result = calculateModifiedDamage(10, 'radiant', ['radiant'], ['radiant'], ['radiant']);
    expect(result).toBe(0);
  });

  it('should handle 0 base damage', () => {
    const result = calculateModifiedDamage(0, 'force', [], [], []);
    expect(result).toBe(0);
  });

  it('should handle multiple types in modifier arrays but only apply to the relevant type', () => {
    const result = calculateModifiedDamage(10, 'fire', ['cold', 'fire'], [], ['acid']);
    expect(result).toBe(5);
  });
});
