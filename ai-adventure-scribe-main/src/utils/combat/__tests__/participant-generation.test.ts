import { describe, it, expect } from 'vitest';

import { createCombatParticipantsFromDetection, parseMultiattackSequence } from '../participant-generation';

import type { DetectedEnemy } from '@/utils/combatDetection';

describe('createCombatParticipantsFromDetection', () => {
  const player = {
    id: 'p1',
    name: 'Player One',
    armor_class: 15,
    hit_points: 20,
    abilityScores: {
      dexterity: { modifier: 2 },
    },
  };

  const enemies: DetectedEnemy[] = [
    {
      name: 'Goblin',
      type: 'humanoid',
      estimatedCR: '1/4',
      description: 'A small green creature',
      suggestedHP: 7,
      suggestedAC: 13,
    },
  ];

  it('generates participants including player and enemies', () => {
    const participants = createCombatParticipantsFromDetection(enemies, player);

    expect(participants).toHaveLength(2);
    expect(participants[0].name).toBe('Player One');
    expect(participants[0].initiative).toBe(2);
    expect(participants[0].armorClass).toBe(15);

    expect(participants[1].name).toBe('Goblin');
    expect(participants[1].initiative).toBe(2); // real goblin DEX 14
    expect(participants[1].armorClass).toBe(15);
    expect(participants[1].monsterData?.type).toBe('humanoid');
  });

  it('handles null player character', () => {
    const participants = createCombatParticipantsFromDetection(enemies, null);

    expect(participants).toHaveLength(1);
    expect(participants[0].name).toBe('Goblin');
  });

  it('handles missing player character attributes', () => {
    // @ts-expect-error - testing missing attributes
    const participants = createCombatParticipantsFromDetection([], { id: 'p2', name: 'NoAttr' });
    expect(participants[0].initiative).toBe(0);
    expect(participants[0].armorClass).toBe(10);
    expect(participants[0].maxHitPoints).toBe(10);
  });

  it('handles multiple enemies with indexing', () => {
    const multiEnemies: DetectedEnemy[] = [
      enemies[0],
      { ...enemies[0], name: 'Goblin' },
    ];
    const participants = createCombatParticipantsFromDetection(multiEnemies, null);

    expect(participants).toHaveLength(2);
    expect(participants[0].name).toBe('Goblin');
    expect(participants[1].name).toBe('Goblin 2');
  });

  it('uses real monster ability scores and attacks instead of CR guesses', () => {
    const participant = createCombatParticipantsFromDetection(enemies, null)[0];
    expect(participant.initiative).toBe(2);
    expect(participant.monsterData?.attacks[0]).toMatchObject({ name: 'Scimitar', attackBonus: 4, damageRoll: '1d6+2' });
  });

  it('handles numeric and missing CR', () => {
    // @ts-expect-error - testing invalid input
    const participants1 = createCombatParticipantsFromDetection([{ ...enemies[0], estimatedCR: 5 }], null);
    expect(participants1[0].initiative).toBe(2);

    // @ts-expect-error - testing invalid input
    const participants2 = createCombatParticipantsFromDetection([{ ...enemies[0], estimatedCR: undefined }], null);
    expect(participants2[0].initiative).toBe(2);
  });

  it('parses ordered multiattack sequences', () => {
    expect(parseMultiattackSequence('The dragon makes three attacks: one with its bite and two with its claws.', ['Bite', 'Claw']))
      .toEqual(['Bite', 'Claw', 'Claw']);
  });
});
