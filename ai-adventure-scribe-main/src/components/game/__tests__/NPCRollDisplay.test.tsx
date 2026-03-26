import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
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
  const onDismiss = vi.fn();
  render(<NPCRollDisplay roll={mockRoll as any} onDismiss={onDismiss} />);

  // Check for the main container aria-label and role="status"
  const container = screen.getByLabelText('Behind the DM Screen popup');
  expect(container).toBeDefined();
  expect(container.getAttribute('role')).toBe('status');
  expect(container.getAttribute('aria-live')).toBe('polite');
  expect(container.getAttribute('aria-atomic')).toBe('true');

  // Check for the close button title and aria-label
  const closeButton = screen.getByRole('button', { name: /close behind the dm screen popup/i });
  expect(closeButton).toBeDefined();
  expect(closeButton.getAttribute('title')).toBe('Close');
});
