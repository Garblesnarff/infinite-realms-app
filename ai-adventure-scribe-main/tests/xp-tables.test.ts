import { describe, expect, it } from 'vitest';

import {
  ENCOUNTER_XP_BY_LEVEL,
  XP_TO_REACH_LEVEL,
  encounterXpPerCharacter,
} from '../shared/xp-tables';

describe('XP_TO_REACH_LEVEL (2014 PHB p. 15)', () => {
  it('covers levels 1-20 with the published thresholds', () => {
    expect(XP_TO_REACH_LEVEL[1]).toBe(0);
    expect(XP_TO_REACH_LEVEL[2]).toBe(300);
    expect(XP_TO_REACH_LEVEL[5]).toBe(6500);
    expect(XP_TO_REACH_LEVEL[20]).toBe(355000);
    expect(Object.keys(XP_TO_REACH_LEVEL)).toHaveLength(20);
  });
});

describe('encounterXpPerCharacter (2014 DMG p. 82)', () => {
  it('reads the band for each difficulty at the given level', () => {
    expect(encounterXpPerCharacter(1, 'easy')).toBe(25);
    expect(encounterXpPerCharacter(5, 'deadly')).toBe(1100);
    expect(encounterXpPerCharacter(20, 'easy')).toBe(2800);
  });

  it('reads an unknown or missing difficulty as medium', () => {
    expect(encounterXpPerCharacter(3, null)).toBe(150);
    expect(encounterXpPerCharacter(3, 'legendary')).toBe(150);
  });

  it('clamps out-of-range levels to the table', () => {
    expect(encounterXpPerCharacter(0, 'medium')).toBe(ENCOUNTER_XP_BY_LEVEL[1][1]);
    expect(encounterXpPerCharacter(25, 'medium')).toBe(ENCOUNTER_XP_BY_LEVEL[20][1]);
  });

  it('uses the level it is asked for above level 5 (encounter builder used to clamp to 5)', () => {
    expect(encounterXpPerCharacter(6, 'medium')).toBe(600);
  });
});
