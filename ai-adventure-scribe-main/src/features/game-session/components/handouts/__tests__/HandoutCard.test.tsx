import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HandoutCard } from '../HandoutCard';

describe('HandoutCard attribution', () => {
  it('identifies the receiving character instead of calling them the giver', () => {
    render(
      <HandoutCard
        entry={{
          id: 'handout-1',
          sessionId: 'session-1',
          sessionNumber: 2,
          recipient: 'The Reveler',
          mode: 'improvised',
          key: null,
          title: 'Contained Temporal Soufflé',
          body: 'A souffle held in a pocket of time.',
          giver: 'The Reveler',
          assetPath: null,
          createdAt: '2026-08-12T00:00:00.000Z',
        }}
      />,
    );

    expect(screen.getByText('Given to The Reveler')).toBeInTheDocument();
    expect(screen.queryByText('Given by The Reveler')).not.toBeInTheDocument();
  });
});
