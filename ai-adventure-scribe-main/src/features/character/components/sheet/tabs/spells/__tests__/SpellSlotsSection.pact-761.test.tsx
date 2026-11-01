/**
 * #761 remainder: a single-class Warlock's slots are pact slots and are labelled
 * 'Pact Magic — recovers on a Short Rest'. Other casters get no pact label.
 * Long Rest keeps its line: the server's long rest restores every slot row,
 * pact rows included (rest-service.ts, takeLongRest).
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import type { Character, CharacterClass } from '@/types/character';

import { TooltipProvider } from '@/components/ui/tooltip';
import { classes } from '@/data/classes';
import SpellSlotsSection from '@/features/character/components/sheet/tabs/spells/SpellSlotsSection';
import SpellsTab from '@/features/character/components/sheet/tabs/SpellsTab';

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

function makeCaster(classId: string, name: string, level: number, classLevels?: unknown): Character {
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

describe('#761 pact slot label on the sheet', () => {
  it('labels the pact row on a single-class warlock', () => {
    render(
      <TooltipProvider>
        <SpellSlotsSection
          spellSlots={{ 1: { total: 2, used: 0 } }}
          longRest={vi.fn()}
          resting={false}
          restError={null}
          pactSlotLevel={1}
        />
      </TooltipProvider>,
    );
    expect(screen.getByText('Pact Magic — recovers on a Short Rest')).toBeInTheDocument();
  });

  it('shows no pact label when there is no pact slot level', () => {
    render(
      <TooltipProvider>
        <SpellSlotsSection
          spellSlots={{ 1: { total: 2, used: 0 } }}
          longRest={vi.fn()}
          resting={false}
          restError={null}
        />
      </TooltipProvider>,
    );
    expect(screen.queryByText(/Pact Magic/)).toBeNull();
  });

  it('the sheet passes the pact level for a level-2 warlock', async () => {
    const user = userEvent.setup();
    render(<SpellsTab character={makeCaster('warlock', 'Test Warlock', 2)} onUpdate={() => {}} />);
    await user.click(await screen.findByRole('tab', { name: /spell slots/i }, { timeout: 4000 }));
    expect(screen.getByText('Pact Magic — recovers on a Short Rest')).toBeInTheDocument();
    // Long Rest keeps its line.
    expect(
      screen.getByRole('button', { name: 'Recover all spell slots and sorcery points' }),
    ).toBeInTheDocument();
  });

  it('a level-2 wizard gets no pact label', async () => {
    const user = userEvent.setup();
    render(<SpellsTab character={makeCaster('wizard', 'Test Wizard', 2)} onUpdate={() => {}} />);
    await user.click(await screen.findByRole('tab', { name: /spell slots/i }, { timeout: 4000 }));
    expect(screen.queryByText(/Pact Magic/)).toBeNull();
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
  });
});
