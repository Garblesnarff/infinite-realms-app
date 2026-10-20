import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'bun:test';

import { parseBossMoveLine, parseAuthoredStatBlock } from '../authored-stat-block-parser.js';

const fixture = readFileSync(
  path.join(import.meta.dir, 'fixtures', 'thing-below-stat-block.md'),
  'utf8',
);

describe('authored Boss Moves', () => {
  it('reads the pilot boss, The Thing Below, as three moves in slot order', () => {
    const parsed = parseAuthoredStatBlock(fixture);
    expect(parsed.bossMoves?.map((move) => move.slot)).toEqual(['Opener', 'Turnabout', 'Finale']);
    expect(parsed.bossMoves?.[0]).toMatchObject({
      name: 'Starlit Lash',
      effect: { kind: 'strike' },
      telegraph: null,
    });
    expect(parsed.bossMoves?.[1]).toMatchObject({
      name: 'Gaze of the Void',
      effect: { kind: 'frighten', ability: 'wis' },
    });
    expect(parsed.bossMoves?.[2]).toMatchObject({
      name: 'Reality Break',
      effect: { kind: 'burst', ability: 'int' },
    });
    expect(parsed.bossMoves?.[2]?.telegraph).toContain('hum');
    // The existing stat fields still read the same way.
    expect(parsed.maxHp).toBe(200);
    expect(parsed.armorClass).toBe(19);
    expect(parsed.attackBonus).toBe(7);
    expect(parsed.unparsedLabels).toEqual([]);
  });

  it('refuses an effect outside the closed list and reports the label', () => {
    const block = fixture.replace('effect: strike', 'effect: swallow whole');
    const parsed = parseAuthoredStatBlock(block);
    expect(parsed.bossMoves?.map((move) => move.slot)).toEqual(['Turnabout', 'Finale']);
    expect(parsed.unparsedLabels).toContain('Opener');
  });

  it('refuses a Finale with no telegraph, because it is announced a round early', () => {
    expect(
      parseBossMoveLine(
        'Finale',
        'Reality Break | effect: burst int | tell: x | telegraph: none | counterplay: y',
      ),
    ).toBeUndefined();
  });

  it('refuses a line with a missing part, a duplicate part, or a stray segment', () => {
    expect(
      parseBossMoveLine('Opener', 'Bite | effect: strike | tell: x | counterplay: y'),
    ).toBeUndefined();
    expect(
      parseBossMoveLine(
        'Opener',
        'Bite | effect: strike | effect: strike | tell: x | telegraph: none | counterplay: y',
      ),
    ).toBeUndefined();
    expect(
      parseBossMoveLine(
        'Opener',
        'Bite | effect: strike | tell: x | telegraph: none | counterplay: y | nonsense',
      ),
    ).toBeUndefined();
  });

  it('refuses an ability on strike, and a save effect with no ability', () => {
    expect(
      parseBossMoveLine(
        'Opener',
        'Bite | effect: strike wis | tell: x | telegraph: none | counterplay: y',
      ),
    ).toBeUndefined();
    expect(
      parseBossMoveLine(
        'Turnabout',
        'Gaze | effect: frighten | tell: x | telegraph: none | counterplay: y',
      ),
    ).toBeUndefined();
  });

  it('refuses a name that is not letters, so dice cannot pass as a move', () => {
    expect(
      parseBossMoveLine(
        'Opener',
        '2d6 | effect: strike | tell: x | telegraph: none | counterplay: y',
      ),
    ).toBeUndefined();
  });
});

describe('Mook flag', () => {
  it('reads Mook: yes and Mook: no', () => {
    expect(parseAuthoredStatBlock('**HP:** 6, **AC:** 12\n**Mook:** yes').mook).toBe(true);
    expect(parseAuthoredStatBlock('**HP:** 6, **AC:** 12\n**Mook:** no').mook).toBe(false);
  });

  it('reports a malformed Mook value rather than guessing', () => {
    const parsed = parseAuthoredStatBlock('**HP:** 6, **AC:** 12\n**Mook:** sometimes');
    expect(parsed.mook).toBeUndefined();
    expect(parsed.unparsedLabels).toContain('Mook');
  });
});
