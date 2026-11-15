/**
 * #1521 (restores a case lost with StatsBar.test.tsx in #1496): a negative initiative
 * modifier shows with its sign on the Table sheet. The character comes from the real
 * game loader (loadCharacterWithSpells, network mocked, same path as race-speed.test.ts)
 * and the sheet from the real producer buildCharacterSheet, then RightSheet renders it.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RightSheet } from '../RightSheet';
import { buildCharacterSheet } from '../useOverhaulViewModel';

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
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({ state: { campaign: null } }),
}));

describe('Table sheet initiative sign (#1521)', () => {
  beforeEach(() => {
    getCharacterEquipment.mockResolvedValue([]);
    getCharacterSpells.mockResolvedValue({ cantrips: [], spells: [] });
  });

  it('shows a -1 initiative with its sign', async () => {
    getCharacter.mockResolvedValue({
      id: 'character-id',
      user_id: 'user-1',
      name: 'Test Hero',
      race: 'Human',
      subrace: '',
      class: 'Fighter',
      level: 1,
      cantrips: '',
      known_spells: '',
      prepared_spells: '',
      ritual_spells: '',
      character_stats: [
        {
          strength: 14,
          dexterity: 8,
          constitution: 14,
          intelligence: 10,
          wisdom: 12,
          charisma: 10,
        },
      ],
    });
    const character = await loadCharacterWithSpells('character-id');
    if (!character) throw new Error('loader returned null');

    const sheet = buildCharacterSheet(character);
    expect(sheet.initiative).toBe('-1');

    render(<RightSheet c={sheet} />);
    const tile = screen.getByText('INIT').parentElement as HTMLElement;
    expect(tile.querySelectorAll('span')[1].textContent).toBe('-1');
  });
});
