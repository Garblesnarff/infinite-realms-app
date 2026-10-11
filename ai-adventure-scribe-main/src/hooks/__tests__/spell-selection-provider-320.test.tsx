/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #320 FIX-round tests — strategist items 2, 3, 4.
 *
 * Item 2: the REAL CharacterProvider is used (no useCharacter mock).
 *   - A Cleric (WIS 10 -> 1 prepared spell) ticks 1 prepared spell on the
 *     real Step 11 component: the auto-apply dispatches once (no toast
 *     flood) and validateStep('Advanced Spellcasting') passes — the gate
 *     the wizard's Continue button checks before advancing toward Finalize.
 *   - A High Elf Ranger picks one racial cantrip on the real SpellSelection
 *     step; the save payload carries the cantrip exactly once.
 * Item 3: High Elf Wizard — the bonus list equals the class list, so each
 *   pool's options exclude the other pool's picks (CR-012 double-pick).
 * Item 4: High Elf Ranger with a saved bonus cantrip — init puts it in the
 *   bonus pool, not the class pool.
 *
 * Fixture shapes follow the existing useSpellSelection.test.ts character
 * objects, which mirror the wizard's CharacterContext state. The spell list
 * fixtures follow the real spellApi.getClassSpells return shape
 * ({ cantrips, spells } of Spell objects).
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { useEffect } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { RenderResult } from '@testing-library/react';

import AdvancedSpellcastingSelection from '@/components/character-creation/steps/AdvancedSpellcastingSelection';
import SpellSelection from '@/components/character-creation/steps/SpellSelection';
import { validateStep } from '@/components/character-creation/wizard/wizard-validators';
import { CharacterProvider, useCharacter } from '@/contexts/CharacterContext';
import { useToast } from '@/hooks/use-toast';
import { useSpellSelection } from '@/hooks/useSpellSelection';
import { characterSpellService } from '@/services/characterSpellApi';
import { spellApi } from '@/services/spellApi';

vi.mock('@/services/spellApi', () => ({
  spellApi: {
    getClassSpells: vi.fn(),
  },
}));

