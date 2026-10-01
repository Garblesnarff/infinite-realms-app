import { beforeEach, describe, expect, it } from 'bun:test';

import {
  isPlayerCharacterName,
  resolveSceneCombatant,
  seatEntityWithinReach,
  UNKNOWN_CREATURE,
  uniqueCollidedSeatNames,
} from '../seating.js';

const makeMap = () => ({
  id: 'map-1',
  sessionId: 'session-1',
  width: 8,
  height: 3,
  round: 1,
  sceneDescription: 'An open room.',
  cells: Array.from({ length: 3 }, () =>
    Array.from({ length: 8 }, () => ({
      terrain: 'floor' as const,
      blocksMovement: false,
      blocksSight: false,
      cover: 0 as const,
      elevation: 0,
    })),
  ),
  entities: [
    {
      id: 'player',
      name: 'Rook',
      x: 1,
      y: 1,
      size: 'medium' as const,
      type: 'pc' as const,
      speedFeet: 30,
      movementRemaining: 30,
    },
    {
      id: 'target',
      name: 'Professor',
      x: 6,
      y: 1,
      size: 'medium' as const,
      type: 'monster' as const,
      speedFeet: 30,
      movementRemaining: 30,
    },
  ],
});

let map = makeMap();

beforeEach(() => {
  map = makeMap();
});

describe('seatEntityWithinReach', () => {
  it('seats a conversational target at five feet or less', () => {
    const result = seatEntityWithinReach(map, 'target', 'player');
    const player = map.entities[0];
    const target = map.entities[1];

    expect(result?.distanceFeet).toBeLessThanOrEqual(5);
    expect(
      Math.max(Math.abs(player.x - target.x), Math.abs(player.y - target.y)) * 5,
    ).toBeLessThanOrEqual(5);
    expect(target.movementRemaining).toBe(10);
  });

  it('returns no placement when every candidate cell is blocked', () => {
    const blockedMap = {
      ...map,
      cells: map.cells.map((row) => row.map((cell) => ({ ...cell, blocksMovement: true }))),
    };

    expect(seatEntityWithinReach(blockedMap, 'target', 'player')).toBeNull();
  });

  it('debits a full thirty-foot entry seating approach', () => {
    const entryMap = {
      ...map,
      width: 10,
      cells: map.cells.map((row) => [
        ...row,
        ...Array.from({ length: 2 }, () => ({
          terrain: 'floor' as const,
          blocksMovement: false,
          blocksSight: false,
          cover: 0 as const,
          elevation: 0,
        })),
      ]),
      entities: map.entities.map((entity) =>
        entity.id === 'target' ? { ...entity, x: 8, movementRemaining: 30 } : entity,
      ),
    };

    seatEntityWithinReach(entryMap, 'target', 'player');

    expect(entryMap.entities.find((entity) => entity.id === 'target')?.movementRemaining).toBe(0);
  });
});

describe('resolveSceneCombatant', () => {
  it('replaces a synthetic prose seat with the named creature and its scene attack', () => {
    const result = resolveSceneCombatant({
      candidateName: 'Player 1',
      sceneDescription:
        'The Chiropteran Hulk beats its wings. Sonic Screech: Cone 30ft. 4d6 thunder damage.',
    });

    expect(result).toMatchObject({
      name: 'Chiropteran Hulk',
      source: 'scene',
      attackSource: 'scene',
      attackProfile: { source: 'scene', attacks: [{ name: 'Sonic Screech', damageDice: '4d6' }] },
    });
  });

  it('uses a creature type from the scene before admitting an unknown seat', () => {
    expect(
      resolveSceneCombatant({
        candidateName: 'NPC 1',
        sceneDescription: 'A hulking guard blocks the only exit.',
      }).name,
    ).toBe('Hulking Guard');
    expect(resolveSceneCombatant({ candidateName: 'Player 1' }).name).toBe(UNKNOWN_CREATURE);
  });
});

