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

const OPTIONS = [
  { id: 'opt-1', number: 1, text: 'Ask the innkeeper', fullText: 'Ask the innkeeper' },
];
const CHIP = /Option 1 - Ask the innkeeper/;

describe('option chips with the real ActionOptions while a fight prompt is open (#1678)', () => {
  it('disables each chip, shows the reason, and re-enables both once the prompt is answered', async () => {
    const onOptionSelect = vi.fn(async () => {});
    setCombatEntryConfirmationHost({ present: () => () => {} });
    render(
      <DynamicOptionsSection
        options={OPTIONS}
        onOptionSelect={onOptionSelect}
        hasDynamicOverlay={false}
        isLatest
        showImmediately
      />,
    );
    expect(await screen.findByRole('button', { name: CHIP })).toBeEnabled();
    expect(screen.queryByText('Answer the fight question first.')).not.toBeInTheDocument();

    let answer!: Promise<unknown>;
    act(() => {
      answer = requestCombatEntryAnswer({
        actorLabel: 'Rook',
        combatantLabels: ['Goblin'],
        initiativeRoll: null,
        initiativeModifier: 1,
      });
    });

    expect(screen.getByRole('button', { name: CHIP })).toBeDisabled();
    expect(screen.getByText('Answer the fight question first.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: CHIP }));
    expect(onOptionSelect).not.toHaveBeenCalled();

    act(() => settlePendingCombatEntryConfirmation(false));
    await answer;
    expect(screen.getByRole('button', { name: CHIP })).toBeEnabled();
    expect(screen.queryByText('Answer the fight question first.')).not.toBeInTheDocument();
  });
});
