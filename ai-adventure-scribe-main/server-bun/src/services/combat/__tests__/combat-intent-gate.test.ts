import { describe, expect, it } from 'bun:test';

import { detectDeclaredAttack } from '../combat-intent-gate.js';

const actors = [
  { name: 'Professor Emil Darkwater' },
  { name: 'The Ghoul', monsterId: 'srd:ghoul' },
];

describe('detectDeclaredAttack', () => {
  it('matches a short target token to the full narrative-ledger actor name', () => {
    expect(detectDeclaredAttack('i punch Darkwater', actors)).toEqual({
      verb: 'punch',
      actorName: 'Professor Emil Darkwater',
    });
  });

  it('accepts the conversational attack prefixes', () => {
    expect(detectDeclaredAttack('we attempt to swing at Darkwater', actors)).toMatchObject({
      verb: 'swing at',
      actorName: 'Professor Emil Darkwater',
    });
  });

  it('does not classify a question as an attack', () => {
    expect(detectDeclaredAttack('I ask Darkwater why he lied', actors)).toBeNull();
  });

  it('requires a damaging spell for cast intent', () => {
    expect(detectDeclaredAttack('Cast Light at the ghoul', actors)).toBeNull();
    expect(detectDeclaredAttack('cast Magic Missile at the ghoul', actors)).toEqual({
      verb: 'cast Magic Missile',
      actorName: 'The Ghoul',
      monsterId: 'srd:ghoul',
    });
  });
});
