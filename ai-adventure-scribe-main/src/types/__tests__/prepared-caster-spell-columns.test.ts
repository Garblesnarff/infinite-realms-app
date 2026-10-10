import { describe, expect, it } from 'vitest';

import {
  creationBardSpells,
  creationClericSpells,
  creationPaladinSpells,
} from '../../../shared/test-fixtures/prepared-caster-spell-lists';

import { transformCharacterForStorage, type Character } from '@/types/character';

/**
 * #217 step d2: the server's spell gate is tested against these columns, so they must be what
 * the creation wizard's save writes for a Cleric who prepared only some of their spells.
 */
describe('transformCharacterForStorage spell columns (#217 step d2)', () => {
  it.each([
    ['Cleric', creationClericSpells],
    ['Paladin', creationPaladinSpells],
    ['Bard', creationBardSpells],
  ])(
    "writes a creation-wizard %s's cantrips, picked spells and prepared spells exactly as the gate tests seed them",
    (_className, spells) => {
      const character = {
        name: 'Test Caster',
        cantrips: [...spells.cantrips],
        knownSpells: [...spells.knownSpells],
        preparedSpells: [...spells.preparedSpells],
      } as unknown as Character;

      const storage = transformCharacterForStorage(character) as Record<string, unknown>;

      expect({
        cantrips: storage.cantrips,
        known_spells: storage.known_spells,
        prepared_spells: storage.prepared_spells,
      }).toEqual(spells.columns);
    },
  );
});
