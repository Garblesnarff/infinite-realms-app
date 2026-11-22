/**
 * #1691: the "Resume is off" reason on an ended session must not show while the resumable list is
 * still loading. It shows only once the list has loaded and the hero has an active session.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CampaignSessionsContent } from '../CampaignSessionsContent';

import type { SessionListItem } from '../SessionCard';

const REASON = 'Resume is off: this hero already has an active session in this adventure.';

const activeSession: SessionListItem = {
  id: 's-active',
  session_number: 2,
  status: 'active',
  start_time: '2026-09-02T12:00:00Z',
  end_time: null,
  summary: null,
  current_scene_description: 'The gate of Harrowmere.',
  turn_count: 1,
  created_at: '2026-09-02T12:00:00Z',
  character: { id: 'c1', name: 'Hark' },
};

const endedSession: SessionListItem = {
  ...activeSession,
  id: 's-ended',
  session_number: 1,
  status: 'completed',
  end_time: '2026-09-01T13:00:00Z',
};

const renderContent = (resumableIds: ReadonlySet<string> | undefined): ReturnType<typeof render> =>
  render(
    <CampaignSessionsContent
      isLoading={false}
      error={null}
      sessions={[activeSession, endedSession]}
      openStartSession={vi.fn()}
      isSessionExpired={() => false}
      handleContinue={vi.fn()}
      continuingId={null}
      onViewChronicle={vi.fn()}
      onGenerateChronicle={vi.fn()}
      resumableIds={resumableIds}
      onResume={vi.fn()}
      resumingId={null}
      isFetchingNextPage={false}
      fetchNextPage={vi.fn()}
    />,
  );

describe('CampaignSessionsContent: Resume is off reason (#1691)', () => {
  it('does not show the Resume is off reason while the resumable list is still loading', () => {
    renderContent(undefined);
    expect(screen.queryByText(REASON)).not.toBeInTheDocument();
  });

  it('shows the Resume is off reason once the list has loaded and the hero has an active session', () => {
    renderContent(new Set<string>());
    expect(screen.getByText(REASON)).toBeInTheDocument();
  });
});
