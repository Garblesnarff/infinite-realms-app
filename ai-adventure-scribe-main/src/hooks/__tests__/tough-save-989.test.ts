import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

import { fighter } from '@/data/classes/fighter';
import { human } from '@/data/races/human';
import { prepareCharacterPayload } from '@/services/user-data-payload-helpers';
import { transformCharacterForStorage, type Character } from '@/types/character';
import { transformAbilityScoresForStorage } from '@/utils/characterTransformations';

describe('#989 Tough save body', () => {
  it('pins the actual writer body with Tough stored in feature JSON', () => {
    const abilityScores = Object.fromEntries(
      Object.entries({
        strength: 15,
        dexterity: 14,
        constitution: 14,
        intelligence: 10,
        wisdom: 10,
        charisma: 8,
      }).map(([key, score]) => [
        key,
        { score, modifier: Math.floor((score - 10) / 2), savingThrow: false },
      ]),
    );
    const character = {
      name: 'Tough Fighter 989',
      race: human,
      subrace: human.subraces?.find((s) => s.id === 'variant-human'),
      class: fighter,
      level: 1,
      feats: ['tough'],
      abilityScores,
    } as unknown as Character;
    const storedStats = transformAbilityScoresForStorage(character.abilityScores!, '');
    const stats = {
      strength: storedStats.strength,
      dexterity: storedStats.dexterity,
      constitution: storedStats.constitution,
      intelligence: storedStats.intelligence,
      wisdom: storedStats.wisdom,
      charisma: storedStats.charisma,
    };
    const body = prepareCharacterPayload({
      ...transformCharacterForStorage(character),
      stats,
      equipment: [],
    });
    const file = resolve(process.cwd(), 'shared/test-fixtures/tough-fighter-989-create.json');
    if (process.env.UPDATE_FIXTURES === '1')
      writeFileSync(file, JSON.stringify(body, null, 2) + '\n');
    expect(body).toEqual(JSON.parse(readFileSync(file, 'utf8')));
    expect(body.class_features).toMatchObject({ 'feat:tough': { name: 'Tough' } });
  });
});
