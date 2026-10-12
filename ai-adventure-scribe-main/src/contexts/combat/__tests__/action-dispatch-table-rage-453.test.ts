import { describe, expect, it, vi } from 'vitest';

vi.mock('../action-handlers', () => ({
  handleSpellCast: vi.fn(),
  handleDivineSmite: vi.fn(),
  handleRageActivation: vi.fn(() => ({ rage: true })),
  handleRageDeactivation: vi.fn(),
  handleShortRest: vi.fn(),
  handleLongRest: vi.fn(),
  handleHideAction: vi.fn(),
}));

import { actionDispatchTable } from '../action-dispatch-table';
import { handleRageActivation } from '../action-handlers';

import type { CombatParticipant } from '@/types/combat';

const barbarian = { id: 'p1', name: 'Grok', participantType: 'player' } as CombatParticipant;

describe('actionDispatchTable use_class_feature (#453)', () => {
  it('activates Rage when featureUsed is rage (the shape use-combat-mechanics sends)', () => {
    const action = {
      participantId: 'p1',
      actionType: 'use_class_feature' as const,
      description: 'x',
      featureUsed: 'rage',
    };
    expect(actionDispatchTable.use_class_feature(action, barbarian)).toEqual({ rage: true });
    expect(handleRageActivation).toHaveBeenCalledWith(action, barbarian);
  });

  it('does nothing for other features', () => {
    vi.mocked(handleRageActivation).mockClear();
    expect(
      actionDispatchTable.use_class_feature({ featureUsed: 'second_wind' }, barbarian),
    ).toBeUndefined();
    expect(handleRageActivation).not.toHaveBeenCalled();
  });
});
