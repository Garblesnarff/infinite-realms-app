import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MessageRenderer } from '../MessageRenderer';

const combat = vi.hoisted(() => ({
  isInCombat: true,
  activeEncounter: {
    id: 'encounter-1',
    currentTurnParticipantId: 'player-1',
    participants: [{ id: 'player-1', participantType: 'player' }],
  },
}));

vi.mock('@/contexts/CombatContext', () => ({ useCombat: () => ({ state: combat }) }));
vi.mock('../DMMessage', () => ({
  DMMessage: ({ displayContent }: { displayContent: string }) => <p>{displayContent}</p>,
}));
vi.mock('@/components/game/ActionOptions', () => ({
  ActionOptions: ({ options }: { options: Array<{ text: string }> }) => (
    <div data-testid="action-options">
      {options.map((option) => (
        <button key={option.text}>{option.text}</button>
      ))}
    </div>
  ),
}));

describe('combat options after a non-action notice', () => {
  // #90: the current turn's actions live in the ActionBar above the chat box (see
  // CombatActionBar.test.tsx, same legal-action fixture), so a notice in the list renders none.
  it('renders no option group under the notice while an encounter is active', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        actorId: 'player-1',
        actions: [
          { type: 'move', label: 'Move (30 ft remaining)' },
          { type: 'attack', label: 'Attack with Quarterstaff (move closer first)' },
          { type: 'dash', label: 'Dash' },
          { type: 'dodge', label: 'Dodge' },
          { type: 'disengage', label: 'Disengage' },
          { type: 'end_turn', label: 'End turn' },
        ],
      }),
    } as Response);

    render(
      <MessageRenderer
        message={{
          text: '(That was not a combat action — nothing was rolled. It is still your turn.)',
          sender: 'dm',
        }}
        messageId="notice-1"
        groupIndex={0}
        msgIndex={0}
        isFirstInGroup
        isLastInGroup
        isPlayer={false}
        isDM
        isCompanion={false}
        encounterActive
        expandedMessages={new Set()}
        setExpandedMessages={vi.fn() as never}
        imageByMessage={{}}
        generatingFor={new Set()}
        genErrorByMessage={{}}
        onGenerateScene={vi.fn().mockResolvedValue(undefined)}
        onOptionSelect={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/That was not a combat action/)).toBeInTheDocument();
    });
    expect(screen.queryByTestId('action-options')).not.toBeInTheDocument();
    expect(screen.queryByText('Move (30 ft remaining)')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Attack with Quarterstaff (move closer first)'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('End turn')).not.toBeInTheDocument();
    // Nothing asked the engine for a menu the list will not show.
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
