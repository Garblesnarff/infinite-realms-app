import { describe, expect, it } from 'vitest';

import { wizardSteps } from '../constants';

// Proving test for #2675 step 1: the dead wizard step files
// (FeatSelection, HitPointsSelection, StartingEquipmentSelection clusters)
// are gone, but the live wizard still renders all 15 steps.
describe('wizard steps (#2675 step 1)', () => {
  it('still has exactly 15 steps', () => {
    expect(wizardSteps).toHaveLength(15);
  });

  it('gives every step a component and a label', () => {
    for (const step of wizardSteps) {
      expect(step.component).toBeDefined();
      expect(step.label).toBeTruthy();
    }
  });

  it('does not reference any deleted step component', () => {
    const names = wizardSteps.map((step) => step.component?.name ?? '');
    for (const dead of ['FeatSelection', 'HitPointsSelection', 'StartingEquipmentSelection']) {
      expect(names).not.toContain(dead);
    }
  });
});