vi.mock('@/services/characterSpellApi', () => ({
  characterSpellService: {
    saveCharacterSpells: vi.fn().mockResolvedValue({ success: true, message: 'Saved' }),
  },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(() => ({
    toast: vi.fn(),
    dismiss: vi.fn(),
    toasts: [],
  })),
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

const wizardCantrips = [
  { id: 'acid-splash', name: 'Acid Splash', level: 0, school: 'Conjuration' },
  { id: 'fire-bolt', name: 'Fire Bolt', level: 0, school: 'Evocation' },
  { id: 'light', name: 'Light', level: 0, school: 'Evocation' },
];

const clericSpells = [
  { id: 'bane', name: 'Bane', level: 1, school: 'Enchantment' },
  { id: 'bless', name: 'Bless', level: 1, school: 'Enchantment' },
  { id: 'cure-wounds', name: 'Cure Wounds', level: 1, school: 'Evocation' },
];

const clericClass = {
  id: 'cleric',
  name: 'Cleric',
  spellcasting: { ability: 'wisdom' },
};

const wizardClass = {
  id: 'wizard',
  name: 'Wizard',
  spellcasting: { ability: 'intelligence' },
};

const rangerClass = {
  id: 'ranger',
  name: 'Ranger',
};

const highElfSubrace = {
  id: 'high-elf',
  name: 'High Elf',
  bonusCantrip: { source: 'wizard', count: 1 },
};

const elfRace = { id: 'elf', name: 'Elf' };

const baseScores = {
  strength: { score: 10, modifier: 0 },
  dexterity: { score: 10, modifier: 0 },
  constitution: { score: 10, modifier: 0 },
  intelligence: { score: 10, modifier: 0 },
  wisdom: { score: 10, modifier: 0 },
  charisma: { score: 10, modifier: 0 },
};

/** Seeds the REAL provider by dispatching into its real reducer. */
function Seed({ character }: { character: any }): React.JSX.Element | null {
  const { dispatch } = useCharacter();
  useEffect(() => {
    dispatch({ type: 'SET_CHARACTER', payload: character });
  }, [dispatch, character]);
  return null;
}

/** Captures the latest context character into a ref. */
function Capture({ outRef }: { outRef: React.MutableRefObject<any> }): React.JSX.Element | null {
  const { state } = useCharacter();
  useEffect(() => {
    outRef.current = state.character;
  }, [state.character, outRef]);
  return null;
}

/** Exposes the live useSpellSelection return value. */
function HookProbe({ outRef }: { outRef: React.MutableRefObject<any> }): React.JSX.Element | null {
  const selection = useSpellSelection();
  outRef.current = selection;
  return null;
}

function renderWithProvider(
  character: any,
  ui: React.ReactElement,
  captureRef?: React.MutableRefObject<any>,
): RenderResult {
  return render(
    <CharacterProvider>
      <Seed character={character} />
      {captureRef ? <Capture outRef={captureRef} /> : null}
      {ui}
    </CharacterProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  (spellApi.getClassSpells as any).mockImplementation(async (className: string) => {
    const key = className.toLowerCase();
    if (key === 'wizard') return { cantrips: wizardCantrips, spells: [] };
    if (key === 'cleric') return { cantrips: [], spells: clericSpells };
    return { cantrips: [], spells: [] };
  });
});

describe('#320 item 2 — real CharacterProvider: Cleric prepares 1 spell on Step 11', () => {
  it('ticks 1 prepared spell, auto-applies once, and passes the Continue gate', async () => {
    const mockToast = vi.fn();
    (useToast as any).mockReturnValue({ toast: mockToast, dismiss: vi.fn(), toasts: [] });

    // WIS 10 -> maxPrepared = max(1, 1 + 0) = 1.
    const characterRef = { current: null as any };
    renderWithProvider(
      {
        id: 'char-cleric',
        level: 1,
        class: clericClass,
        abilityScores: baseScores,
        cantrips: [],
        knownSpells: [],
      },
      <AdvancedSpellcastingSelection />,
      characterRef as React.MutableRefObject<any>,
    );

    // Preparation tab is the default for a Cleric; wait for the spell list.
    await waitFor(() => {
      expect(screen.getByText('Bane')).toBeTruthy();
    });

    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.length).toBeGreaterThan(0);
    fireEvent.click(boxes[0]);

    // Step reports completion and the auto-apply fires exactly once —
    // through the real provider, the CR-003 toast flood would re-fire here.
    await waitFor(() => {
      expect(screen.getByText('All selections complete!')).toBeTruthy();
    });
    expect(mockToast).toHaveBeenCalledTimes(1);

    // The prepared pick landed in context (name form, per #2710).
    await waitFor(() => {
      expect(characterRef.current?.preparedSpells).toEqual(['Bane']);
    });

    // The wizard's Continue gate for this step passes.
    expect(validateStep('Advanced Spellcasting', characterRef.current).isValid).toBe(true);
  });
});

describe('#320 item 2 — real CharacterProvider: High Elf racial cantrip saves once', () => {
  it('picks one racial cantrip and the save payload carries it exactly once', async () => {
    const user = userEvent.setup();
    const characterRef = { current: null as any };
    renderWithProvider(
      {
        id: 'char-he-ranger',
        level: 1,
        class: rangerClass,
        race: elfRace,
        subrace: highElfSubrace,
        abilityScores: baseScores,
        cantrips: [],
        knownSpells: [],
      },
      <SpellSelection />,
      characterRef as React.MutableRefObject<any>,
    );

    // The bonus pick comes from the wizard list even though the class list
    // is empty for a non-spellcaster (CR-008).
    await user.click(screen.getByRole('tab', { name: /racial/i }));
    const card = await screen.findByRole('checkbox', { name: /acid splash/i });
    await user.click(card);

    await waitFor(() => {
      expect(characterSpellService.saveCharacterSpells).toHaveBeenCalledTimes(1);
    });

    const calls = (characterSpellService.saveCharacterSpells as any).mock.calls;
    for (const [, request] of calls) {
      const saved = (request.spells as string[]).filter((id) => id === 'acid-splash');
      expect(saved).toHaveLength(1);
    }
  });
});

describe('#320 item 3 — High Elf Wizard: no double-pick across pools', () => {
  it('each pool excludes cantrips already picked in the other pool', async () => {
    const probeRef = { current: null as any };
    render(
      <CharacterProvider>
        <Seed
          character={{
            id: 'char-he-wizard',
            level: 1,
            class: wizardClass,
            race: elfRace,
            subrace: highElfSubrace,
            abilityScores: baseScores,
            cantrips: [],
            knownSpells: [],
          }}
        />
        <HookProbe outRef={probeRef as React.MutableRefObject<any>} />
      </CharacterProvider>,
    );

    await waitFor(() => {
      expect(probeRef.current?.bonusCantripOptions).toHaveLength(3);
    });
    // Sanity: for a High Elf Wizard the bonus list IS the class list.
    expect(probeRef.current.bonusCantripOptions.map((s: any) => s.id).sort()).toEqual(
      probeRef.current.filteredCantrips.map((s: any) => s.id).sort(),
    );

    act(() => {
      probeRef.current.toggleCantrip('acid-splash');
    });
    expect(probeRef.current.filteredCantrips.map((s: any) => s.id)).toContain('acid-splash');
    expect(probeRef.current.bonusCantripOptions.map((s: any) => s.id)).not.toContain(
      'acid-splash',
    );

    act(() => {
      probeRef.current.toggleBonusCantrip('fire-bolt');
    });
    expect(probeRef.current.bonusCantripOptions.map((s: any) => s.id)).toContain('fire-bolt');
    expect(probeRef.current.filteredCantrips.map((s: any) => s.id)).not.toContain('fire-bolt');
  });
});

describe('#320 item 4 — saved bonus cantrip initializes in the bonus pool', () => {
  it('High Elf Ranger with a saved bonus cantrip does not put it in the class pool', async () => {
    const probeRef = { current: null as any };
    render(
      <CharacterProvider>
        <Seed
          character={{
            id: 'char-he-ranger-2',
            level: 1,
            class: rangerClass,
            race: elfRace,
            subrace: highElfSubrace,
            abilityScores: baseScores,
            // Saved from an earlier session: the one racial bonus pick.
            cantrips: ['acid-splash'],
            knownSpells: [],
          }}
        />
        <HookProbe outRef={probeRef as React.MutableRefObject<any>} />
      </CharacterProvider>,
    );

    await waitFor(() => {
      expect(probeRef.current?.selectedBonusCantrips).toEqual(['acid-splash']);
    });
    // A Ranger has no spellcastingInfo, so the class pool stays empty.
    expect(probeRef.current.selectedCantrips).toEqual([]);
  });
});
