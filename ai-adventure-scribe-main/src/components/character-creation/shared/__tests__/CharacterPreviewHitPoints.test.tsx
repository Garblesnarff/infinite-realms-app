import { render, screen, waitFor } from '@testing-library/react';
import React, { useEffect } from 'react';
import { describe, it, expect, vi } from 'vitest';

import { findSrdClass } from '../../../../../shared/srd-class-data';
import CharacterPreview from '../CharacterPreview';

import type { AbilityScores, CharacterClass } from '@/types/character';

import { CharacterProvider, useCharacter } from '@/contexts/CharacterContext';
import { cleric } from '@/data/classes/cleric';
import { fighter } from '@/data/classes/fighter';
import { dwarf } from '@/data/races/dwarf';
import { applyRacialBonusesToAbilityScores } from '@/utils/racialAbilityBonuses';


vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// #389: the creation summary must show a labeled HP that matches what the
// save will store. Fixture follows the wizard's Character shape: base ability
// scores (all 10, as the wizard holds before racial bonuses) with race/subrace
// as objects, using the real dwarf / subrace / class data.
const baseScores: AbilityScores = {
  strength: { score: 10, modifier: 0, savingThrow: false },
  dexterity: { score: 10, modifier: 0, savingThrow: false },
  constitution: { score: 10, modifier: 0, savingThrow: false },
  intelligence: { score: 10, modifier: 0, savingThrow: false },
  wisdom: { score: 10, modifier: 0, savingThrow: false },
  charisma: { score: 10, modifier: 0, savingThrow: false },
};

function SeedPreview({
  name,
  subraceId,
  characterClass,
}: {
  name: string;
  subraceId: string;
  characterClass: CharacterClass | null;
}): React.ReactElement {
  const { dispatch } = useCharacter();

  useEffect(() => {
    dispatch({
      type: 'SET_CHARACTER',
      payload: {
        name,
        race: dwarf,
        subrace: dwarf.subraces?.find((s) => s.id === subraceId),
        class: characterClass,
        level: 1,
        abilityScores: baseScores,
      },
    });
  }, [dispatch, name, subraceId, characterClass]);

  return <CharacterPreview />;
}

/** The value cell for a labeled stat in the Combat Stats section. */
const cellTextFor = (label: string): string => {
  const labelEl = screen.getByText(label);
  const cell = labelEl.closest('div.text-center');
  if (!cell) throw new Error(`stat cell missing for ${label}`);
  return cell.textContent ?? '';
};

/**
 * #620: the server is the save-time HP producer now — class hit die + CON
 * modifier + Dwarven Toughness. The preview must show exactly this number.
 */
const expectedSaveHp = (subraceId: string, className: string): number => {
  const subrace = dwarf.subraces?.find((s) => s.id === subraceId) ?? null;
  const finalScores = applyRacialBonusesToAbilityScores(baseScores, dwarf, subrace);
  const hitDie = findSrdClass(className)?.hitDie;
  if (typeof hitDie !== 'number') throw new Error(`no hit die for ${className}`);
  const toughnessBonus = [...(dwarf.traits ?? []), ...(subrace?.traits ?? [])].includes(
    'Dwarven Toughness',
  )
    ? 1
    : 0;
  return hitDie + (finalScores.constitution?.modifier ?? 0) + toughnessBonus;
};

describe('CharacterPreview HP label (#389)', () => {
  it('shows a labeled HP matching the save for a Hill Dwarf Cleric', async () => {
    render(
      <CharacterProvider>
        <SeedPreview name="Hill Dwarf Cleric" subraceId="hill-dwarf" characterClass={cleric} />
      </CharacterProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Hill Dwarf Cleric')).toBeInTheDocument();
    });

    // Issue #389 expected: Cleric L1 HP 10 (8 hit die + CON mod 1 + Dwarven Toughness 1).
    expect(expectedSaveHp('hill-dwarf', 'Cleric')).toBe(10);

    const hpCell = cellTextFor('HP');
    expect(hpCell).toContain('HP');
    expect(hpCell).toContain('10');
  });

  it('omits the Dwarven Toughness bonus for a Mountain Dwarf Fighter', async () => {
    render(
      <CharacterProvider>
        <SeedPreview
          name="Mountain Dwarf Fighter"
          subraceId="mountain-dwarf"
          characterClass={fighter}
        />
      </CharacterProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Mountain Dwarf Fighter')).toBeInTheDocument();
    });

    // 10 hit die + CON mod 1, no toughness: 11.
    expect(expectedSaveHp('mountain-dwarf', 'Fighter')).toBe(11);

    const hpCell = cellTextFor('HP');
    expect(hpCell).toContain('11');
  });

  it('shows a missing-HP marker instead of inventing a number with no class', async () => {
    render(
      <CharacterProvider>
        <SeedPreview name="Classless Dwarf" subraceId="hill-dwarf" characterClass={null} />
      </CharacterProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('Classless Dwarf')).toBeInTheDocument();
    });

    const hpCell = cellTextFor('HP');
    expect(hpCell).toContain('—');
    expect(hpCell).not.toMatch(/\d/);
  });
});
