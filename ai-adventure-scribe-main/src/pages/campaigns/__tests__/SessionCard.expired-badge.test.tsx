/**
 * #210 QA-011: an active session past its expiry must read Expired, so the
 * Sessions tab agrees with the Overview, which hides Resume for it.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import SessionCard, { type SessionListItem } from '../SessionCard';

const session: SessionListItem = {
  id: 's1',
  session_number: 1,
  status: 'active',
  start_time: '2026-09-01T12:00:00Z',
  end_time: null,
  summary: null,
  current_scene_description: null,
  turn_count: 3,
  created_at: '2026-09-01T12:00:00Z',
  character: { id: 'c1', name: 'Hark' },
};

describe('SessionCard status badge (#210 QA-011)', () => {
  it('shows Expired, not Active, for an expired active session', () => {
    render(<SessionCard session={session} displaySessionNumber={1} expired onContinue={vi.fn()} />);
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
  });

  it('still shows Active for a live active session', () => {
    render(
      <SessionCard
        session={session}
        displaySessionNumber={1}
        expired={false}
        onContinue={vi.fn()}
      />,
    );
    expect(screen.getByText('Active')).toBeInTheDocument();
  });
});
