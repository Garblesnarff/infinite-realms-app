import { describe, expect, it } from 'bun:test';

import { appendActiveCompanionInputs } from '../companion-seating.js';

describe('companion combat seating', () => {
  it('adds active companions to the existing player participant stream', () => {
    const inputs = appendActiveCompanionInputs(
      [
        {
          encounterId: '',
          characterId: 'main-character',
          name: 'Ari',
          initiativeModifier: 99,
        },
      ],
      [
        { characterId: 'companion-1', name: 'Mira' },
        { characterId: 'companion-2', name: 'Sol' },
      ],
    );

    expect(inputs.map((input) => input.characterId)).toEqual([
      'main-character',
      'companion-1',
      'companion-2',
    ]);
    expect(inputs.slice(1)).toEqual([
      {
        encounterId: '',
        characterId: 'companion-1',
        name: 'Mira',
        initiativeModifier: 0,
      },
      {
        encounterId: '',
        characterId: 'companion-2',
        name: 'Sol',
        initiativeModifier: 0,
      },
    ]);
  });

  it('does not duplicate a companion already present in a player action payload', () => {
    const inputs = appendActiveCompanionInputs(
      [
        {
          encounterId: '',
          characterId: 'companion-1',
          name: 'Mira from caller',
          initiativeModifier: 7,
        },
      ],
      [{ characterId: 'companion-1', name: 'Mira from database' }],
    );

    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.name).toBe('Mira from caller');
  });
});
