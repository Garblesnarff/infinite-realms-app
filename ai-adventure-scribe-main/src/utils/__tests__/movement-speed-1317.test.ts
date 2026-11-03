import { describe, expect, it } from 'vitest';

import { applyMovementSpeedModifiers } from '../../../shared/srd-race-speed-data';

import type { Character } from '@/types/character';

import { getBaseSpeed } from '@/utils/character-calculations';

const hero = (overrides: Record<string, unknown>): Character =>
  ({
    race: { name: 'Human', speed: 30 },
    class: { name: 'Fighter' },
    level: 1,
    abilityScores: { strength: { score: 10 } },
    inventory: [],
    ...overrides,
  }) as unknown as Character;
const armor = (itemId: string) => [
  { itemId, itemName: itemId, itemType: 'armor', equipped: true, quantity: 1 },
];

describe('2014 walking speed modifiers (#1317)', () => {
  it('grants a level 5 barbarian 10 feet except in heavy armor', () => {
    expect(getBaseSpeed(hero({ class: { name: 'Barbarian' }, level: 5 }))).toBe(40);
    expect(getBaseSpeed(hero({ class: { name: 'Barbarian' }, level: 4 }))).toBe(30);
    expect(
      getBaseSpeed(
        hero({
          class: { name: 'Barbarian' },
          level: 5,
          abilityScores: { strength: { score: 15 } },
          inventory: armor('Chain Mail'),
        }),
      ),
    ).toBe(30);
  });
  it.each([
    [1, 30],
    [2, 40],
    [6, 45],
    [10, 50],
    [14, 55],
    [18, 60],
  ])('gives an unarmored level %i monk %i feet', (level, speed) => {
    expect(getBaseSpeed(hero({ class: { name: 'Monk' }, level }))).toBe(speed);
  });
  it('removes monk movement with armor or a shield', () => {
    expect(
      getBaseSpeed(hero({ class: { name: 'Monk' }, level: 5, inventory: armor('Leather Armor') })),
    ).toBe(30);
    expect(
      getBaseSpeed(hero({ class: { name: 'Monk' }, level: 5, inventory: armor('Shield') })),
    ).toBe(30);
  });
  it('applies Mobile and the heavy armor strength requirement, with the dwarf exception', () => {
    expect(getBaseSpeed(hero({ classFeatures: { 'feat:mobile': { name: 'Mobile' } } }))).toBe(40);
    expect(getBaseSpeed(hero({ inventory: armor('Chain Mail') }))).toBe(20);
    expect(
      getBaseSpeed(hero({ race: { name: 'Dwarf', speed: 25 }, inventory: armor('Chain Mail') })),
    ).toBe(25);
    expect(getBaseSpeed(hero({ inventory: armor('Ring Mail') }))).toBe(30);
  });
  it('reads JSON-string legacy class levels and feature choices', () => {
    expect(
      applyMovementSpeedModifiers(30, {
        classLevels: JSON.stringify([{ className: 'Monk', level: 6 }]),
        classFeatures: JSON.stringify({ 'feat:mobile': { name: 'Mobile' } }),
      }),
    ).toBe(55);
  });
  it('stacks only qualifying class features and applies the armor penalty last', () => {
    expect(
      getBaseSpeed(
        hero({
          level: 9,
          classLevels: [
            { className: 'Barbarian', level: 5 },
            { className: 'Monk', level: 4 },
          ],
          classFeatures: { 'feat:mobile': { name: 'Mobile' } },
        }),
      ),
    ).toBe(60);
    expect(
      getBaseSpeed(
        hero({
          class: { name: 'Barbarian' },
          level: 5,
          inventory: armor('Chain Mail'),
          classFeatures: { 'feat:mobile': { name: 'Mobile' } },
        }),
      ),
    ).toBe(30);
  });
});
