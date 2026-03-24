import { render, screen, act } from '@testing-library/react';
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

test('NPCRollDisplay has accessible attributes and live regions', async () => {
  vi.useFakeTimers();

  render(<NPCRollDisplay roll={mockRoll as any} onDismiss={() => {}} />);

  // Check for the main container aria-label and role="status"
  const container = screen.getByLabelText('Behind the DM Screen popup');
  expect(container).toBeDefined();
  expect(container.getAttribute('role')).toBe('status');
  expect(container.getAttribute('aria-live')).toBe('polite');
  expect(container.getAttribute('aria-atomic')).toBe('true');

  // Check for rolling status
  const rollingStatus = screen.getByLabelText('Rolling dice...');
  expect(rollingStatus).toBeDefined();

  // Fast forward past the roll animation (800ms)
  await act(async () => {
    vi.advanceTimersByTime(900);
  });

  // Check for final result status
  const finalResult = screen.getByLabelText('Result: 18');
  expect(finalResult).toBeDefined();

  // Check for formula aria-label
  const formula = screen.getByLabelText('Formula: 1d20+4');
  expect(formula).toBeDefined();

  // Check for status role for the HIT/MISS message
  const statusMessage = screen.getByText('HIT (AC 15)');
  const statusContainer = statusMessage.closest('[role="status"]');
  expect(statusContainer).toBeDefined();
  expect(statusContainer?.getAttribute('aria-live')).toBe('polite');

  // Check for the close button title and aria-label
  const closeButton = screen.getByRole('button', { name: /close behind the dm screen popup/i });
  expect(closeButton).toBeDefined();
  expect(closeButton.getAttribute('title')).toBe('Close');

  vi.useRealTimers();
});
