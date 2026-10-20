import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MessageRenderer } from '../MessageRenderer';

const combat = vi.hoisted(() => ({ isInCombat: false, activeEncounter: null as any }));

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

// Stable identities, as MessageListContainer passes (state collections and
// useCallback'd handlers): with fresh ones the memo comparator would bail on
// basicPropsMatch and the rerender test below could not catch a comparator
// that forgets to compare optionsSuperseded.
const stableProps = {
  expandedMessages: new Set<string>(),
  setExpandedMessages: vi.fn() as never,
  imageByMessage: {},
  generatingFor: new Set<string>(),
  genErrorByMessage: {},
  onGenerateScene: vi.fn().mockResolvedValue(undefined),
  onOptionSelect: vi.fn().mockResolvedValue(undefined),
};

function dmMessageElement(message: Record<string, unknown>, optionsSuperseded: boolean) {
  return (
    <MessageRenderer
      message={message as never}
      messageId="dm-1"
      groupIndex={0}
      msgIndex={0}
      isFirstInGroup
      isLastInGroup
      isPlayer={false}
      isDM
      isCompanion={false}
      {...stableProps}
      optionsSuperseded={optionsSuperseded}
    />
  );
}

function renderDmMessage(message: Record<string, unknown>, optionsSuperseded: boolean) {
  return render(dmMessageElement(message, optionsSuperseded));
}

describe('MessageRenderer stale options after combat end (#864)', () => {
  // Fixture follows the real producer: use-ai-response.ts appends result.options lines,
  // which the prompt constrains to the `A. **Bold Action**, description` format
  // (context-builder-prompts.ts). This is the pre-fight DM message from #864, whose list
  // includes the by-then-dead "Press the Professor further".
  const preFightMessage = {
    text: 'The professor folds his arms, waiting.\n\nA. **Press the Professor further**, demand an answer\nB. **Leave the hall**, head for the stairs',
    sender: 'dm',
  };

  it('renders the saved options while no later message has ended a fight', () => {
    renderDmMessage(preFightMessage, false);

    expect(screen.getByTestId('action-options')).toBeInTheDocument();
    expect(screen.getByText(/Press the Professor further/)).toBeInTheDocument();
  });

  it('drops the saved options once a later message ended combat', () => {
    const { container } = renderDmMessage(preFightMessage, true);

    expect(container.querySelector('[data-testid="action-options"]')).toBeNull();
    expect(screen.queryByText(/Press the Professor further/)).not.toBeInTheDocument();
    // The prose itself stays in the transcript; only the stale choices go.
    expect(screen.getByText(/The professor folds his arms/)).toBeInTheDocument();
  });

  it('drops the options on re-render when the boundary arrives after the message mounted', () => {
    // The live sequence: the pre-fight bubble is already mounted (same message object)
    // when the terminal DM reply lands and the prop flips. MessageRenderer is memoized
    // with a custom comparator — the flip must punch through it.
    const { container, rerender } = renderDmMessage(preFightMessage, false);
    expect(container.querySelector('[data-testid="action-options"]')).not.toBeNull();

    rerender(dmMessageElement(preFightMessage, true));

    expect(container.querySelector('[data-testid="action-options"]')).toBeNull();
  });
});
