/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #210 QA-039: sheet tab panels must not add an extra keyboard focus stop
 * when content is already focusable; empty panels stay reachable (tabindex 0).
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import CharacterSheetTabs from '../character-sheet-tabs';

import type { Character, CharacterClass } from '@/types/character';

const mainTabState = vi.hoisted(() => ({
  body: null as React.ReactNode,
}));

vi.mock('../CharacterSheetHeader', () => ({ CharacterSheetHeader: () => null }));
vi.mock('../ExperienceManager', () => ({ default: () => null }));
vi.mock('../MulticlassManager', () => ({ default: () => null }));
vi.mock('../tabs/AbilitiesTab', () => ({ default: () => null }));
vi.mock('../tabs/FeaturesTab', () => ({ default: () => null }));
vi.mock('../tabs/InventoryTab', () => ({ default: () => null }));
vi.mock('../tabs/MainTab', () => ({
  default: () => <>{mainTabState.body ?? <div>main</div>}</>,
}));
vi.mock('../tabs/NotesTab', () => ({ default: () => null }));
// SpellsTab is real — non-caster empty state is the QA-039 keyboard path.
vi.mock('@/components/gallery/CharacterGallery', () => ({ default: () => null }));

vi.mock('@/services/characterSpellApi', () => ({
  characterSpellService: {
    isEnabled: vi.fn(() => false),
    getCharacterSpells: vi.fn(),
  },
}));

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

describe('CharacterSheetTabs focus order (#210 QA-039)', () => {
  it('empty tab bodies keep the active panel at tabindex 0 (reachable)', () => {
    mainTabState.body = <div>main</div>;
    const { container } = render(
      <CharacterSheetTabs
        character={{ id: 'c1', name: 'X' } as any}
        onCharacterUpdate={vi.fn() as any}
      />,
    );
    const panel = container.querySelector('[role="tabpanel"]');
    expect(panel).not.toBeNull();
    expect(panel!.getAttribute('tabindex')).toBe('0');
  });

  it('panels with focusable content use tabindex -1 so Tab skips the panel shell', () => {
    mainTabState.body = <button type="button">Go</button>;
    const { container } = render(
      <CharacterSheetTabs
        character={{ id: 'c1', name: 'X' } as any}
        onCharacterUpdate={vi.fn() as any}
      />,
    );
    const panel = container.querySelector('[role="tabpanel"]');
    expect(panel).not.toBeNull();
    expect(panel!.getAttribute('tabindex')).toBe('-1');
  });

  it('non-caster Spells panel is keyboard-reachable (real SpellsTab)', async () => {
    mainTabState.body = <div>main</div>;
    const user = userEvent.setup();
    render(<CharacterSheetTabs character={makeFighter()} onCharacterUpdate={vi.fn() as any} />);

    await user.click(screen.getByRole('tab', { name: /spells/i }));

    await waitFor(() => {
      expect(screen.getByText('This class does not cast spells')).toBeInTheDocument();
    });

    const panel = screen.getByRole('tabpanel');
    expect(panel.getAttribute('tabindex')).toBe('0');

    const spellsTab = screen.getByRole('tab', { name: /spells/i });
    spellsTab.focus();
    await user.tab();
    expect(panel).toHaveFocus();
  });
});
