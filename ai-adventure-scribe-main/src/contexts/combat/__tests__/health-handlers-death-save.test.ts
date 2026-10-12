import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createHealthHandlers } from '../health-handlers';

import type { CombatState } from '@/types/combat';

const d20 = vi.fn<() => number>();
vi.mock('@/utils/diceRolls', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  d20: () => d20(),
}));

// #452: the death-save result compared the DiceRoll object to numbers, so every save was 'failure'.
const downed = {
  id: 'pc-1',
  name: 'Tess',
  currentHitPoints: 0,
  maxHitPoints: 12,
  temporaryHitPoints: 0,
  deathSaves: { successes: 0, failures: 0 },
  isUnconscious: true,
  isStable: false,
  isDead: false,
};

function setup() {
  const dispatch = vi.fn();
  const state = { activeEncounter: { participants: [downed] } } as unknown as CombatState;
  return { dispatch, handlers: createHealthHandlers(dispatch, () => state) };
}

describe('rollDeathSave result (#452)', () => {
  beforeEach(() => d20.mockReset());

  it('natural 20 is critical and regains 1 HP', async () => {
    d20.mockReturnValue(20);
    const { dispatch, handlers } = setup();
    await expect(handlers.rollDeathSave('pc-1')).resolves.toBe('critical');
    expect(dispatch.mock.calls[0][0].updates).toMatchObject({
      currentHitPoints: 1,
      isUnconscious: false,
    });
  });

  it('natural 1 is a failure that counts as two failures', async () => {
    d20.mockReturnValue(1);
    const { dispatch, handlers } = setup();
    await expect(handlers.rollDeathSave('pc-1')).resolves.toBe('failure');
    expect(dispatch.mock.calls[0][0].updates.deathSaves).toEqual({ successes: 0, failures: 2 });
  });

  it('10 or more is a success', async () => {
    d20.mockReturnValue(12);
    const { handlers } = setup();
    await expect(handlers.rollDeathSave('pc-1')).resolves.toBe('success');
  });
});
