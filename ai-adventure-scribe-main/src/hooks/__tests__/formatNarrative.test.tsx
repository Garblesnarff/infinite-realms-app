import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { formatNarrative } from '@/features/game-session/components/chat/message-list/formatNarrative';

describe('formatNarrative', () => {
  it('unescapes JSON-escaped quotes before rendering', () => {
    const { content } = formatNarrative('\\"The door is open,\\" the guard says.');

    render(<div>{content}</div>);

    expect(screen.getByText(/"The door is open," the guard says\./)).toBeInTheDocument();
  });
});
