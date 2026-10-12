import { describe, expect, it, vi } from 'vitest';

vi.mock('../action-handlers', async (importOriginal) => {
  const actual = await importOriginal<typeof ActionHandlers>();
  return { ...actual, handleRageActivation: vi.fn(actual.handleRageActivation) };
});

import { actionDispatchTable } from '../action-dispatch-table';
import { handleRageActivation } from '../action-handlers';

import type * as ActionHandlers from '../action-handlers';
import type { CombatParticipant } from '@/types/combat';

const barbarian = {
  id: 'p1',
  name: 'Grok',
  participantType: 'player',
  characterClass: 'barbarian',
  level: 3,
  maxHitPoints: 40,
  currentHitPoints: 40,
  temporaryHitPoints: 0,
  armorClass: 15,
  initiative: 10,
  speed: 30,
  actionTaken: false,
  bonusActionTaken: false,
  reactionTaken: false,
  movementUsed: 0,
  movementRemaining: 30,
  reactionOpportunities: [],
  conditions: [],
  deathSaves: { successes: 0, failures: 0 },
  damageResistances: [],
  damageImmunities: [],
  damageVulnerabilities: [],
  classFeatures: [
    { name: 'rage', description: 'Rage', className: 'barbarian', level: 1, type: 'bonus_action' },
  ],
  resources: { hitDice: {}, rages: { max: 3, current: 3 } },
} as CombatParticipant;

describe('actionDispatchTable use_class_feature (#453)', () => {
  it('activates Rage when featureUsed is rage (the shape use-combat-mechanics sends)', async () => {
    const action = {
      participantId: 'p1',
      actionType: 'use_class_feature' as const,
      description: 'x',
      featureUsed: 'rage',
    };

    const result = await actionDispatchTable.use_class_feature(action, barbarian);

    expect(handleRageActivation).toHaveBeenCalledWith(action, barbarian);
    expect(result?.success).toBe(true);
    expect(result?.participantUpdates.isRaging).toBe(true);
    expect(result?.participantUpdates.resources?.rages?.current).toBe(2);
  });

  it('does nothing for other features', async () => {
    vi.mocked(handleRageActivation).mockClear();

    const result = await actionDispatchTable.use_class_feature(
      { featureUsed: 'second_wind' },
      barbarian,
    );

    expect(result).toBeUndefined();
    expect(handleRageActivation).not.toHaveBeenCalled();
  });
});
