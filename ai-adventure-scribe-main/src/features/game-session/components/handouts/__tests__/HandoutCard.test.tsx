import { fireEvent, render, screen, within } from '@testing-library/react';
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

describe('HandoutCard missing image (#1192)', () => {
  const authoredEntry = {
    id: 'handout-2',
    sessionId: 'session-1',
    sessionNumber: 2,
    recipient: 'The Reveler',
    mode: 'authored' as const,
    key: null,
    title: 'Toll Receipt',
    body: 'A receipt stamped by the toll-keeper.',
    giver: 'The Toll-Keeper',
    assetPath: 'the-last-toll/handouts/handout-toll-receipt.png',
    createdAt: '2026-08-12T00:00:00.000Z',
  };

  it('shows the image while it loads', () => {
    render(<HandoutCard entry={authoredEntry} />);

    const img = screen.getByRole('img', { name: 'Toll Receipt' });
    expect(img.getAttribute('src')).toContain('the-last-toll/handouts/handout-toll-receipt.png');
  });

  it('hides the thumbnail when the image fails to load', () => {
    render(<HandoutCard entry={authoredEntry} />);

    fireEvent.error(screen.getByRole('img', { name: 'Toll Receipt' }));

    expect(screen.queryByRole('img', { name: 'Toll Receipt' })).not.toBeInTheDocument();
    expect(screen.getByText('Handout')).toBeInTheDocument();
  });

  it('shows the text fallback in the dialog after the thumbnail image fails', () => {
    render(<HandoutCard entry={authoredEntry} />);

    fireEvent.error(screen.getByRole('img', { name: 'Toll Receipt' }));
    fireEvent.click(screen.getByRole('button'));

    expect(screen.queryByRole('img', { name: 'Toll Receipt' })).not.toBeInTheDocument();
    expect(screen.getByText('A receipt stamped by the toll-keeper.')).toBeInTheDocument();
  });

  it('hides the dialog image when the dialog image itself fails to load', () => {
    render(<HandoutCard entry={authoredEntry} />);

    // Open the dialog first: the thumbnail and dialog <img> elements share
    // one accessible name, so scope the query to the dialog to error the
    // dialog image itself rather than the thumbnail.
    fireEvent.click(screen.getByRole('button'));
    const dialogImg = within(screen.getByRole('dialog')).getByRole('img', {
      name: 'Toll Receipt',
    });
    fireEvent.error(dialogImg);

    expect(screen.queryByRole('img', { name: 'Toll Receipt' })).not.toBeInTheDocument();
    expect(screen.getByText('A receipt stamped by the toll-keeper.')).toBeInTheDocument();
  });
});
