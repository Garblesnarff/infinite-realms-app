import { expect, test } from 'bun:test';

import { formatCombatActionParts } from './combat-outcome-transcript';

test('the Rage engine line names the spell whose concentration ended', () => {
  const [part] = formatCombatActionParts(
    { actor_id: 'hero', action_type: 'rage' },
    { expiresRound: 11, droppedConcentration: 'Bless' },
    [{ id: 'hero', name: 'The Hero', participantType: 'player' }],
  );

  expect(part.line).toEndWith('The Hero loses concentration on Bless.');
});
