import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CompanionMessage } from './CompanionMessage';

describe('CompanionMessage', () => {
  it('renders the companion name, chip, and in-world message distinctly', () => {
    render(
      <CompanionMessage
        message={{
          sender: 'companion',
          speakerName: 'Kira',
          text: 'The north road is watched.',
          timestamp: '2026-08-27T12:00:00.000Z',
        }}
        displayText="The north road is watched."
      />,
    );

    expect(screen.getByText('Kira')).toBeInTheDocument();
    expect(screen.getByText('COMPANION')).toBeInTheDocument();
    expect(screen.getByText('The north road is watched.')).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Kira companion message' })).toHaveClass(
      'companion-bubble',
    );
  });
});
