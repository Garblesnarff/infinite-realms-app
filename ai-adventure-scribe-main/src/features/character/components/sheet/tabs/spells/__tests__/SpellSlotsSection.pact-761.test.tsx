/**
 * #761: a single-class Warlock's slots are pact slots. 2014 Pact Magic recovers
 * on a short or long rest, so the pact block offers both sheet rests, Short Rest
 * first. With no sheet updater, that block keeps the Long Rest button. Other
 * casters keep Long Rest and get no pact label.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { Character, CharacterClass, CharacterSheetUpdateFn } from '@/types/character';

import { TooltipProvider } from '@/components/ui/tooltip';
import { classes } from '@/data/classes';
import SpellSlotsSection from '@/features/character/components/sheet/tabs/spells/SpellSlotsSection';
import SpellsTab from '@/features/character/components/sheet/tabs/SpellsTab';
import { restApi } from '@/services/rest-api';

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/services/characterSpellApi', () => ({
  characterSpellService: {
    isEnabled: vi.fn(() => false),
    getCharacterSpells: vi.fn(),
  },
}));
vi.mock('@/services/rest-api', () => ({
  restApi: { shortRest: vi.fn(), longRest: vi.fn(), attuneItem: vi.fn() },
  applyRestResultToCharacter: (character: Character): Character => character,
}));
vi.mock('@/lib/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const ability = (score: number): { score: number; modifier: number; savingThrow: boolean } => ({
  score,
  modifier: Math.floor((score - 10) / 2),
  savingThrow: false,
});

function makeCaster(
  classId: string,
  name: string,
  level: number,
  classLevels?: unknown,
): Character {
  return {
    id: `char-${classId}`,
    user_id: 'user-1',
    name,
    class: classes.find((c) => c.id === classId) as CharacterClass,
    classLevels,
    level,
    abilityScores: {
      strength: ability(10),
      dexterity: ability(10),
      constitution: ability(14),
      intelligence: ability(10),
      wisdom: ability(14),
      charisma: ability(16),
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
    spellSlots: { 1: { max: 2, current: 2 } },
  } as unknown as Character;
}

const shortRestResult = {
  characterId: 'char-warlock',
  restType: 'short' as const,
  hpRestored: 0,
  hitDiceRemaining: [],
  resourcesRestored: [],
  spellSlots: { '1': { max: 1, current: 1 } },
  pactSlots: null,
  classFeatures: [],
  restEventId: 'rest-1',
};

describe('#761 pact slot label on the sheet', () => {
  const onCharacterUpdate = vi.fn(async () => true) as unknown as CharacterSheetUpdateFn;

  beforeEach(() => {
    vi.mocked(restApi.shortRest).mockReset();
    vi.mocked(restApi.longRest).mockReset();
    vi.mocked(restApi.shortRest).mockResolvedValue(shortRestResult);
    vi.mocked(restApi.longRest).mockResolvedValue({ ...shortRestResult, restType: 'long' });
  });

  it('labels the pact row and shows the rests it is given, Short Rest first', () => {
    render(
      <TooltipProvider>
        <SpellSlotsSection
          spellSlots={{ 1: { total: 2, used: 0 } }}
          longRest={vi.fn()}
          resting={false}
          restError={null}
          pactSlotLevel={1}
          pactRest={
            <>
              <button type="button">Short Rest</button>
              <button type="button">Long Rest</button>
            </>
          }
        />
      </TooltipProvider>,
    );
    expect(
      screen.getByText('Pact Magic slots recover on a short or long rest'),
    ).toBeInTheDocument();
    const names = screen.getAllByRole('button').map((button) => button.textContent);
    expect(names).toEqual(['Short Rest', 'Long Rest']);
    expect(
      screen.queryByRole('button', { name: 'Recover all spell slots and sorcery points' }),
    ).toBeNull();
  });

  it('a pact row with no sheet rest falls back to Long Rest', async () => {
    const user = userEvent.setup();
    const longRest = vi.fn().mockResolvedValue(undefined);
    render(
      <TooltipProvider>
        <SpellSlotsSection
          spellSlots={{ 1: { total: 2, used: 0 } }}
          longRest={longRest}
          resting={false}
          restError={null}
          pactSlotLevel={1}
        />
      </TooltipProvider>,
    );
    expect(
      screen.getByText('Pact Magic slots recover on a short or long rest'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /short rest/i })).toBeNull();
    const button = screen.getByRole('button', {
      name: 'Recover all spell slots and sorcery points',
    });
    expect(button).toHaveTextContent('Long Rest');
    await user.click(button);
    expect(longRest).toHaveBeenCalledTimes(1);
  });

  it('a caster without pact slots keeps Long Rest', async () => {
    const user = userEvent.setup();
    const longRest = vi.fn().mockResolvedValue(undefined);
    render(
      <TooltipProvider>
        <SpellSlotsSection
          spellSlots={{ 1: { total: 2, used: 0 } }}
          longRest={longRest}
          resting={false}
          restError={null}
        />
      </TooltipProvider>,
    );
    expect(screen.queryByText(/Pact Magic/)).toBeNull();
    await user.click(
      screen.getByRole('button', { name: 'Recover all spell slots and sorcery points' }),
    );
    expect(longRest).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', { name: 'Recover all spell slots and sorcery points' }),
    ).toHaveTextContent('Long Rest');
  });

  it('a level-2 warlock takes a short rest and a long rest, Short Rest first', async () => {
    const user = userEvent.setup();
    render(
      <SpellsTab
        character={makeCaster('warlock', 'Test Warlock', 2)}
        onUpdate={() => {}}
        onCharacterUpdate={onCharacterUpdate}
      />,
    );
    await user.click(await screen.findByRole('tab', { name: /spell slots/i }, { timeout: 4000 }));
    expect(
      screen.getByText('Pact Magic slots recover on a short or long rest'),
    ).toBeInTheDocument();
    const restButtons = screen
      .getAllByRole('button')
      .filter((button) => /^(Short|Long) Rest$/.test((button.textContent ?? '').trim()));
    expect(restButtons.map((button) => button.textContent?.trim())).toEqual([
      'Short Rest',
      'Long Rest',
    ]);
    expect(
      screen.queryByRole('button', { name: 'Recover all spell slots and sorcery points' }),
    ).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Short Rest' }));
    await waitFor(() => {
      expect(restApi.shortRest).toHaveBeenCalledWith('char-warlock', 0);
    });
    await user.click(screen.getByRole('button', { name: 'Long Rest' }));
    await waitFor(() => {
      expect(restApi.longRest).toHaveBeenCalledWith('char-warlock');
    });
  });

  it('a warlock with no sheet updater keeps Long Rest', async () => {
    const user = userEvent.setup();
    render(<SpellsTab character={makeCaster('warlock', 'Test Warlock', 2)} onUpdate={() => {}} />);
    await user.click(await screen.findByRole('tab', { name: /spell slots/i }, { timeout: 4000 }));
    expect(
      screen.getByText('Pact Magic slots recover on a short or long rest'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Short Rest' })).toBeNull();
    const button = screen.getByRole('button', {
      name: 'Recover all spell slots and sorcery points',
    });
    expect(button).toHaveTextContent('Long Rest');
    await user.click(button);
    await waitFor(() => {
      expect(restApi.longRest).toHaveBeenCalledWith('char-warlock');
    });
    expect(restApi.shortRest).not.toHaveBeenCalled();
  });

  it('a warlock with hit dice gets the same short-rest prompt', async () => {
    const user = userEvent.setup();
    const character = {
      ...makeCaster('warlock', 'Test Warlock', 2),
      hitDice: { total: 2, remaining: 2, type: 'd8' },
    };
    render(
      <SpellsTab character={character} onUpdate={() => {}} onCharacterUpdate={onCharacterUpdate} />,
    );
    await user.click(await screen.findByRole('tab', { name: /spell slots/i }, { timeout: 4000 }));
    await user.click(screen.getByRole('button', { name: /short rest/i }));
    expect(screen.getByRole('group', { name: /spend hit dice/i })).toBeInTheDocument();
    expect(restApi.shortRest).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Take Short Rest' }));
    await waitFor(() => {
      expect(restApi.shortRest).toHaveBeenCalledWith('char-warlock', 0);
    });
  });

  it('a level-2 wizard keeps Long Rest and does not take a short rest', async () => {
    const user = userEvent.setup();
    render(<SpellsTab character={makeCaster('wizard', 'Test Wizard', 2)} onUpdate={() => {}} />);
    await user.click(await screen.findByRole('tab', { name: /spell slots/i }, { timeout: 4000 }));
    expect(screen.queryByText(/Pact Magic/)).toBeNull();
    const button = screen.getByRole('button', {
      name: 'Recover all spell slots and sorcery points',
    });
    expect(button).toHaveTextContent('Long Rest');
    await user.click(button);
    await waitFor(() => {
      expect(restApi.longRest).toHaveBeenCalledWith('char-wizard');
    });
    expect(restApi.shortRest).not.toHaveBeenCalled();
  });

  it('a multiclass warlock gets no pact label (server treats only single-class warlocks as pact rows)', async () => {
    const user = userEvent.setup();
    const character = makeCaster('warlock', 'Multi', 2, [
      { className: 'Warlock', level: 1 },
      { className: 'Wizard', level: 1 },
    ]);
    render(<SpellsTab character={character} onUpdate={() => {}} />);
    await user.click(await screen.findByRole('tab', { name: /spell slots/i }, { timeout: 4000 }));
    expect(screen.queryByText(/Pact Magic/)).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Recover all spell slots and sorcery points' }),
    ).toHaveTextContent('Long Rest');
  });
});
