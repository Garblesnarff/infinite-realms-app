import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import WizardContent from '../WizardContent';

import type { AbilityScores, Character } from '@/types/character';

import { initialState, characterReducer } from '@/contexts/character/character-reducer';
import { backgrounds } from '@/data/backgroundOptions';
import { fighter } from '@/data/classes/fighter';
import { rogue } from '@/data/classes/rogue';
import { sorcerer } from '@/data/classes/sorcerer';
import { wizard } from '@/data/classes/wizard';
import { elf } from '@/data/races/elf';
import { halfOrc } from '@/data/races/half-orc';
import { human } from '@/data/races/human';

/**
 * #973 (Hark N21-007): the final review step must show the HP the server
 * will store at level 1 — max hit die + CON modifier (the shared
 * `computeLevel1MaxHitPoints` rule). These tests mount the real wizard
 * (real step list, real finalization step, real reducer + initial state,
 * real class/race data) at the final step and read the sidebar preview's
 * HP tile, the HP a player sees while reviewing the finished build.
 * Fixtures follow the wizard's own state shape: BASE ability scores (the
 * wizard holds base scores; racial bonuses are applied by the preview
 * and again at save).
 */

const harness = vi.hoisted(() => ({
  current: null as { state: unknown; dispatch: React.Dispatch<never> } | null,
  toast: vi.fn(),
  saveCharacter: vi.fn(async (character: Character) => ({ ...character, id: 'char-973' })),
}));

vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => harness.current,
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-973' } }),
}));
vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({ state: { campaign: null } }),
}));
vi.mock('@/hooks/use-character-save', () => ({
  useCharacterSave: () => ({ saveCharacter: harness.saveCharacter, isSaving: false }),
}));
vi.mock('@/hooks/use-auto-scroll', () => ({ useAutoScroll: () => ({ scrollToTop: () => {} }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: harness.toast }) }));
vi.mock('@/infrastructure/api', async (importOriginal) => {
  const original = (await importOriginal()) as {
    llmApiClient: Record<string, unknown>;
    [key: string]: unknown;
  };
  return {
    ...original,
    llmApiClient: { ...original.llmApiClient, getImageQuotaStatus: async () => null },
  };
});

function StateHarness({ seed }: { seed: Character }): React.JSX.Element {
  const [state, dispatch] = React.useReducer(characterReducer, {
    ...initialState,
    character: seed,
  });
  harness.current = { state, dispatch: dispatch as React.Dispatch<never> };
  // Rendered from inside the stateful component (not passed as children) so
  // reducer updates re-render the wizard, mirroring the real
  // CharacterProvider's context-value propagation.
  return <WizardContent />;
}

/** Scores in STR, DEX, CON, INT, WIS, CHA order, in the wizard's entry shape. */
function abilityScores([str, dex, con, int, wis, cha]: number[]): AbilityScores {
  const mk = (score: number): AbilityScores['constitution'] => ({
    score,
    modifier: Math.floor((score - 10) / 2),
    savingThrow: false,
  });
  return {
    strength: mk(str),
    dexterity: mk(dex),
    constitution: mk(con),
    intelligence: mk(int),
    wisdom: mk(wis),
    charisma: mk(cha),
  } as AbilityScores;
}

/** The numeric value shown in the preview sidebar's HP tile. */
function previewHitPoints(): string {
  const tile = screen.getByText('HP').parentElement;
  if (!tile) throw new Error('HP tile missing from the character preview');
  return tile.firstElementChild?.textContent ?? '';
}

const highElf = elf.subraces?.find((s) => s.id === 'high-elf') ?? null;

function seedCharacter(overrides: Partial<Character>): Character {
  return {
    ...initialState.character,
    name: 'Rogue Tester',
    race: halfOrc,
    class: rogue,
    background: backgrounds.find((b) => b.id === 'charlatan') ?? null,
    alignment: 'Chaotic Neutral',
    skillProficiencies: ['Stealth', 'Acrobatics'],
    languages: ['Common'],
    equipment: ['Rapier'],
    abilityScores: abilityScores([10, 16, 13, 12, 11, 10]),
    ...overrides,
  } as Character;
}

