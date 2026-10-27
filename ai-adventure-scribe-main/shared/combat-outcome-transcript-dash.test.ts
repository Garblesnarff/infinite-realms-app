import { describe, expect, it } from 'bun:test';

import { formatCombatActionParts } from './combat-outcome-transcript';

describe('Dash engine transcript', () => {
  it('reports the distance the authoritative result added', () => {
    const [part] = formatCombatActionParts(
      { actor_id: 'dash-pc-1', action_type: 'dash' },
      { movementGainedFeet: 30 },
      [{ id: 'dash-pc-1', name: 'The Runner', participantType: 'player' }],
    );

    expect(part.line).toContain('The Runner dashed and gained 30 ft of movement.');
  });
});
