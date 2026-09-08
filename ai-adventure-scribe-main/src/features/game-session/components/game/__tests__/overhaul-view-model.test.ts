import { describe, expect, it } from 'vitest';

import {
  buildCharacterSheet,
  mergePartyMembers,
  type PartyMemberSource,
} from '../overhaul/useOverhaulViewModel';

import type { Character } from '@/types/character';
import type { SessionCompanion } from '@/webmcp/companion-api';

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

describe('game-session party view model', () => {
  const protagonist: PartyMemberSource = {
    characterId: 'hero-character',
    member: {
      id: 'hero-character',
      name: 'Aria',
      subtitle: 'Level 5 Wizard',
      currentHp: 18,
      maxHp: 24,
      avatarUrl: 'https://example.com/aria.png',
    },
  };
  const companion: SessionCompanion = {
    id: 'companion-row',
    characterId: 'companion-character',
    name: 'Mira',
    class: 'Cleric',
    level: 4,
    portraitUrl: 'https://example.com/mira.png',
    controller: 'webmcp',
  };

  it('shows the protagonist and active companions outside combat', () => {
    expect(mergePartyMembers(protagonist, [companion], [])).toEqual([
      protagonist.member,
      {
        id: 'companion-row',
        name: 'Mira',
        subtitle: 'Level 4 Cleric',
        currentHp: null,
        maxHp: null,
        avatarUrl: 'https://example.com/mira.png',
      },
    ]);
  });

  it('deduplicates protagonist and companion encounter participants by characterId', () => {
    const party = mergePartyMembers(
      protagonist,
      [companion],
      [
        {
          id: 'hero-participant',
          characterId: 'hero-character',
          name: 'Aria in combat',
          characterClass: 'Wizard',
          level: 5,
          currentHitPoints: 17,
          maxHitPoints: 24,
          portraitUrl: 'https://example.com/aria-combat.png',
        },
        {
          id: 'companion-participant',
          characterId: 'companion-character',
          name: 'Mira in combat',
          characterClass: 'Cleric',
          level: 4,
          currentHitPoints: 12,
          maxHitPoints: 18,
        },
        {
          id: 'second-player-participant',
          characterId: 'second-player-character',
          name: 'Rook',
          characterClass: 'Ranger',
          level: 3,
          currentHitPoints: 11,
          maxHitPoints: 16,
        },
      ],
    );

    expect(party.map((member) => member.id)).toEqual([
      'hero-character',
      'companion-row',
      'second-player-participant',
    ]);
    expect(party[1]).toMatchObject({
      id: 'companion-row',
      name: 'Mira in combat',
      currentHp: 12,
      maxHp: 18,
    });
    expect(party[2]).toEqual({
      id: 'second-player-participant',
      name: 'Rook',
      subtitle: 'Level 3 Ranger',
      currentHp: 11,
      maxHp: 16,
      avatarUrl: undefined,
    });
  });
});
