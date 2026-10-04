import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MessageRenderer } from '../MessageRenderer';
import { SystemMessage } from '../SystemMessage';

const combat = vi.hoisted(() => ({
  isInCombat: true,
  activeEncounter: {
    id: 'encounter-1',
    currentTurnParticipantId: 'player-1',
    participants: [{ id: 'player-1', participantType: 'player' }],
  },
}));
vi.mock('@/contexts/CombatContext', () => ({ useCombat: () => ({ state: combat }) }));
vi.mock('@/components/game/ActionOptions', () => ({
  ActionOptions: ({ options }: { options: Array<{ text: string }> }) => (
    <div data-testid="action-options">
      {options.map((option) => (
        <button key={option.text}>{option.text}</button>
      ))}
    </div>
  ),
}));

describe('SystemMessage', () => {
  it('renders a local combat notice as a visible status line', () => {
    render(
      <SystemMessage
        message={{
          text: 'Combat entry could not be confirmed (no confirmation UI)',
          sender: 'system',
        }}
        isFirstInGroup
        isLastInGroup
        displayText="Combat entry could not be confirmed (no confirmation UI)"
      />,
    );

    expect(screen.getByRole('status', { name: 'System message' })).toHaveTextContent(
      'Combat entry could not be confirmed (no confirmation UI)',
    );
  });

  it('routes a system-sender chat message through the visible system renderer', () => {
    render(
      <MessageRenderer
        message={{ text: 'The encounter was seated.', sender: 'system' }}
        messageId="system-1"
        groupIndex={0}
        msgIndex={0}
        isFirstInGroup
        isLastInGroup
        isPlayer={false}
        isDM={false}
        isCompanion={false}
        expandedMessages={new Set()}
        setExpandedMessages={vi.fn() as never}
        imageByMessage={{}}
        generatingFor={new Set()}
        genErrorByMessage={{}}
        onGenerateScene={vi.fn().mockResolvedValue(undefined)}
        onOptionSelect={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByRole('status', { name: 'System message' })).toHaveTextContent(
      'The encounter was seated.',
    );
  });

  it('keeps the combat menu mounted after a persisted system notice', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        actorId: 'player-1',
        actions: [{ type: 'end_turn', label: 'End turn' }],
      }),
    } as Response);
    render(
      <MessageRenderer
        message={{ text: 'That was not a combat action.', sender: 'system' }}
        messageId="system-notice"
        groupIndex={0}
        msgIndex={0}
        isFirstInGroup
        isLastInGroup
        isPlayer={false}
        isDM={false}
        isCompanion={false}
        combatOptionsVisible
        expandedMessages={new Set()}
        setExpandedMessages={vi.fn() as never}
        imageByMessage={{}}
        generatingFor={new Set()}
        genErrorByMessage={{}}
        onGenerateScene={vi.fn().mockResolvedValue(undefined)}
        onOptionSelect={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(await screen.findByText('End turn')).toBeInTheDocument();
  });
});
