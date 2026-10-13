import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { formatNarrative } from '@/features/game-session/components/chat/message-list/formatNarrative';

describe('formatNarrative', () => {
  it('unescapes JSON-escaped quotes before rendering', () => {
    const { content } = formatNarrative('\\"The door is open,\\" the guard says.');

    render(<div>{content}</div>);

    expect(screen.getByText(/"The door is open," the guard says\./)).toBeInTheDocument();
  });

  it("does not split the Professor's quote across paragraph blocks when formatting narrative", () => {
    const text =
      "The stone corridor stretches into the ancient darkness as the air grows freezing cold and thick with centuries of undisturbed dust while torchlight flickers wildly against damp walls. He turns to the party with his eyes wide, his voice cracking as he shouts, 'What are you doing? We are all that stands between this descent and total oblivion!' He grips his torch firmly and steps back toward the shadowy archway.";

    const { content } = formatNarrative(text);
    const { container } = render(<div>{content}</div>);

    const paragraphTexts = Array.from(container.querySelectorAll('p')).map(
      (p) => p.textContent ?? '',
    );

    // Should NOT have a paragraph ending with `'What are you doing?` and another starting with `We are all that stands`
    expect(
      paragraphTexts.some(
        (pText) =>
          pText.includes("shouts, 'What are you doing?") && !pText.includes("total oblivion!'"),
      ),
    ).toBe(false);
  });
});
