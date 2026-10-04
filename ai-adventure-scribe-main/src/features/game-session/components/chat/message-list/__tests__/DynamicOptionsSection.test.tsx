import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';

import { DynamicOptionsSection } from '../DynamicOptionsSection';

import { executeAuthoritativeCombatIntent } from '@/services/combat/combat-action-executor';

const combat = vi.hoisted(() => ({ isInCombat: false, activeEncounter: null as any }));
vi.mock('@/contexts/CombatContext', () => ({ useCombat: () => ({ state: combat }) }));
vi.mock('@/services/combat/combat-action-executor', () => ({
  executeAuthoritativeCombatIntent: vi.fn().mockResolvedValue({}),
}));

// Mock the dependent component
vi.mock('@/components/game/ActionOptions', () => ({
  ActionOptions: ({ options, onOptionSelect }: { options: any[]; onOptionSelect: any }) => (
    <div data-testid="action-options">
      {options.map((opt, i) => (
        <button key={i} onClick={() => onOptionSelect(opt)}>
          {opt.text}
        </button>
      ))}
    </div>
  ),
}));

describe('DynamicOptionsSection', () => {
  const mockOptions = [
    { id: '1', text: 'Option 1', number: 1 },
    { id: '2', text: 'Option 2', number: 2 },
  ];
  const mockOnOptionSelect = vi.fn();

  beforeEach(() => {
    combat.isInCombat = false;
    combat.activeEncounter = null;
    vi.restoreAllMocks();
  });

  it('renders correctly when options are provided', () => {
    const { getByTestId, getByText } = render(
      <DynamicOptionsSection
        options={mockOptions as any}
        onOptionSelect={mockOnOptionSelect}
        hasDynamicOverlay={false}
      />,
    );

    expect(getByTestId('action-options')).toBeDefined();
    expect(getByText('Option 1')).toBeDefined();
  });

  it('returns null when no options are provided', () => {
    const { container } = render(
      <DynamicOptionsSection
        options={[]}
        onOptionSelect={mockOnOptionSelect}
        hasDynamicOverlay={false}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('calls onOptionSelect when an option is clicked', () => {
    const { getByText } = render(
      <DynamicOptionsSection
        options={mockOptions as any}
        onOptionSelect={mockOnOptionSelect}
        hasDynamicOverlay={false}
      />,
    );

    fireEvent.click(getByText('Option 1'));
    expect(mockOnOptionSelect).toHaveBeenCalled();
  });

  it('adjusts delay based on hasDynamicOverlay', () => {
    // This is hard to test directly as delay is passed to the mocked ActionOptions,
    // but we can at least ensure it renders in both cases.
    const { rerender, getByTestId } = render(
      <DynamicOptionsSection
        options={mockOptions as any}
        onOptionSelect={mockOnOptionSelect}
        hasDynamicOverlay={false}
      />,
    );
    expect(getByTestId('action-options')).toBeDefined();

    rerender(
      <DynamicOptionsSection
        options={mockOptions as any}
        onOptionSelect={mockOnOptionSelect}
        hasDynamicOverlay={true}
      />,
    );
    expect(getByTestId('action-options')).toBeDefined();
  });

  it('is memoized', () => {
    const { rerender, getByText } = render(
      <DynamicOptionsSection
        options={mockOptions as any}
        onOptionSelect={mockOnOptionSelect}
        hasDynamicOverlay={false}
      />,
    );

    rerender(
      <DynamicOptionsSection
        options={mockOptions as any}
        onOptionSelect={mockOnOptionSelect}
        hasDynamicOverlay={false}
      />,
    );

    expect(getByText('Option 1')).toBeDefined();
  });

  it('replaces narration exploration options with server legal actions during combat', async () => {
    combat.isInCombat = true;
    combat.activeEncounter = {
      id: 'enc-1',
      currentTurnParticipantId: 'pc-1',
      participants: [{ id: 'pc-1', participantType: 'player' }],
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ actorId: 'pc-1', actions: [{ type: 'dodge', label: 'Dodge' }] }),
    } as Response);
    const { queryByText, getByText } = render(
      <DynamicOptionsSection
        options={mockOptions as any}
        onOptionSelect={mockOnOptionSelect}
        hasDynamicOverlay={false}
      />,
    );
    await waitFor(() => expect(getByText('Dodge')).toBeDefined());
    expect(queryByText('Option 1')).toBeNull();
  });

  it('posts a planned Move to the engine and leaves DM text out of the action path', async () => {
    combat.isInCombat = true;
    combat.activeEncounter = {
      id: 'enc-1',
      currentTurnParticipantId: 'pc-1',
      participants: [{ id: 'pc-1', participantType: 'player' }],
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        actorId: 'pc-1',
        actions: [{ type: 'move', label: 'Move (30 ft remaining)', x: 6, y: 0 }],
      }),
    } as Response);
    const onOptionSelect = vi.fn().mockResolvedValue(undefined);
    render(
      <DynamicOptionsSection
        options={[]}
        onOptionSelect={onOptionSelect}
        hasDynamicOverlay={false}
      />,
    );
    fireEvent.click(await screen.findByText('Move (30 ft remaining)'));
    await waitFor(() =>
      expect(executeAuthoritativeCombatIntent).toHaveBeenCalledWith(
        'enc-1',
        { type: 'move', actorId: 'pc-1', x: 6, y: 0 },
        'dm',
        expect.any(Number),
        'typed',
      ),
    );
    expect(onOptionSelect).not.toHaveBeenCalled();
  });
});
