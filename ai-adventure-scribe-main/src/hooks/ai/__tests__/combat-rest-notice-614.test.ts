import { describe, expect, it } from 'vitest';

import { REST_IN_COMBAT_NOTICE, isRestRequest } from '../combat-notice';

import { parseEngineLine } from '@/features/game-session/components/chat/message-list/engine-line-model';

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
    'I arrest the goblin.',
    'The guards arrest me.',
    'I arrest him before he flees.',
    '',
    undefined,
  ])('does not read "%s" as a rest request', (message) => {
    expect(isRestRequest(message)).toBe(false);
  });
});

// #614 FIX: an engine chip renders its text as plain text, so the notice carries no markdown.
describe('the rest notice as an engine line (#614)', () => {
  it('is plain text: not possible during combat, still the turn', () => {
    expect(REST_IN_COMBAT_NOTICE).toBe(
      'A rest is not possible during combat. It is still your turn.',
    );
  });

  it('parses to the same plain sentence the chip shows, with no markdown wrapper', () => {
    const chip = parseEngineLine(REST_IN_COMBAT_NOTICE);

    expect(chip.sentence).toBe('A rest is not possible during combat. It is still your turn.');
    expect(chip.sentence).not.toMatch(/\*/);
  });
});
