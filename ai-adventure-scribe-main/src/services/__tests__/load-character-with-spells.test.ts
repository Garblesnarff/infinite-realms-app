import { describe, expect, it, vi } from 'vitest';

import { loadCharacterWithSpells } from '../load-character-with-spells';

const { getCharacter, getCharacterSpells, convertSpellIdsToFrontend } = vi.hoisted(() => ({
  getCharacter: vi.fn(),
  getCharacterSpells: vi.fn(),
  convertSpellIdsToFrontend: vi.fn((ids: string[]) => ids.map((id) => `frontend-${id}`)),
}));

vi.mock('@/services/user-data-api', () => ({ userDataApi: { getCharacter } }));
vi.mock('../characterSpellApi', () => ({ characterSpellService: { getCharacterSpells } }));
vi.mock('@/utils/spell-id-mapping', () => ({ convertSpellIdsToFrontend }));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('loadCharacterWithSpells API spell shape', () => {
  it('reads the canonical spell UUID from the API record id field', async () => {
    getCharacter.mockResolvedValue({
      id: 'character-id',
      name: 'Seeded Bard',
      race: 'Human',
      class: 'Bard',
      level: 1,
      cantrips: '',
      known_spells: '',
      prepared_spells: '',
      ritual_spells: '',
      character_stats: [{ charisma: 16 }],
    });
    getCharacterSpells.mockResolvedValue({
      cantrips: [{ id: 'uuid-vicious-mockery', name: 'Vicious Mockery', level: 0 }],
      spells: [{ id: 'uuid-healing-word', name: 'Healing Word', level: 1 }],
    });

    const result = await loadCharacterWithSpells('character-id');

    expect(convertSpellIdsToFrontend).toHaveBeenNthCalledWith(1, ['uuid-vicious-mockery']);
    expect(convertSpellIdsToFrontend).toHaveBeenNthCalledWith(2, ['uuid-healing-word']);
    expect(result?.cantrips).toEqual(['frontend-uuid-vicious-mockery']);
    expect(result?.knownSpells).toEqual(['frontend-uuid-healing-word']);
  });
});