function renderAtStep(seed: Character, step: number): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[`/app/characters/new?step=${step}`]}>
      <StateHarness seed={seed} />
    </MemoryRouter>,
  );
}

describe('wizard final step HP (#973)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    harness.toast.mockClear();
    harness.saveCharacter.mockClear();
  });

  it('#989 shows Tough Variant Human Fighter CON14 as14 HP', async () => {
    renderAtStep(
      seedCharacter({
        race: human,
        subrace: human.subraces?.find((s) => s.id === 'variant-human'),
        class: fighter,
        feats: ['tough'],
        abilityScores: abilityScores([15, 14, 14, 10, 10, 8]),
      }),
      12,
    );
    expect(await screen.findByText('Finalize Your Character')).toBeTruthy();
    expect(previewHitPoints()).toBe('14');
  });

  it('shows HP 10 for a level-1 Rogue whose final CON is 14 (half-orc, base CON 13)', async () => {
    // The N21-007 fixture: a rogue with CON 14. The wizard holds base
    // scores, so a half-orc (CON +1) with base CON 13 has final CON 14 —
    // the CON the saved sheet shows. Server level-1 HP: d8 max (8) + 2 = 10.
    renderAtStep(seedCharacter({}), 12);

    expect(await screen.findByText('Finalize Your Character')).toBeTruthy();
    expect(previewHitPoints()).toBe('10');
  });

  it('shows HP 10 for a level-1 Rogue with CON 14 and no racial CON bonus (high elf)', async () => {
    // Same final CON 14 reached without any racial bonus: elf grants
    // DEX +2 and high elf INT +1, so base CON 14 is the final CON 14.
    renderAtStep(
      seedCharacter({
        race: elf,
        subrace: highElf,
        abilityScores: abilityScores([10, 16, 14, 12, 11, 10]),
      }),
      12,
    );

    expect(await screen.findByText('Finalize Your Character')).toBeTruthy();
    expect(previewHitPoints()).toBe('10');
  });

  it('shows HP 8 for a level-1 Wizard (d6 hit die) with CON 14', async () => {
    // Second-class pin: the tile follows the class hit die, so a d6 class
    // with the same CON 14 shows 6 + 2 = 8, the server's value.
    renderAtStep(
      seedCharacter({
        name: 'Wizard Tester',
        race: elf,
        subrace: highElf,
        class: wizard,
        abilityScores: abilityScores([8, 14, 14, 16, 12, 10]),
      }),
      13,
    );

    expect(await screen.findByText('Finalize Your Character')).toBeTruthy();
    expect(previewHitPoints()).toBe('8');
  });

  it('shows HP 9 for a level-1 Draconic Bloodline Sorcerer with CON 14', async () => {
    // Draconic Resilience adds +1 HP at level 1, and the preview must pass
    // the flag through from the stored class-feature choice — the same
    // choice string ClassFeatureSelection dispatches and the server reads
    // back from class_features on create. d6 (6) + CON 2 + 1 = 9.
    renderAtStep(
      seedCharacter({
        name: 'Sorcerer Tester',
        race: elf,
        subrace: highElf,
        class: sorcerer,
        classFeatures: {
          'sorcerous-origin': {
            name: 'Sorcerous Origin',
            description:
              'Choose a sorcerous origin, which describes the source of your innate magical power.',
            choice:
              'Draconic Bloodline: Your innate magic comes from draconic magic that was mingled with your blood',
          },
        },
        abilityScores: abilityScores([8, 14, 14, 12, 11, 16]),
      }),
      12,
    );

    expect(await screen.findByText('Finalize Your Character')).toBeTruthy();
    expect(previewHitPoints()).toBe('9');
  });

  it('derives HP from the formula even when a stale stored hitPoints value is present', async () => {
    // No creation-flow producer writes character.hitPoints today (the
    // field exists only on the Character type). This seed pins the seam
    // anyway: the review step must never prefer a stored value — a stale
    // 13 sitting on the character cannot become the displayed HP.
    renderAtStep(seedCharacter({ hitPoints: { maximum: 13, current: 13, temporary: 0 } }), 12);

    expect(await screen.findByText('Finalize Your Character')).toBeTruthy();
    expect(previewHitPoints()).toBe('10');
  });
});
