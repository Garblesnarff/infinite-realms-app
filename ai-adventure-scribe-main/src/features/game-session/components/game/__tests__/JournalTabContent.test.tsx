import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { JournalTabContent } from '../JournalTabContent';

import type { JournalHandoutEntry } from '@/services/user-data-api';

vi.mock('@/components/chronicles/ChronicleViewer', () => ({
  default: (props: { sessionId: string | null; open: boolean }) => {
    return props.open ? <div role="dialog">Chronicle for {props.sessionId}</div> : null;
  },
}));

vi.mock('@/contexts/CampaignContext', () => ({
  useOptionalCampaign: vi.fn(),
}));

import { useOptionalCampaign } from '@/contexts/CampaignContext';

const handout = (id: string, sessionNumber: number | null): JournalHandoutEntry => ({
  id,
  sessionId: 'session-1',
  sessionNumber,
  recipient: 'the party',
  mode: 'improvised',
  key: null,
  title: `Handout ${id}`,
  body: `Content ${id}`,
  giver: 'the DM',
  assetPath: null,
  createdAt: new Date().toISOString(),
});

const baseProps = {
  sessionId: 'session-1',
  sessionNotesId: 'notes-1',
  localSessionNotes: '',
  setLocalSessionNotes: vi.fn(),
  handleSaveNotes: vi.fn(),
  notesPlaceholder: 'Type your session notes here...',
  journalEntries: [] as JournalHandoutEntry[],
  journalLoading: false,
};

describe('JournalTabContent (#1429)', () => {
  it('renders handouts grouped by session, the objective, notes and the Story so far link', () => {
    vi.mocked(useOptionalCampaign).mockReturnValue({
      state: { campaign: { id: 'camp-1', description: 'Find the lost ledger.' } },
    } as never);
    render(
      <JournalTabContent
        {...baseProps}
        journalEntries={[handout('h1', 2), handout('h2', null)]}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Journal' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Handouts' })).toBeInTheDocument();
    expect(screen.getByText('Session 2')).toBeInTheDocument();
    expect(screen.getByText('This campaign')).toBeInTheDocument();
    expect(screen.getByText('Handout h1')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Objective' })).toBeInTheDocument();
    expect(screen.getByText('Find the lost ledger.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Type your session notes here...')).toBeInTheDocument();
    expect(screen.getByText('Only you can see your notes.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Notes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Read the chronicle/ })).toBeInTheDocument();
  });

  it('falls back to "Your adventure awaits." when the campaign has no description', () => {
    vi.mocked(useOptionalCampaign).mockReturnValue({
      state: { campaign: { id: 'camp-1' } },
    } as never);
    render(<JournalTabContent {...baseProps} />);
    expect(screen.getByText('Your adventure awaits.')).toBeInTheDocument();
  });

  it('falls back to "Your adventure awaits." when the description is an empty string', () => {
    vi.mocked(useOptionalCampaign).mockReturnValue({
      state: { campaign: { id: 'camp-1', description: '' } },
    } as never);
    render(<JournalTabContent {...baseProps} />);
    expect(screen.getByText('Your adventure awaits.')).toBeInTheDocument();
  });

  it('hides the objective when there is no campaign', () => {
    vi.mocked(useOptionalCampaign).mockReturnValue(undefined as never);
    render(<JournalTabContent {...baseProps} />);
    expect(screen.queryByRole('heading', { name: 'Objective' })).not.toBeInTheDocument();
    expect(screen.queryByText('Your adventure awaits.')).not.toBeInTheDocument();
  });

  it('saves notes through the handler the panel passes in', () => {
    vi.mocked(useOptionalCampaign).mockReturnValue(undefined as never);
    const handleSaveNotes = vi.fn();
    render(<JournalTabContent {...baseProps} handleSaveNotes={handleSaveNotes} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save Notes' }));
    expect(handleSaveNotes).toHaveBeenCalledTimes(1);
  });

  it('shows the empty handouts state and no Story so far link without a session', () => {
    vi.mocked(useOptionalCampaign).mockReturnValue(undefined as never);
    render(<JournalTabContent {...baseProps} sessionId={undefined} />);
    expect(screen.getByText('No handouts delivered yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Read the chronicle/ })).not.toBeInTheDocument();
  });
});
