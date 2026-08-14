/**
 * #1779 — the player seat sent with every DM turn so the server can seat an encounter.
 *
 * Only the four values a participant row is built from travel with the turn; the character
 * record itself never leaves the client whole.
 */
import { describe, expect, it } from 'vitest';

import { buildCombatEntryPlayer } from '../structured-combat-payload';

describe('buildCombatEntryPlayer', () => {
  it('reads the dexterity modifier and hit points off a camelCase record', () => {
    expect(
      buildCombatEntryPlayer({
        id: 'char-1',
        name: 'The Storyteller',
        abilityScores: { dexterity: { modifier: 3 } },
        currentHitPoints: 7,
        maxHitPoints: 9,
      }),
    ).toEqual({
      characterId: 'char-1',
      name: 'The Storyteller',
      initiativeModifier: 3,
      hpCurrent: 7,
      hpMax: 9,
    });
  });

  it('reads the snake_case shape the session context actually returns', () => {
    expect(
      buildCombatEntryPlayer({
        id: 'char-1',
        name: 'Cleric',
        ability_scores: { dexterity: { modifier: -1 } },
        current_hit_points: 11,
        max_hit_points: 11,
      }),
    ).toMatchObject({ initiativeModifier: -1, hpCurrent: 11, hpMax: 11 });
  });

  it('defaults the modifier to zero rather than dropping the seat', () => {
    expect(buildCombatEntryPlayer({ id: 'char-1', name: 'Nameless' })).toEqual({
      characterId: 'char-1',
      name: 'Nameless',
      initiativeModifier: 0,
    });
  });

  it('returns null when there is no character to seat', () => {
    expect(buildCombatEntryPlayer(null)).toBeNull();
    expect(buildCombatEntryPlayer({ id: 'char-1' })).toBeNull();
  });
});
