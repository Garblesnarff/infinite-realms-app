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

function renderDmMessage(message: Record<string, unknown>) {
  return render(
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
      expandedMessages={new Set()}
      setExpandedMessages={vi.fn() as never}
      imageByMessage={{}}
      generatingFor={new Set()}
      genErrorByMessage={{}}
      onGenerateScene={vi.fn().mockResolvedValue(undefined)}
      onOptionSelect={vi.fn().mockResolvedValue(undefined)}
    />,
  );
}

describe('MessageRenderer no-action-options gate (GP-015, #219)', () => {
  it('renders the no-choices notice for a marked narration turn with no options', () => {
    renderDmMessage({
      text: 'The corridor stretches ahead, torchlight flickering on damp stone.',
      sender: 'dm',
      context: { noActionOptions: true },
    });

    expect(screen.getByTestId('no-action-options-notice')).toBeInTheDocument();
  });

  it('renders nothing extra for an unmarked narration turn with no options', () => {
    const { container } = renderDmMessage({
      text: 'The corridor stretches ahead, torchlight flickering on damp stone.',
      sender: 'dm',
    });

    expect(screen.queryByTestId('no-action-options-notice')).not.toBeInTheDocument();
    expect(container.querySelector('[data-testid="action-options"]')).toBeNull();
  });

  it('renders choice buttons, not the notice, when the turn carries options', () => {
    // Fixture follows the real producer: use-ai-response.ts appends
    // result.options lines, which the prompt constrains to the
    // `A. **Bold Action**, description` format (context-builder-prompts.ts).
    renderDmMessage({
      text: 'The corridor stretches ahead.\n\nA. **Sneak forward**, slip past the guards\nB. **Light a torch**, see a little better',
      sender: 'dm',
      context: { noActionOptions: false },
    });

    expect(screen.getByTestId('action-options')).toBeInTheDocument();
    expect(screen.queryByTestId('no-action-options-notice')).not.toBeInTheDocument();
  });
});
