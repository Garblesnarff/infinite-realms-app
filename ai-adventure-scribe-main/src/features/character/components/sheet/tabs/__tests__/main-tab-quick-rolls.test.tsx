/**
 * #228 MB-006: the sheet's Quick Rolls cover all six abilities, and the
 * Initiative value matches the text-2xl AC/Speed values instead of rendering
 * as a small button that shows the modifier twice ("+2 +2"). The character
 * is produced by the same real loader the game page uses
 * (loadCharacterWithSpells, network mocked).
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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

async function loadDriven(scores: typeof abilityScores = abilityScores): Promise<Character> {
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
    character_stats: [scores],
  });
  getCharacterEquipment.mockResolvedValue([]);
  getCharacterSpells.mockResolvedValue({ cantrips: [], spells: [] });
  const character = await loadCharacterWithSpells('character-id');
  if (!character) throw new Error('loader returned null');
  return character;
}

describe('#228 MB-006 sheet Quick Rolls and Initiative', () => {
  it('lists all six abilities as Quick Rolls', async () => {
    const character = await loadDriven();
    render(<MainTab character={character} onUpdate={vi.fn()} onCharacterUpdate={vi.fn()} />);

    for (const ability of ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']) {
      expect(screen.getByRole('button', { name: `Roll ${ability}` })).toBeInTheDocument();
    }
  });

  it('shows the Initiative modifier once, as a big value like AC and Speed', async () => {
    const character = await loadDriven();
    render(<MainTab character={character} onUpdate={vi.fn()} onCharacterUpdate={vi.fn()} />);

    // DEX 16 is +3: the button must read "+3" once, not "+3 +3" (label plus
    // the modifier span DiceRoller renders beside it).
    const initiative = screen.getByRole('button', { name: 'Roll +3' });
    expect(initiative.textContent).toBe('+3');
    // The big text lives on the DiceRoller wrapper as an arbitrary variant
    // targeting the inner button, matching the text-2xl AC/Speed values.
    expect(initiative.parentElement?.className).toContain('[&_button]:text-2xl');
    expect(initiative.parentElement?.className).toContain('justify-center');
  });

  it('shows a negative Initiative modifier as "-1", not "+-1"', async () => {
    const character = await loadDriven({ ...abilityScores, dexterity: 8 });
    render(<MainTab character={character} onUpdate={vi.fn()} onCharacterUpdate={vi.fn()} />);

    // DEX 8 is -1: the sign comes from the modifier itself, not a hardcoded '+'.
    const initiative = screen.getByRole('button', { name: 'Roll -1' });
    expect(initiative.textContent).toBe('-1');
  });

  it('gives Initiative and Quick Roll buttons 44px touch targets', async () => {
    const character = await loadDriven();
    render(<MainTab character={character} onUpdate={vi.fn()} onCharacterUpdate={vi.fn()} />);

    // #228 FIX round 1: the Initiative button was h-10 (40 px) and the Quick
    // Roll buttons were size sm (h-9, 36 px) — below the 44 px floor this PR
    // sets. The floor lives on the DiceRoller wrapper as arbitrary variants
    // targeting the inner button, the same class-assertion approach as the
    // roster test, via the wrapper (min-w-11, not w-11, so wider content is
    // never clipped).
    for (const ability of ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']) {
      const button = screen.getByRole('button', { name: `Roll ${ability}` });
      expect(button.parentElement?.className).toContain('[&_button]:h-11');
      expect(button.parentElement?.className).toContain('[&_button]:min-w-11');
    }
    const initiative = screen.getByRole('button', { name: 'Roll +3' });
    expect(initiative.parentElement?.className).toContain('[&_button]:h-11');
    expect(initiative.parentElement?.className).toContain('[&_button]:min-w-11');
  });
});
