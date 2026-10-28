import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { expandRolls, simulateTrayAsync } from '../PhysicsDiceBox';

import type { DiceRollResult } from '@/services/dice/DiceEngine';

vi.mock('howler', () => ({
  Howl: vi.fn(),
}));

describe('shared dice physics budget', () => {
  beforeAll(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
  });

  afterAll(() => vi.restoreAllMocks());

  it('keeps every 12-die simulation slice below the 50ms UI budget', async () => {
    const result = {
      expression: '12d6',
      total: 42,
      rolls: Array.from({ length: 12 }, (_, index) => ({
        dice: 6,
        value: (index % 6) + 1,
        sign: 1 as const,
        critical: false,
      })),
      modifiers: 0,
      advantage: false,
      disadvantage: false,
      critical: false,
      naturalRoll: 3,
      timestamp: 1,
    } as DiceRollResult;
    const slices: number[] = [];

    const simulation = await simulateTrayAsync(expandRolls(result), (durationMs) => {
      slices.push(durationMs);
    });

    expect(simulation.frames.length).toBeGreaterThan(0);
    expect(slices.length).toBeGreaterThan(0);
    expect(Math.max(...slices)).toBeLessThan(50);
  });
});
