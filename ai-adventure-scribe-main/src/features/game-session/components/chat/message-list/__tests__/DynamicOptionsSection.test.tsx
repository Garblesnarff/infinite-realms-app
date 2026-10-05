import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { DynamicOptionsSection, fetchLegalActions } from '../DynamicOptionsSection';

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

  afterEach(() => {
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

  it('shares one in-flight GET across three callers for one encounter turn', async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    const response = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockReturnValue(response);

    const requests = [
      fetchLegalActions('enc-1', 'pc-1', 3),
      fetchLegalActions('enc-1', 'pc-1', 3),
      fetchLegalActions('enc-1', 'pc-1', 3),
    ];
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v1/combat/enc-1/legal-actions'),
      expect.objectContaining({ headers: expect.anything() }),
    );

    resolveResponse?.(
      new Response(
        JSON.stringify({ actorId: 'pc-1', actions: [{ type: 'dodge', label: 'Dodge' }] }),
        {
          status: 200,
        },
      ),
    );
    await expect(Promise.all(requests)).resolves.toEqual([
      { actorId: 'pc-1', actions: [{ type: 'dodge', label: 'Dodge' }] },
      { actorId: 'pc-1', actions: [{ type: 'dodge', label: 'Dodge' }] },
      { actorId: 'pc-1', actions: [{ type: 'dodge', label: 'Dodge' }] },
    ]);
  });

  it('starts a new GET for a forced refresh after an action while one is in flight', async () => {
    let resolveFirst: ((response: Response) => void) | undefined;
    const firstResponse = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValue({
        ok: true,
        json: async () => ({ actorId: 'pc-1', actions: [{ type: 'dash', label: 'Dash' }] }),
      } as Response);

    const inFlight = fetchLegalActions('enc-1', 'pc-1', 3);
    const afterAction = fetchLegalActions('enc-1', 'pc-1', 3, { force: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(afterAction).resolves.toEqual({
      actorId: 'pc-1',
      actions: [{ type: 'dash', label: 'Dash' }],
    });

    resolveFirst?.(
      new Response(JSON.stringify({ actorId: 'pc-1', actions: [] }), { status: 200 }),
    );
    await expect(inFlight).resolves.toEqual({ actorId: 'pc-1', actions: [] });
  });

  it('starts a new GET when the round or actor key changes', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ actorId: 'pc-1', actions: [] }),
    } as Response);

    await Promise.all([
      fetchLegalActions('enc-1', 'pc-1', 3),
      fetchLegalActions('enc-1', 'pc-1', 4),
      fetchLegalActions('enc-1', 'pc-2', 3),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('clears the in-flight entry after a rejected GET so the next call re-fetches', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValue({
        ok: true,
        json: async () => ({ actorId: 'pc-1', actions: [{ type: 'dodge', label: 'Dodge' }] }),
      } as Response);

    await expect(fetchLegalActions('enc-1', 'pc-1', 3)).rejects.toThrow('network down');
    await expect(fetchLegalActions('enc-1', 'pc-1', 3)).resolves.toEqual({
      actorId: 'pc-1',
      actions: [{ type: 'dodge', label: 'Dodge' }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('drops a stale non-forced GET that lands after the forced post-action refresh', async () => {
    combat.isInCombat = true;
    const encounter = (round: number) => ({
      id: 'enc-1',
      currentTurnParticipantId: 'pc-1',
      currentRound: round,
      participants: [{ id: 'pc-1', participantType: 'player' }],
    });
    combat.activeEncounter = encounter(3);
    const deferreds: Array<(response: Response) => void> = [];
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(
        () =>
          new Promise<Response>((resolve) => {
            deferreds.push(resolve);
          }),
      );
    const okJson = (actions: Array<{ type: string; label: string }>) =>
      new Response(JSON.stringify({ actorId: 'pc-1', actions }), { status: 200 });

    const { rerender } = render(
      <DynamicOptionsSection
        options={[]}
        onOptionSelect={vi.fn().mockResolvedValue(undefined)}
        hasDynamicOverlay={false}
      />,
    );
    // The mount GET resolves with the old options so an option is on screen
    // to click.
    deferreds[0]?.(okJson([{ type: 'dash', label: 'Dash (old)' }]));
    fireEvent.click(await screen.findByText('Dash (old)'));

    // A second non-forced GET starts (new round) and stays pending; the
    // click's forced post-action refresh is issued after it and resolves
    // first with new options.
    combat.activeEncounter = encounter(4);
    rerender(
      <DynamicOptionsSection
        options={[]}
        onOptionSelect={vi.fn().mockResolvedValue(undefined)}
        hasDynamicOverlay={false}
      />,
    );
    await waitFor(() => expect(deferreds.length).toBe(3));
    deferreds[2]?.(okJson([{ type: 'dash', label: 'Dash' }]));
    await waitFor(() => expect(screen.getByText('Dash')).toBeDefined());

    // The stale GET lands last with the old options: it must not overwrite.
    deferreds[1]?.(okJson([{ type: 'dash', label: 'Dash (old)' }]));
    await waitFor(() => expect(screen.queryByText('Dash (old)')).toBeNull());
    expect(screen.getByText('Dash')).toBeDefined();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/v1/combat/enc-1/legal-actions'),
      expect.anything(),
    );
  });
});
