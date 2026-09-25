import { describe, expect, it, vi } from 'vitest';

import { loadCharacterWithSpells } from '../load-character-with-spells';

import { getCharacterSheetHitPoints } from '@/utils/character/character-sheet-hit-points';

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
  it('reads the canonical spell identifier from the API record id field', async () => {
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
      spell_slots: JSON.stringify({
        1: { max: 4, current: 3 },
        2: { max: 2, current: 1 },
      }),
      character_stats: [{ charisma: 16 }],
    });
    getCharacterSpells.mockResolvedValue({
      cantrips: [{ id: 'vicious-mockery', name: 'Vicious Mockery', level: 0 }],
      spells: [{ id: 'healing-word', name: 'Healing Word', level: 1 }],
    });

    const result = await loadCharacterWithSpells('character-id');

    expect(convertSpellIdsToFrontend).toHaveBeenNthCalledWith(1, ['vicious-mockery']);
    expect(convertSpellIdsToFrontend).toHaveBeenNthCalledWith(2, ['healing-word']);
    expect(result?.cantrips).toEqual(['frontend-vicious-mockery']);
    expect(result?.knownSpells).toEqual(['frontend-healing-word']);
  });

  it('hydrates stored spell slots without recomputing them', async () => {
    getCharacter.mockResolvedValue({
      id: 'character-id',
      name: 'Stored Wizard',
      race: 'Human',
      class: 'Wizard',
      level: 3,
      cantrips: '',
      known_spells: '',
      prepared_spells: '',
      ritual_spells: '',
      spell_slots: {
        1: { max: 4, current: 3 },
        2: { max: 2, current: 1 },
      },
      character_stats: [{ intelligence: 18 }],
    });
    getCharacterSpells.mockResolvedValue({ cantrips: [], spells: [] });

    const result = await loadCharacterWithSpells('character-id');

    expect(result?.spellSlots).toEqual({
      1: { max: 4, current: 3 },
      2: { max: 2, current: 1 },
    });
  });

  it("keeps a premade's stored hit points on the character the stat bar reads", async () => {
    getCharacter.mockResolvedValue({
      id: 'veteran',
      name: 'The Veteran',
      race: 'Human',
      class: 'Fighter',
      level: 1,
      cantrips: '',
      known_spells: '',
      prepared_spells: '',
      ritual_spells: '',
      character_stats: [
        {
          strength: 16,
          dexterity: 12,
          constitution: 14,
          intelligence: 10,
          wisdom: 13,
          charisma: 10,
          armor_class: 18,
          max_hit_points: 12,
          current_hit_points: 12,
        },
      ],
    });
    getCharacterSpells.mockResolvedValue({ cantrips: [], spells: [] });

    const result = await loadCharacterWithSpells('veteran');

    expect(getCharacterSheetHitPoints(result!)).toEqual({ current: 12, maximum: 12 });
  });
});
