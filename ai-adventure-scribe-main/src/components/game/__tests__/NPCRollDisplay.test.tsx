import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import React from 'react';
import { NPCRollDisplay } from '../NPCRollDisplay';

const mockRoll = {
  request: {
    actorName: 'Goblins',
    purpose: 'Attack player',
    type: 'attack',
    formula: '1d20+4',
    ac: 15,
  },
  result: {
    total: 18,
    naturalRoll: 14,
    modifiers: 4,
  },
};

test('NPCRollDisplay has accessible attributes', () => {
  render(<NPCRollDisplay roll={mockRoll as any} onDismiss={() => {}} />);

  // Check for the main container aria-label
  const container = screen.getByLabelText('Behind the DM Screen popup');
  expect(container).toBeDefined();

  // Check for the close button title and aria-label
  const closeButton = screen.getByRole('button', { name: /close behind the dm screen popup/i });
  expect(closeButton).toBeDefined();
  expect(closeButton.getAttribute('title')).toBe('Close');
});
