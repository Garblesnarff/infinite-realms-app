import { describe, expect, it } from 'bun:test';

import { appliesBlessDie, isBlessConcentration } from '../bless-rider.js';
import { checkHit } from '../hit-check.js';

import type { BlessConcentration } from '../bless-rider.js';

const CASTER_CHARACTER = 'character-cleric';
const SELF = { id: 'participant-cleric', characterId: CASTER_CHARACTER };
const ALLY = { id: 'participant-fighter', characterId: 'character-fighter' };
const STRANGER = { id: 'participant-goblin', characterId: null };

const blessRow = (overrides: Partial<BlessConcentration> = {}): BlessConcentration => ({
  characterId: CASTER_CHARACTER,
  spellName: 'Bless',
  spellId: 'bless',
  targetParticipantId: null,
  ...overrides,
});

describe('Bless rider decision (#902)', () => {
  it('recognizes a Bless row by id or by name', () => {
    expect(isBlessConcentration(blessRow())).toBe(true);
    expect(isBlessConcentration(blessRow({ spellId: null }))).toBe(true);
    expect(isBlessConcentration(blessRow({ spellName: ' bless ' }))).toBe(true);
    expect(isBlessConcentration(blessRow({ spellName: 'Hex', spellId: 'hex' }))).toBe(false);
    expect(isBlessConcentration(null)).toBe(false);
    expect(isBlessConcentration(undefined)).toBe(false);
  });

  it('blesses the caster themself when the row names no single target', () => {
    expect(appliesBlessDie(blessRow(), SELF)).toBe(true);
  });

  it('does not bless anyone else when the row names no single target', () => {
    expect(appliesBlessDie(blessRow(), ALLY)).toBe(false);
    expect(appliesBlessDie(blessRow(), STRANGER)).toBe(false);
  });

  it('blesses the stored target, whoever cast it', () => {
    const row = blessRow({ targetParticipantId: ALLY.id });
    expect(appliesBlessDie(row, ALLY)).toBe(true);
    expect(appliesBlessDie(row, SELF)).toBe(false);
    expect(appliesBlessDie(row, STRANGER)).toBe(false);
  });

  it('does not bless when the concentration is another spell', () => {
    expect(
      appliesBlessDie(blessRow({ spellName: 'Detect Magic', spellId: 'detect-magic' }), SELF),
    ).toBe(false);
    expect(appliesBlessDie(null, SELF)).toBe(false);
    expect(appliesBlessDie(blessRow(), null)).toBe(false);
    expect(appliesBlessDie(blessRow(), undefined)).toBe(false);
  });
});

describe('checkHit with a Bless die (#902)', () => {
  it('adds the d4 to the total so a blessed roll can reach the AC', () => {
    // 10 + 3 falls short of AC 15; Bless's 4 closes the gap.
    const result = checkHit({ attackRoll: 10, attackBonus: 3, targetAC: 15, blessDie: 4 });
    expect(result.hit).toBe(true);
    expect(result.totalAttackRoll).toBe(17);
  });

  it('never rescues a natural 1', () => {
    const result = checkHit({ attackRoll: 1, attackBonus: 30, targetAC: 10, blessDie: 4 });
    expect(result.hit).toBe(false);
    expect(result.isNaturalOne).toBe(true);
  });

  it('never turns a 19 into a critical', () => {
    const result = checkHit({ attackRoll: 19, attackBonus: 3, targetAC: 15, blessDie: 4 });
    expect(result.hit).toBe(true);
    expect(result.isCritical).toBe(false);
    expect(result.isNaturalTwenty).toBe(false);
  });

  it('leaves an unblessed roll untouched', () => {
    const result = checkHit({ attackRoll: 10, attackBonus: 3, targetAC: 15 });
    expect(result.hit).toBe(false);
    expect(result.totalAttackRoll).toBe(13);
  });
});
