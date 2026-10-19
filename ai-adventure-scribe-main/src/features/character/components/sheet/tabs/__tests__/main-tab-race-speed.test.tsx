/**
 * #757: the standalone sheet's Speed tile. The character is produced by the same real
 * loader the game page uses (loadCharacterWithSpells, network mocked), so this fails on
 * the old name-only race stub (which showed the 30 ft default) and passes once the loader
 * resolves the race record.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import MainTab from '../MainTab';

import type { Character } from '@/types/character';

import { loadCharacterWithSpells } from '@/services/load-character-with-spells';

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
vi.mock('@/services/rest-api', () => ({
  restApi: { shortRest: vi.fn(), longRest: vi.fn(), attuneItem: vi.fn() },
  applyRestResultToCharacter: (character: Character): Character => character,
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

async function loadDriven(race: string, subrace: string): Promise<Character> {
  getCharacter.mockResolvedValue({
    id: 'character-id',
    user_id: 'user-1',
    name: 'Test Hero',
    race,
    subrace,
    class: 'Fighter',
    level: 1,
    cantrips: '',
    known_spells: '',
    prepared_spells: '',
    ritual_spells: '',
    character_stats: [abilityScores],
  });
  const character = await loadCharacterWithSpells('character-id');
  if (!character) throw new Error('loader returned null');
  return character;
}

function renderedSpeed(): string | null {
  return screen.getByText('Speed (ft)').previousElementSibling?.textContent ?? null;
}

describe('#757 standalone sheet shows 25 ft for Halfling and Dwarf', () => {
  beforeEach(() => {
    getCharacterEquipment.mockResolvedValue([]);
    getCharacterSpells.mockResolvedValue({ cantrips: [], spells: [] });
  });

  it.each([
    ['Lightfoot Halfling', 'Halfling', 'Lightfoot Halfling'],
    ['Stout Halfling', 'Halfling', 'Stout Halfling'],
    ['Hill Dwarf', 'Dwarf', 'Hill Dwarf'],
    ['Mountain Dwarf', 'Dwarf', 'Mountain Dwarf'],
  ])('%s shows 25', async (_label, race, subrace) => {
    const character = await loadDriven(race, subrace);
    render(<MainTab character={character} onUpdate={vi.fn()} onCharacterUpdate={vi.fn()} />);

    expect(renderedSpeed()).toBe('25');
  });
});