describe('a combatant never takes a player character name (#2438)', () => {
  const PLAYER_NAMES = ['The Apprentice'];
  const NARRATION =
    'You push past the shelves. The Bitter End Mercenary, a scarred sellsword, raises a blade.';

  it('reads every spelling prose gives the player as the player', () => {
    for (const spelling of ['The Apprentice', 'Apprentice', 'apprentice', 'the apprentice']) {
      expect(isPlayerCharacterName(spelling, PLAYER_NAMES)).toBe(true);
    }
    expect(isPlayerCharacterName('Apprentice 2', PLAYER_NAMES)).toBe(true);
    expect(isPlayerCharacterName('Apprentice of the Bitter End', PLAYER_NAMES)).toBe(false);
    expect(isPlayerCharacterName('The Bitter End Mercenary', PLAYER_NAMES)).toBe(false);
    expect(isPlayerCharacterName('Apprentice', [])).toBe(false);
  });

  it('replaces "Apprentice" for the PC "The Apprentice" with the creature the prose names', () => {
    const result = resolveSceneCombatant({
      candidateName: 'Apprentice',
      sceneDescription: NARRATION,
      playerNames: PLAYER_NAMES,
    });
    expect(result).toMatchObject({ name: 'Bitter End Mercenary', source: 'scene' });
  });

  it('does not take the PC name from the scene entity or the fallback either', () => {
    expect(
      resolveSceneCombatant({
        candidateName: 'Hostile Creature',
        sceneEntityName: 'The Apprentice',
        fallbackName: 'Apprentice',
        playerNames: PLAYER_NAMES,
      }).name,
    ).toBe(UNKNOWN_CREATURE);
  });

  it('skips a PC named in the prose and reads the creature after it', () => {
    const result = resolveSceneCombatant({
      candidateName: 'Hostile Creature',
      sceneDescription:
        'Goldwhisk looks at the Apprentice Mage and frowns. The Bitter End Mercenary raises a blade.',
      playerNames: ['The Apprentice Mage'],
    });
    expect(result.name).toBe('Bitter End Mercenary');
  });

  it('strips a count from the candidate only: PC "Agent 7" is not "Agent 8"', () => {
    expect(isPlayerCharacterName('Agent 8', ['Agent 7'])).toBe(false);
    expect(isPlayerCharacterName('Agent 7', ['Agent 7'])).toBe(true);
    expect(isPlayerCharacterName('Apprentice 3', ['The Apprentice'])).toBe(true);
  });

  it('keeps the name when no player carries it', () => {
    expect(resolveSceneCombatant({ candidateName: 'Apprentice', playerNames: ['Rook'] }).name).toBe(
      'Apprentice',
    );
  });
});

describe('uniqueCollidedSeatNames (#2444)', () => {
  it('leaves a single collided seat with a name of its own as it is', () => {
    expect(uniqueCollidedSeatNames(['Rook', 'Mercenary'], [false, true])).toEqual([
      'Rook',
      'Mercenary',
    ]);
  });

  it('numbers collided seats that share a name', () => {
    expect(
      uniqueCollidedSeatNames(['Rook', 'Mercenary', 'Mercenary'], [false, true, true]),
    ).toEqual(['Rook', 'Mercenary 1', 'Mercenary 2']);
  });

  it('numbers a collided seat whose name a seat that did not collide already holds', () => {
    expect(uniqueCollidedSeatNames(['Mercenary', 'Mercenary'], [false, true])).toEqual([
      'Mercenary',
      'Mercenary 1',
    ]);
  });

  it('skips a number another seat already holds', () => {
    expect(
      uniqueCollidedSeatNames(['Mercenary 1', 'Mercenary', 'Mercenary'], [false, true, true]),
    ).toEqual(['Mercenary 1', 'Mercenary 2', 'Mercenary 3']);
  });

  it('compares names the way a player name is compared: case, article and punctuation', () => {
    expect(uniqueCollidedSeatNames(['The Mercenary', 'mercenary!'], [true, true])).toEqual([
      'The Mercenary 1',
      'mercenary! 2',
    ]);
  });
});
