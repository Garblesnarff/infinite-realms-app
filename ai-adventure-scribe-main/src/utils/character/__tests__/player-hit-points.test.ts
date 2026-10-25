import { describe, expect, it } from 'vitest';

import {
  type CharacterEquipmentRow,
  type CharacterStatsRow,
  transformCharacterData,
} from '../data-transformers';
import { resolvePlayerHitPoints } from '../player-hit-points';

import type { Character } from '@/types/character';
import type { CombatEncounter } from '@/types/combat-encounter';

import { mapAuthoritativeCombat } from '@/contexts/combat/authoritative-combat-state';

const characterRow = {
  id: 'character-85',
  user_id: 'user-85',
  name: 'The Scholar',
  race: 'Human',
  class: 'Wizard',
  level: 1,
};

const buildCharacter = (stats: CharacterStatsRow): Character =>
  transformCharacterData(characterRow, stats, [] as CharacterEquipmentRow[]);

/** The encounter the client holds, from its only producer of one. */
const encounterWith = (currentHp: number, maxHp: number, tempHp: number): CombatEncounter =>
  mapAuthoritativeCombat({
    encounter: {
      id: 'enc-1',
      sessionId: 'session-1',
      status: 'active',
      currentRound: 2,
      currentTurnOrder: 0,
      startedAt: '2026-09-29T00:00:00.000Z',
    },
    participants: [
      {
        id: 'p1',
        name: 'The Scholar',
        participantType: 'player',
        initiative: 9,
        initiativeModifier: 0,
        armorClass: 11,
        maxHp,
        speed: 30,
        isActive: true,
        status: { currentHp, maxHp, tempHp, isConscious: true },
      },
    ],
  });

describe('resolvePlayerHitPoints (#85)', () => {
  it('reads the encounter participant HP while an encounter is active', () => {
    const character = buildCharacter({
      current_hit_points: 7,
      max_hit_points: 7,
    } as CharacterStatsRow);

    expect(resolvePlayerHitPoints(encounterWith(4, 7, 3), character)).toEqual({
      current: 4,
      maximum: 7,
      temp: 3,
      source: 'encounter',
    });
  });

  it('reads the stored sheet HP when no encounter is active', () => {
    const character = buildCharacter({
      current_hit_points: 5,
      max_hit_points: 7,
    } as CharacterStatsRow);

    expect(resolvePlayerHitPoints(null, character)).toEqual({
      current: 5,
      maximum: 7,
      temp: 0,
      source: 'sheet',
    });
  });

  it('falls back to the sheet when the encounter seats no player', () => {
    const character = buildCharacter({
      current_hit_points: 5,
      max_hit_points: 7,
    } as CharacterStatsRow);
    const noPlayer = mapAuthoritativeCombat({
      encounter: {
        id: 'enc-1',
        sessionId: 'session-1',
        status: 'active',
        currentRound: 1,
        currentTurnOrder: 0,
        startedAt: '2026-09-29T00:00:00.000Z',
      },
      participants: [
        {
          id: 'm1',
          name: 'Glass Prowler',
          participantType: 'monster',
          initiative: 4,
          initiativeModifier: 0,
          armorClass: 11,
          maxHp: 22,
          speed: 30,
          isActive: true,
          status: { currentHp: 22, maxHp: 22, tempHp: 0, isConscious: true },
        },
      ],
    });

    expect(resolvePlayerHitPoints(noPlayer, character).source).toBe('sheet');
    expect(resolvePlayerHitPoints(noPlayer, character).current).toBe(5);
  });

  it('reports nulls, not a dash, when neither source has HP', () => {
    expect(resolvePlayerHitPoints(null, null)).toEqual({
      current: null,
      maximum: null,
      temp: 0,
      source: 'sheet',
    });
  });
});
