import { describe, expect, it } from 'vitest';

import { transformCharacterForStorage, type Character } from '@/types/character';

/**
 * #2598: spell slots live in one store — the engine's character_spell_slots
 * table. The sheet must not write its local slot view back into the legacy
 * characters.spell_slots JSONB on save; that write is what kept the two stores
 * disagreeing after edits. Reads serve the table, saves leave slots alone.
 */
describe('transformCharacterForStorage (#2598)', () => {
  it('does not persist spell_slots', () => {
    const character = {
      name: 'Test Wizard',
      spellSlots: { 1: { max: 2, current: 1 } },
      pactSlots: { 1: { max: 1, current: 1 } },
    } as unknown as Character;

    const storage = transformCharacterForStorage(character) as Record<string, unknown>;

    expect(storage).not.toHaveProperty('spell_slots');
    // Pact slots are a separate store (candidate 17's scope) and stay as-is.
    expect(storage.pact_slots).toBe(JSON.stringify({ 1: { max: 1, current: 1 } }));
  });
});
