import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { Character, CharacterClass } from '@/types/character';

import SpellsTab from '@/features/character/components/sheet/tabs/SpellsTab';
import { restApi } from '@/services/rest-api';

// Mock the spell API service (disabled so the hook uses character data only)
vi.mock('@/services/characterSpellApi', () => ({
  characterSpellService: {
    isEnabled: vi.fn(() => false),
    getCharacterSpells: vi.fn(),
  },
}));

// Mock the rest API — the shared rest path the tab's Long Rest must use
vi.mock('@/services/rest-api', () => ({
  restApi: {
    shortRest: vi.fn(),
    longRest: vi.fn(),
    attuneItem: vi.fn(),
  },
  applyRestResultToCharacter: (character: Character): Character => character,
}));

vi.mock('@/lib/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function ability(score: number): { score: number; modifier: number; savingThrow: boolean } {
  const modifier = Math.floor((score - 10) / 2);
  return { score, modifier, savingThrow: false };
}

function makeFighter(): Character {
  return {
    id: 'char-fighter',
    user_id: 'user-1',
    name: 'Test Fighter',
    race: null,
    class: {
      id: 'fighter',
      name: 'Fighter',
      description: 'A Fighter',
      hitDie: 10,
      primaryAbility: 'strength',
      savingThrowProficiencies: ['strength', 'constitution'],
      skillChoices: [],
      numSkillChoices: 0,
      classFeatures: [],
      subclasses: [],
      armorProficiencies: [],
      weaponProficiencies: [],
    } as CharacterClass,
    level: 5,
    background: null,
    abilityScores: {
      strength: ability(18),
      dexterity: ability(14),
      constitution: ability(16),
      intelligence: ability(10),
      wisdom: ability(12),
      charisma: ability(8),
    },
    experience: 0,
    alignment: '',
    description: '',
    skillProficiencies: [],
    expertiseProficiencies: [],
    toolProficiencies: [],
    savingThrowProficiencies: [],
    languages: [],
    personalityTraits: [],
    ideals: [],
    bonds: [],
    flaws: [],
    equipment: [],
    cantrips: [],
    knownSpells: [],
    preparedSpells: [],
    ritualSpells: [],
    spellSlots: {
      1: { max: 4, current: 4 },
    },
  } as Character;
}

function makeCleric(): Character {
  return {
    ...makeFighter(),
    id: 'char-cleric',
    name: 'Test Cleric',
    class: {
      id: 'cleric',
      name: 'Cleric',
      description: 'A Cleric',
      hitDie: 8,
      primaryAbility: 'wisdom',
      savingThrowProficiencies: ['wisdom', 'charisma'],
      skillChoices: [],
      numSkillChoices: 0,
      classFeatures: [],
      subclasses: [],
      armorProficiencies: [],
      weaponProficiencies: [],
    } as CharacterClass,
  } as Character;
}

describe('SpellsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a non-caster state for a Fighter: no DC, no attack, no Long Rest', () => {
    render(<SpellsTab character={makeFighter()} onUpdate={() => {}} />);

    expect(screen.getByText('This class does not cast spells')).toBeInTheDocument();
    // No fabricated spellcasting numbers
    expect(screen.queryByText('Spell Attack Bonus')).not.toBeInTheDocument();
    expect(screen.queryByText('Spell Save DC')).not.toBeInTheDocument();
    expect(screen.queryByText('Spellcasting Ability')).not.toBeInTheDocument();
    // No Long Rest control either
    expect(
      screen.queryByRole('button', { name: 'Recover all spell slots and sorcery points' }),
    ).not.toBeInTheDocument();
  });

  it('keeps the spell tabs mounted after a rejected Long Rest and shows the inline error', async () => {
    const user = userEvent.setup();
    vi.mocked(restApi.longRest).mockRejectedValue(new Error('network down'));

    render(<SpellsTab character={makeCleric()} onUpdate={() => {}} />);

    // Open the slots tab and trigger the rest
    await user.click(screen.getByRole('tab', { name: /spell slots/i }));
    await user.click(
      screen.getByRole('button', { name: 'Recover all spell slots and sorcery points' }),
    );

    // The inline error appears in the slots section…
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Long rest failed: network down');
    });

    // …but the tabs are still rendered — no page-level "Failed to load
    // spells" screen and no page-reload Retry.
    expect(screen.getByRole('tab', { name: /cantrips/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^spells \d+$/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /spell slots/i })).toBeInTheDocument();
    expect(screen.queryByText('Failed to load spells')).not.toBeInTheDocument();
  });
});
