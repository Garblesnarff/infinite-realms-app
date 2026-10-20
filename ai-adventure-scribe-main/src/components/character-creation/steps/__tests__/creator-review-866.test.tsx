import { fireEvent, render, screen, within } from '@testing-library/react';
import React, { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import AbilityScoresSelection from '../AbilityScoresSelection';
import CharacterFinalization from '../CharacterFinalization';
import EquipmentSelection from '../EquipmentSelection';

import type { Character } from '@/types/character';

import { backgrounds } from '@/data/backgroundOptions';
import { fighter } from '@/data/classes/fighter';
import { halfElf } from '@/data/races/half-elf';

const context = vi.hoisted(() => ({ value: {} as any }));
vi.mock('@/contexts/CharacterContext', () => ({ useCharacter: () => context.value }));
vi.mock('@/hooks/use-auto-scroll', () => ({
  useAutoScroll: () => ({ scrollToNavigation: vi.fn() }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock(
  '@/components/character-creation/steps/character-finalization/use-character-finalization',
  () => ({
    useCharacterFinalization: () => ({
      state: context.value.state,
      selectedTheme: 'classic',
      generationStep: 'idle',
      imageQuota: null,
    }),
  }),
);
function Harness({ children }: { children: React.ReactNode }) {
  const [character, setCharacter] = useState({
    class: fighter,
    race: halfElf,
    level: 1,
    background: backgrounds.find((b) => b.id === 'outlander'),
    name: 'Review',
    description: 'A guard',
    abilityScoreMethod: 'standardArray',
    racialAbilityChoices: { halfElf: ['dexterity', 'constitution'] },
    abilityScores: Object.fromEntries(
      Object.entries({
        strength: 15,
        dexterity: 14,
        constitution: 12,
        intelligence: 13,
        wisdom: 8,
        charisma: 10,
      }).map(([a, score]) => [
        a,
        { score, modifier: Math.floor((score - 10) / 2), savingThrow: false },
      ]),
    ),
    equipment: ['Chain Mail', 'Shield'],
    fightingStyles: ['Defense'],
  } as unknown as Character);
  context.value = {
    state: { character },
    dispatch: (action: any) => setCharacter((old) => ({ ...old, ...action.payload })),
  };
  return <>{children}</>;
}
describe('#866 creator controls and review', () => {
  it('assigns 15 to DEX by swapping and preserves the exact standard array', () => {
    render(
      <Harness>
        <AbilityScoresSelection />
      </Harness>,
    );
    fireEvent.change(screen.getByLabelText('Assign standard array dexterity'), {
      target: { value: '15' },
    });
    expect(context.value.state.character.abilityScores.dexterity.score).toBe(15);
    expect(context.value.state.character.abilityScores.strength.score).toBe(14);
    expect(
      Object.values(context.value.state.character.abilityScores)
        .map((a: any) => a.score)
        .sort((a, b) => b - a),
    ).toEqual([15, 14, 13, 12, 10, 8]);
  });
  it('identifies Staff and 10 gp as Outlander gear, separate from the Fighter package', () => {
    render(
      <Harness>
        <EquipmentSelection />
      </Harness>,
    );
    const background = within(screen.getByRole('region', { name: 'Background equipment' }));
    expect(background.getByText('Staff')).toBeInTheDocument();
    expect(background.getByText('10 gp')).toBeInTheDocument();
    const packageCard = screen.getByText('Fighter Equipment Package').closest('[role="button"]')!;
    expect(within(packageCard as HTMLElement).queryByText('Staff')).not.toBeInTheDocument();
    fireEvent.click(packageCard);
    expect(context.value.state.character.currency.gp).toBe(0);
    expect(
      context.value.state.character.equipment.filter((name: string) => name === 'Staff'),
    ).toHaveLength(1);
  });
  it('shows post-racial scores, creation AC and speed on finalization', () => {
    render(
      <Harness>
        <CharacterFinalization />
      </Harness>,
    );
    const review = within(screen.getByRole('region', { name: 'Final character statistics' }));
    expect(review.getByText('dexterity').closest('.justify-between')).toHaveTextContent('15');
    expect(review.getByText('constitution').closest('.justify-between')).toHaveTextContent('13');
    expect(review.getByText('charisma').closest('.justify-between')).toHaveTextContent('12');
    expect(review.getByText(/Armor Class:/)).toHaveTextContent('19');
    expect(review.getByText(/Speed:/)).toHaveTextContent('30 ft');
  });
});
