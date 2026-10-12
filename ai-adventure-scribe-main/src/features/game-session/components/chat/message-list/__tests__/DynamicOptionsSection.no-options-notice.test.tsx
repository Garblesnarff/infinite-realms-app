import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DynamicOptionsSection } from '../DynamicOptionsSection';

const combat = vi.hoisted(() => ({ isInCombat: false, activeEncounter: null as any }));
vi.mock('@/contexts/CombatContext', () => ({ useCombat: () => ({ state: combat }) }));
vi.mock('@/services/combat/combat-action-executor', () => ({
  executeAuthoritativeCombatIntent: vi.fn().mockResolvedValue({}),
  executeStructuredCombatActionWithBoundary: vi.fn().mockResolvedValue({}),
}));

// Mock the dependent component
vi.mock('@/components/game/ActionOptions', () => ({
  ActionOptions: ({ options }: { options: any[] }) => (
    <div data-testid="action-options">
      {options.map((opt, i) => (
        <button key={i}>{opt.text}</button>
      ))}
    </div>
  ),
}));

describe('DynamicOptionsSection no-action-options notice (GP-015, #219)', () => {
  const mockOnOptionSelect = vi.fn();

  beforeEach(() => {
    combat.isInCombat = false;
    combat.activeEncounter = null;
    vi.restoreAllMocks();
  });

  it('renders an explicit notice for the latest narration turn with no choices', () => {
    render(
      <DynamicOptionsSection
        options={[]}
        onOptionSelect={mockOnOptionSelect}
        hasDynamicOverlay={false}
        isLatest
        showNoOptionsNotice
      />,
    );

    expect(screen.getByTestId('no-action-options-notice')).toBeInTheDocument();
  });

  it('stays silent for a past message even when the turn had no choices', () => {
    const { container } = render(
      <DynamicOptionsSection
        options={[]}
        onOptionSelect={mockOnOptionSelect}
        hasDynamicOverlay={false}
        isLatest={false}
        showNoOptionsNotice
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the turn had no choices and no notice was requested', () => {
    const { container } = render(
      <DynamicOptionsSection
        options={[]}
        onOptionSelect={mockOnOptionSelect}
        hasDynamicOverlay={false}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders the choices, not the notice, when choices exist', () => {
    render(
      <DynamicOptionsSection
        options={[{ id: '1', text: 'Sneak past the guards', number: 1 }] as any}
        onOptionSelect={mockOnOptionSelect}
        hasDynamicOverlay={false}
        isLatest
        showNoOptionsNotice
      />,
    );

    expect(screen.getByTestId('action-options')).toBeInTheDocument();
    expect(screen.getByText('Sneak past the guards')).toBeInTheDocument();
    expect(screen.queryByTestId('no-action-options-notice')).not.toBeInTheDocument();
  });

  it('never shows the notice while the combat menu owns the slot', () => {
    combat.isInCombat = true;
    combat.activeEncounter = {
      id: 'encounter-1',
      currentTurnParticipantId: 'player-1',
      participants: [{ id: 'player-1', participantType: 'player' }],
    } as any;
    // The combat menu fetches legal actions; stub it so no real request escapes.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ actorId: 'player-1', actions: [] }),
    } as Response);
    render(
      <DynamicOptionsSection
        options={[]}
        onOptionSelect={mockOnOptionSelect}
        hasDynamicOverlay={false}
        isLatest
        showNoOptionsNotice
      />,
    );

    expect(screen.queryByTestId('no-action-options-notice')).not.toBeInTheDocument();
  });
});
