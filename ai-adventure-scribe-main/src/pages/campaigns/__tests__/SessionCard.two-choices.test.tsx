/**
 * #1669: an ended session the hero can resume is offered two different things: Start new session
 * and Resume session. A session that cannot be resumed keeps the single Continue button.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import SessionCard, { type SessionListItem } from '../SessionCard';

const ended: SessionListItem = {
  id: 's-ended',
  session_number: 1,
  status: 'completed',
  start_time: '2026-09-01T12:00:00Z',
  end_time: '2026-09-01T13:00:00Z',
  summary: 'The party broke off the fight at the gate.',
  current_scene_description: 'The gate of Harrowmere.',
  turn_count: 3,
  created_at: '2026-09-01T12:00:00Z',
  character: { id: 'c1', name: 'Hark' },
};

describe('SessionCard: Start new session and Resume session (#1669)', () => {
  it('offers both choices for a resumable ended session, and each calls its own handler', () => {
    const onContinue = vi.fn();
    const onResume = vi.fn();
    render(
      <SessionCard
        session={ended}
        displaySessionNumber={1}
        expired={false}
        onContinue={onContinue}
        canResume
        onResume={onResume}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Start new session' }));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onResume).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Resume session' }));
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onResume).toHaveBeenCalledWith(ended);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('shows only the single Continue button when the session cannot be resumed', () => {
    render(
      <SessionCard session={ended} displaySessionNumber={1} expired={false} onContinue={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Continue Session' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume session' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start new session' })).not.toBeInTheDocument();
  });

  it('never offers Resume for a session that is still active', () => {
    const active: SessionListItem = { ...ended, id: 's-active', status: 'active', end_time: null };
    render(
      <SessionCard
        session={active}
        displaySessionNumber={1}
        expired={false}
        onContinue={vi.fn()}
        canResume
        onResume={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Resume Session' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume session' })).not.toBeInTheDocument();
  });
});
