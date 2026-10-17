import { describe, expect, it } from 'vitest';

import { isTypedEndTurn } from '../typed-end-turn';

describe('isTypedEndTurn (#784)', () => {
  it.each([
    'I end my turn',
    'I end my turn.',
    'end turn',
    'End turn!',
    'end my turn',
    'pass',
    'I pass.',
    'I wait',
    'done',
    '  Done  ',
  ])('reads %j as an end-of-turn', (message) => {
    expect(isTypedEndTurn(message)).toBe(true);
  });

  it.each([
    'I pass the potion to Mira',
    'I wait for the goblin to approach then attack',
    'I attack the goblin',
    '',
    null,
    undefined,
  ])('does not read %j as an end-of-turn', (message) => {
    expect(isTypedEndTurn(message)).toBe(false);
  });
});
