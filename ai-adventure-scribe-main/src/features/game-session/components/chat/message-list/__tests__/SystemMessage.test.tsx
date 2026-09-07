import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MessageRenderer } from '../MessageRenderer';
import { SystemMessage } from '../SystemMessage';

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
});
