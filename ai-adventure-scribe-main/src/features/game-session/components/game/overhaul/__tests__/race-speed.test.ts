/**
 * #757: a Halfling (Lightfoot/Stout) and Dwarf (Hill/Mountain) walk 25 ft. The in-game
 * panel reads its speed through buildCharacterSheet -> calculateAllCharacterStats ->
 * getBaseSpeed, and the character that reaches it comes from the real game loader
 * (loadCharacterWithSpells). This drives that whole path with the network mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildCharacterSheet } from '../useOverhaulViewModel';

import type { Character } from '@/types/character';

import { loadCharacterWithSpells } from '@/services/load-character-with-spells';
import { calculateAllCharacterStats, getBaseSpeed } from '@/utils/character-calculations';

const { getCharacter, getCharacterEquipment, getCharacterSpells } = vi.hoisted(() => ({
  getCharacter: vi.fn(),
  getCharacterEquipment: vi.fn(),
  getCharacterSpells: vi.fn(),
}));

vi.mock('@/services/user-data-api', () => ({ userDataApi: { getCharacter } }));
vi.mock('@/services/issue-1784-api', () => ({ issue1784Api: { getCharacterEquipment } }));
vi.mock('@/services/characterSpellApi', () => ({
  characterSpellService: { getCharacterSpells },
}));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const abilityScores = {
  strength: 8,
  dexterity: 16,
  constitution: 14,
  intelligence: 10,
  wisdom: 12,
  charisma: 13,
};

function storedRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'character-id',
    user_id: 'user-1',
    name: 'Test Hero',
    class: 'Fighter',
    level: 1,
    cantrips: '',
    known_spells: '',
    prepared_spells: '',
    ritual_spells: '',
    character_stats: [abilityScores],
    ...overrides,
  };
}

async function loadDriven(race: string, subrace: string): Promise<Character> {
  getCharacter.mockResolvedValue(storedRow({ race, subrace }));
  const character = await loadCharacterWithSpells('character-id');
  if (!character) throw new Error('loader returned null');
  return character;
}

describe('#757 Halfling and Dwarf speed in the in-game panel', () => {
  beforeEach(() => {
    getCharacterEquipment.mockResolvedValue([]);
    getCharacterSpells.mockResolvedValue({ cantrips: [], spells: [] });
  });

  it.each([
    ['Lightfoot Halfling', 'Halfling', 'Lightfoot Halfling'],
    ['Stout Halfling', 'Halfling', 'Stout Halfling'],
    ['Hill Dwarf', 'Dwarf', 'Hill Dwarf'],
    ['Mountain Dwarf', 'Dwarf', 'Mountain Dwarf'],
  ])('%s derives 25 ft from the race data', async (_label, race, subrace) => {
    const character = await loadDriven(race, subrace);

    // The loader must carry the resolved race record, not a name-only stub.
    expect(character.race?.speed).toBe(25);
    expect(character.subrace?.name).toBe(subrace);

    expect(getBaseSpeed(character)).toBe(25);
    expect(calculateAllCharacterStats(character).speed).toBe(25);
    expect(buildCharacterSheet(character).speed).toBe(25);
  });
});
