import { describe, expect, it } from 'vitest';

import { buildCharacterSheet } from '../overhaul/useOverhaulViewModel';

import type { Character } from '@/types/character';

describe('game-session character sheet view model', () => {
  it('uses stored current/max HP instead of preview math', () => {
    const character = {
      id: 'char-stored-hp',
      name: 'The Apprentice',
      level: 5,
      race: {
        name: 'Human',
        speed: 30,
        traits: [],
        languages: [],
      },
      class: {
        name: 'Barbarian',
        hitDie: 12,
      },
      abilityScores: {
        strength: { score: 10, modifier: 0, savingThrow: false },
        dexterity: { score: 14, modifier: 2, savingThrow: false },
        constitution: { score: 16, modifier: 3, savingThrow: false },
        intelligence: { score: 10, modifier: 0, savingThrow: false },
        wisdom: { score: 10, modifier: 0, savingThrow: false },
        charisma: { score: 10, modifier: 0, savingThrow: false },
      },
      character_stats: {
        current_hit_points: 7,
        max_hit_points: 20,
      },
    } as unknown as Character;

    const sheet = buildCharacterSheet(character);

    // Preview math would produce 55 for this level-5 Barbarian.
    expect(sheet.hpCurrent).toBe(7);
    expect(sheet.hpMax).toBe(20);
  });
});
