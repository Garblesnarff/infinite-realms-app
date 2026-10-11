import { describe, expect, test } from 'bun:test';

import { combatVictoryXp, ENCOUNTER_XP_THRESHOLDS } from '../combat-xp-mechanics.js';

// #310: combat victory XP follows the 2014 DMG "XP Thresholds by Character Level" table
// (DMG p. 82): [easy, medium, hard, deadly] per character.
describe('combatVictoryXp (#310)', () => {
  test('the table covers levels 1–20 with four bands each', () => {
    for (let level = 1; level <= 20; level += 1) {
      const band = ENCOUNTER_XP_THRESHOLDS[level];
      expect(band).toBeDefined();
      expect(band).toHaveLength(4);
      expect([...band].sort((a, b) => a - b)).toEqual(band);
    }
  });

  test('level 1 values match the DMG table', () => {
    expect(combatVictoryXp(1, 'easy')).toBe(25);
    expect(combatVictoryXp(1, 'medium')).toBe(50);
    expect(combatVictoryXp(1, 'hard')).toBe(75);
    expect(combatVictoryXp(1, 'deadly')).toBe(100);
  });

  test('level 5 and 20 spot checks', () => {
    expect(combatVictoryXp(5, 'medium')).toBe(500);
    expect(combatVictoryXp(5, 'deadly')).toBe(1100);
    expect(combatVictoryXp(20, 'easy')).toBe(2800);
    expect(combatVictoryXp(20, 'deadly')).toBe(12700);
  });

  test('corrected high-level rows match the DMG table', () => {
    expect(combatVictoryXp(9, 'deadly')).toBe(2400);
    expect(combatVictoryXp(17, 'medium')).toBe(3900);
    expect(combatVictoryXp(17, 'hard')).toBe(5900);
    expect(combatVictoryXp(19, 'hard')).toBe(7300);
  });

  test('an unknown or missing difficulty reads as medium', () => {
    expect(combatVictoryXp(3, null)).toBe(150);
    expect(combatVictoryXp(3, 'brutal')).toBe(150);
    expect(combatVictoryXp(3, 'MEDIUM')).toBe(150);
  });

  test('out-of-range levels clamp to the table edges', () => {
    expect(combatVictoryXp(0, 'medium')).toBe(50);
    expect(combatVictoryXp(99, 'medium')).toBe(5700);
  });
});
