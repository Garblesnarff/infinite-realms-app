import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DynamicOptionsSection } from '../DynamicOptionsSection';

import {
  requestCombatEntryAnswer,
  setCombatEntryConfirmationHost,
  settlePendingCombatEntryConfirmation,
} from '@/services/combat/combat-entry-confirmation-bridge';

const combat = vi.hoisted(() => ({
  isInCombat: false,
  activeEncounter: null as Record<string, never> | null,
}));
vi.mock('@/contexts/CombatContext', () => ({ useCombat: () => ({ state: combat }) }));
vi.mock('@/services/combat/combat-action-executor', () => ({
  executeAuthoritativeCombatIntent: vi.fn().mockResolvedValue({}),
  executeStructuredCombatActionWithBoundary: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/components/game/ActionOptions', () => ({
  ActionOptions: ({
    options,
    disabled,
    onOptionSelect,
  }: {
    options: { id: string; text: string }[];
    disabled?: boolean;
    onOptionSelect: (option: unknown) => void;
  }) => (
    <div>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          disabled={disabled}
          onClick={() => onOptionSelect(option)}
        >
          {option.text}
        </button>
      ))}
    </div>
  ),
}));

const OPTIONS = [
  { id: 'opt-1', number: 1, text: 'Ask the innkeeper', fullText: 'Ask the innkeeper' },
];

describe('DynamicOptionsSection while a fight prompt is open (#1678)', () => {
  it('disables the option chips until the prompt is answered, and a chip click sends nothing', async () => {
    const onOptionSelect = vi.fn(async () => {});
    setCombatEntryConfirmationHost({ present: () => () => {} });
    render(
      <DynamicOptionsSection
        options={OPTIONS}
        onOptionSelect={onOptionSelect}
        hasDynamicOverlay={false}
        isLatest
      />,
    );
    expect(screen.getByRole('button', { name: 'Ask the innkeeper' })).toBeEnabled();

    let answer!: Promise<unknown>;
    act(() => {
      answer = requestCombatEntryAnswer({
        actorLabel: 'Rook',
        combatantLabels: ['Goblin'],
        initiativeRoll: null,
        initiativeModifier: 1,
      });
    });
    expect(screen.getByRole('button', { name: 'Ask the innkeeper' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Ask the innkeeper' }));
    expect(onOptionSelect).not.toHaveBeenCalled();

    act(() => settlePendingCombatEntryConfirmation(false));
    await answer;
    expect(screen.getByRole('button', { name: 'Ask the innkeeper' })).toBeEnabled();
  });
});
