import { describe, expect, it } from 'vitest';

import { UNSUPPORTED_ACTION_GENERIC_NOTICE, unsupportedActionNotice } from '../combat-notice';

import { parseEngineLine } from '@/features/game-session/components/chat/message-list/engine-line-model';

// #1640: a declared Help, Ready or Use an Object names itself in the engine line; the turn is not used.
describe('unsupportedActionNotice (#1640)', () => {
  it.each([
    [
      'help',
      'Help is not a supported action yet. Your turn is not used: choose Attack, Dodge, Dash, Disengage or Hide.',
    ],
    [
      'ready',
      'Ready is not a supported action yet. Your turn is not used: choose Attack, Dodge, Dash, Disengage or Hide.',
    ],
    [
      'use_object',
      'Use an Object is not a supported action yet. Your turn is not used: choose Attack, Dodge, Dash, Disengage or Hide.',
    ],
  ])('names the refused kind "%s"', (kind, expected) => {
    expect(unsupportedActionNotice(kind)).toBe(expected);
  });

  it.each([undefined, null, '', 'teleport', 'constructor', 'toString'])(
    'keeps the generic line when the kind is "%s"',
    (kind) => {
      expect(unsupportedActionNotice(kind)).toBe(UNSUPPORTED_ACTION_GENERIC_NOTICE);
    },
  );

  it('is plain text: the engine chip shows it with no markdown wrapper', () => {
    const chip = parseEngineLine(unsupportedActionNotice('help'));

    expect(chip.sentence).toBe(
      'Help is not a supported action yet. Your turn is not used: choose Attack, Dodge, Dash, Disengage or Hide.',
    );
    expect(chip.sentence).not.toMatch(/\*/);
  });
});
