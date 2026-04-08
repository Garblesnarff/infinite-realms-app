/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';

import { recoverExhaustion } from '../exhaustion';

describe('exhaustion recovery', () => {
  it('should return character as is if no conditions', () => {
    const character: any = { name: 'Bob' };
    expect(recoverExhaustion(character)).toEqual(character);
  });

  it('should return character as is if no exhaustion', () => {
    const character: any = {
      conditions: [{ name: 'blinded' }]
    };
    expect(recoverExhaustion(character)).toEqual(character);
  });

  it('should reduce exhaustion level by 1 on long rest with food/water', () => {
    const character: any = {
      conditions: [{ name: 'exhaustion', level: 2 }]
    };
    const updated = recoverExhaustion(character, true);
    expect(updated.conditions[0].level).toBe(1);
  });

  it('should remove exhaustion if it drops to 0', () => {
    const character: any = {
      conditions: [{ name: 'exhaustion', level: 1 }]
    };
    const updated = recoverExhaustion(character, true);
    expect(updated.conditions.find(c => c.name === 'exhaustion')).toBeUndefined();
  });

  it('should not reduce exhaustion without food/water', () => {
    const character: any = {
      conditions: [{ name: 'exhaustion', level: 2 }]
    };
    const updated = recoverExhaustion(character, false);
    expect(updated.conditions[0].level).toBe(2);
  });

  it('should handle exhaustion level being undefined', () => {
     const character: any = {
      conditions: [{ name: 'exhaustion' }]
    };
    const updated = recoverExhaustion(character, true);
    expect(updated.conditions.find(c => c.name === 'exhaustion')).toBeUndefined();
  });
});
