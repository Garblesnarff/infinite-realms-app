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

  // #90: the combat menu moved to the ActionBar; a system notice in the list carries none.
  it('renders no combat menu under a persisted system notice while an encounter is active', async () => {
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
    expect(screen.getByRole('status', { name: 'System message' })).toBeInTheDocument();
    expect(screen.queryByText('End turn')).not.toBeInTheDocument();
  });

  it('renders a short status line as a centered hairline rule (#88)', () => {
    render(
      <SystemMessage
        message={{ text: 'Combat has ended.', sender: 'system' }}
        isFirstInGroup
        isLastInGroup
        displayText="Combat has ended."
      />,
    );

    const line = screen.getByText('Combat has ended.');
    const row = line.parentElement;
    expect(row?.className).toMatch(/flex items-center gap-2\.5/);
    expect(row?.className).toMatch(/uppercase/);
    expect(row?.className).toMatch(/tracking-\[\.06em\]/);
    const hairlines = Array.from(row?.children ?? []).filter((child) =>
      child.className.includes('bg-white/10'),
    );
    expect(hairlines).toHaveLength(2);
  });

  it('renders an error system message with the alert variant (#88)', () => {
    render(
      <SystemMessage
        message={{
          text: 'Failed to execute dice roll. Please try again.',
          sender: 'system',
          context: { intent: 'dice_roll_error' },
        }}
        isFirstInGroup
        isLastInGroup
        displayText="Failed to execute dice roll. Please try again."
      />,
    );

    expect(screen.getByRole('alert', { name: 'System message' })).toBeInTheDocument();
    const line = screen.getByText('Failed to execute dice roll. Please try again.');
    const row = line.parentElement;
    expect(row?.className).toMatch(/text-ir-hp-bad/);
    expect(row?.className).toMatch(/normal-case/);
    expect(row?.className).not.toMatch(/uppercase/);
    const hairlines = Array.from(row?.children ?? []).filter((child) =>
      child.className.includes('bg-[color:color-mix(in_srgb,var(--ir-hp-bad)_35%,transparent)]'),
    );
    expect(hairlines).toHaveLength(2);
  });

  it('keeps long multi-paragraph system text readable instead of hairlining it (#88)', () => {
    const longText = `The scene has been immediately stopped.\n\nThe content will be rewound to before the uncomfortable element. We can take a break or continue in a different direction that works for everyone.`;
    render(
      <SystemMessage
        message={{ text: longText, sender: 'system' }}
        isFirstInGroup
        isLastInGroup
        displayText={longText}
      />,
    );

    const block = screen.getByText(/The scene has been immediately stopped/);
    expect(block.className).not.toMatch(/items-center gap-2\.5/);
    expect(block.className).toMatch(/text-sm/);
  });
});
