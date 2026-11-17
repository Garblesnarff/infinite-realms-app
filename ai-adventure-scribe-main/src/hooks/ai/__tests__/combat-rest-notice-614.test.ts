import { describe, expect, it } from 'vitest';

import { REST_IN_COMBAT_NOTICE, isRestRequest } from '../combat-notice';

// #614: a rest request typed in a fight is named as a rest, and only as the player's own act.
describe('isRestRequest (#614)', () => {
  it.each([
    'I take a short rest.',
    'Let us take a long rest here.',
    'I want to take a long rest.',
    'I try to rest.',
    'I rest.',
    'Let me make camp for the night.',
    'We set up camp and go to sleep.',
  ])('reads "%s" as a rest request', (message) => {
    expect(isRestRequest(message)).toBe(true);
  });

  it.each([
    'I rest my hand on the wall.',
    'I attack the goblin with my shortsword.',
    'I try to talk the elemental down.',
    'The rest of the party charges.',
    'I dodge behind the rest of the crates.',
    '',
    undefined,
  ])('does not read "%s" as a rest request', (message) => {
    expect(isRestRequest(message)).toBe(false);
  });

  it('gives the rest its own engine line: not possible during combat, still the turn', () => {
    expect(REST_IN_COMBAT_NOTICE).toBe(
      '*(A rest is not possible during combat. It is still your turn.)*',
    );
  });
});
