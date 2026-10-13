/**
 * #490: racial COUNT_MISMATCH errors must carry a message, in both the
 * non-spellcaster branch and the "caster class, but no slots at this level"
 * fallback branch, so UIs that render error.message show something.
 */
import { describe, expect, it, vi } from 'vitest';

const spellcastingInfo = vi.hoisted(() => ({ value: null as unknown }));

vi.mock('@/utils/spell-validation/racial-spells', () => ({
  getRacialSpells: () => ({ cantrips: ['light'], bonusCantrips: 0, spells: ['faerie-fire'] }),
}));
vi.mock('@/utils/spell-validation/spellcasting-info', () => ({
  getSpellcastingInfo: () => spellcastingInfo.value,
}));

import { validateSpellSelection } from '../validator-sync';

import type { Character } from '@/types/character';

const makeCharacter = (spellcasting: unknown): Character =>
  ({
    id: 'c1',
    name: 'Drow Test',
    level: 1,
    race: { name: 'Elf' },
    subrace: 'Drow',
    class: { name: 'Paladin', spellcasting },
  }) as unknown as Character;

const countErrors = (character: Character) =>
  validateSpellSelection(character, [], []).errors.filter((e) => e.type === 'COUNT_MISMATCH');

describe('racial COUNT_MISMATCH messages (#490)', () => {
  it('non-spellcaster branch: both count errors have a message', () => {
    const errors = countErrors(makeCharacter(undefined));
    expect(errors).toHaveLength(2);
    expect(errors.map((e) => e.message)).toEqual([
      'Expected 1 racial cantrips, but got 0',
      'Expected 1 racial spells, but got 0',
    ]);
  });

  it('caster with nothing at this level (fallback branch): both count errors have a message', () => {
    spellcastingInfo.value = { cantripsKnown: 0, spellsKnown: 0, spellsPrepared: 0 };
    const errors = countErrors(makeCharacter({ ability: 'charisma' }));
    expect(errors).toHaveLength(2);
    for (const error of errors) {
      expect(error.message).toMatch(/^Expected 1 racial (cantrips|spells), but got 0$/);
    }
  });
});
