import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Character } from '@/types/character';

import { cleric } from '@/data/classes/cleric';
import { dwarf } from '@/data/races/dwarf';
import { RightSheet } from '@/features/game-session/components/game/overhaul/RightSheet';
import { buildSpellsViewModel } from '@/features/game-session/components/game/overhaul/spell-view-model';
import { buildCharacterSheet } from '@/features/game-session/components/game/overhaul/useOverhaulViewModel';

vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({ state: { campaign: null } }),
}));

vi.mock('@/lib/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const hillDwarf = dwarf.subraces?.find((s) => s.id === 'hill-dwarf') ?? null;

function ability(score: number): { score: number; modifier: number; savingThrow: boolean } {
  return { score, modifier: Math.floor((score - 10) / 2), savingThrow: false };
}

function lifeCleric(overrides: Partial<Character> = {}): Character {
  return {
    id: 'char-life-cleric-765',
    user_id: 'user-1',
    name: 'Hark Life Cleric',
    race: dwarf,
    subrace: hillDwarf,
    class: cleric,
    level: 1,
    background: null,
    classFeatures: {
      'divine-domain': {
        name: 'Divine Domain',
        description: 'Choose one domain related to your deity.',
        choice: 'Life Domain: Focuses on healing and protection',
      },
    },
    abilityScores: {
      strength: ability(14),
      dexterity: ability(10),
      constitution: ability(14),
      intelligence: ability(10),
      wisdom: ability(16),
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
    cantrips: ['guidance', 'sacred-flame', 'thaumaturgy'],
    knownSpells: [],
    preparedSpells: [
      'Guiding Bolt',
      'Healing Word',
      'Sanctuary',
      'Shield of Faith',
      'Bless',
      'Cure Wounds',
    ],
    ritualSpells: [],
    spellSlots: { 1: { max: 2, current: 2 } },
    ...overrides,
  } as Character;
}

describe('#765 Life Cleric Bless dedupe', () => {
  it('shape A: RightSheet lists Bless once', () => {
    const sheet = buildCharacterSheet(lifeCleric());
    render(<RightSheet c={sheet} onCastSpell={vi.fn()} onTogglePrepared={vi.fn()} />);

    expect(screen.getAllByText('Bless')).toHaveLength(1);
    expect(screen.getAllByText('Cure Wounds')).toHaveLength(1);
    expect(screen.getAllByText('Guiding Bolt')).toHaveLength(1);
  });

  it('shape A: Bless is always prepared with Cast and no prepare toggle', () => {
    const sheet = buildCharacterSheet(lifeCleric());
    render(<RightSheet c={sheet} onCastSpell={vi.fn()} onTogglePrepared={vi.fn()} />);

    expect(screen.getAllByText('Always prepared').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button', { name: 'Cast Bless' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Prepare Bless/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Unprepare Bless/i })).not.toBeInTheDocument();
  });

  it('shape A: a player pick can be unprepared', () => {
    const sheet = buildCharacterSheet(lifeCleric());
    render(<RightSheet c={sheet} onCastSpell={vi.fn()} onTogglePrepared={vi.fn()} />);

    expect(screen.getByRole('button', { name: /Unprepare Guiding Bolt/i })).toBeInTheDocument();
  });

  it('mixed ids: Bless appears once and is prepared + always prepared', () => {
    const sheet = buildCharacterSheet(
      lifeCleric({
        knownSpells: ['bless', 'cure-wounds', 'guiding-bolt', 'healing-word'],
        preparedSpells: ['Bless', 'Cure Wounds', 'Guiding Bolt', 'Healing Word'],
      }),
    );
    render(<RightSheet c={sheet} onCastSpell={vi.fn()} onTogglePrepared={vi.fn()} />);

    expect(screen.getAllByText('Bless')).toHaveLength(1);
    const bless = sheet.spells.known.find((s) => s.name === 'Bless');
    expect(bless?.isPrepared).toBe(true);
    expect(bless?.alwaysPrepared).toBe(true);
    expect(bless?.canPrepare).toBe(false);
  });

  it('producer: Bless alwaysPrepared/canPrepare=false and hasSpellbook false', () => {
    const sheet = buildCharacterSheet(lifeCleric());
    const bless = sheet.spells.known.find((s) => s.name === 'Bless');
    expect(bless?.alwaysPrepared).toBe(true);
    expect(bless?.canPrepare).toBe(false);
    expect(bless?.isPrepared).toBe(true);
    // Keep the raw stored id so Prepare/Cast send the same string as preparedSpells.
    expect(bless?.id).toBe('Bless');
    expect(sheet.spells.known.find((s) => s.name === 'Guiding Bolt')?.id).toBe('Guiding Bolt');
    expect(sheet.spellcasting?.hasSpellbook).toBe(false);
  });

  it('producer: buildSpellsViewModel unique known+prepared counts', () => {
    const { spells } = buildSpellsViewModel(lifeCleric(), {
      spellAttackBonus: 0,
      spellSaveDC: 0,
      spellcastingAbility: 'wisdom',
      spellSlots: {},
    });
    const blessKnown = spells.known.filter((s) => s.name === 'Bless');
    const blessPrepared = spells.prepared.filter((s) => s.name === 'Bless');
    // prepared array still contains Bless (CombatActionBar casts from known).
    expect(blessPrepared).toHaveLength(1);
    expect(blessKnown).toHaveLength(1);
  });

  it('session-loaded shape: name-only class + subclassName still marks Bless always prepared', () => {
    const sheet = buildCharacterSheet(
      lifeCleric({
        class: { name: 'Cleric' } as Character['class'],
        subclassName: 'Life Domain',
        classFeatures: undefined,
      }),
    );
    render(<RightSheet c={sheet} onCastSpell={vi.fn()} onTogglePrepared={vi.fn()} />);

    expect(screen.getAllByText('Bless')).toHaveLength(1);
    expect(sheet.spells.known.find((s) => s.name === 'Bless')?.alwaysPrepared).toBe(true);
    expect(screen.getByRole('button', { name: 'Cast Bless' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Unprepare Bless/i })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Prepared' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Spellbook' })).not.toBeInTheDocument();
  });

  it('name-only Wizard still has a spellbook list and a Prepared group', () => {
    const wizard = {
      id: 'char-wizard-765',
      name: 'Scholar',
      class: { name: 'Wizard' },
      level: 1,
      abilityScores: {
        strength: ability(8),
        dexterity: ability(14),
        constitution: ability(12),
        intelligence: ability(16),
        wisdom: ability(10),
        charisma: ability(10),
      },
      cantrips: ['fire-bolt'],
      knownSpells: ['magic-missile', 'shield'],
      preparedSpells: ['magic-missile'],
    } as Character;
    const sheet = buildCharacterSheet(wizard);
    expect(sheet.spellcasting?.hasSpellbook).toBe(true);
    render(<RightSheet c={sheet} onCastSpell={vi.fn()} onTogglePrepared={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Spellbook' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Prepared' })).toBeInTheDocument();
    expect(screen.getAllByText('Magic Missile')).toHaveLength(2);
  });
});
