/**
 * #1669: the choice a hero gets before a new session would start by itself. Start new session
 * goes to the game with the continue flag (no session is created here). Resume session lists this
 * hero's resumable sessions, newest first, with no raw ids, and resumes the one chosen.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EndedSessionChoice, lastSceneLine } from '../EndedSessionChoice';

import { userDataApi } from '@/services/user-data-api';

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => navigate,
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    listResumableSessions: vi.fn(),
    resumeSession: vi.fn(),
  },
}));

const rows = [
  {
    id: 'sess-one',
    session_number: 1,
    end_time: '2026-11-01T10:00:00Z',
    current_scene_description: 'The first gate.\nThe party waits.',
  },
  {
    id: 'sess-two',
    session_number: 2,
    end_time: '2026-11-10T10:00:00Z',
    current_scene_description: 'The gate of Harrowmere.',
  },
];

const renderChoice = (overrides: Partial<Parameters<typeof EndedSessionChoice>[0]> = {}) =>
  render(
    <EndedSessionChoice
      campaignId="camp-1"
      characterId="char-1"
      starterCampaignId={null}
      {...overrides}
    />,
  );

describe('EndedSessionChoice (#1669)', () => {
  let assign: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    assign = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, assign },
    });
  });

  it('offers Start new session and Resume session as two separate choices', async () => {
    vi.mocked(userDataApi.listResumableSessions).mockResolvedValue(rows);
    renderChoice();
    expect(screen.getByRole('button', { name: 'Start new session' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume session' })).toBeInTheDocument();
    await waitFor(() =>
      expect(userDataApi.listResumableSessions).toHaveBeenCalledWith('camp-1', 'char-1'),
    );
  });

  it('Start new session goes to the game with the continue flag and creates nothing here', async () => {
    vi.mocked(userDataApi.listResumableSessions).mockResolvedValue(rows);
    renderChoice({ starterCampaignId: 'starter-1' });
    fireEvent.click(screen.getByRole('button', { name: 'Start new session' }));
    expect(navigate).toHaveBeenCalledWith(
      '/app/game/camp-1?character=char-1&continue=1&starterCampaign=starter-1',
    );
    expect(userDataApi.resumeSession).not.toHaveBeenCalled();
  });

  it('with nothing to resume, Resume session is disabled and says why', async () => {
    vi.mocked(userDataApi.listResumableSessions).mockResolvedValue([]);
    renderChoice();
    expect(await screen.findByText('No session to resume')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume session' })).toBeDisabled();
  });

  it('lists the resumable sessions newest first, with no raw ids, and resumes the one chosen', async () => {
    vi.mocked(userDataApi.listResumableSessions).mockResolvedValue(rows);
    vi.mocked(userDataApi.resumeSession).mockResolvedValue({ id: 'sess-two', status: 'active' });
    renderChoice();

    fireEvent.click(await screen.findByRole('button', { name: 'Resume session' }));
    const list = screen.getByRole('list', { name: 'Sessions to resume' });
    const items = list.querySelectorAll('li');
    expect(items[0].textContent).toContain('Session 2');
    expect(items[1].textContent).toContain('Session 1');
    expect(items[0].textContent).toContain('The gate of Harrowmere.');
    // The first session's last scene line is the second line of its text.
    expect(items[1].textContent).toContain('The party waits.');
    expect(screen.queryByText(/sess-/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Resume session 2' }));
    await waitFor(() => expect(userDataApi.resumeSession).toHaveBeenCalledWith('sess-two'));
    expect(assign).toHaveBeenCalledWith('/app/game/camp-1?character=char-1&session=sess-two');
  });

  it('#1691: opening the list moves keyboard focus to the list', async () => {
    vi.mocked(userDataApi.listResumableSessions).mockResolvedValue(rows);
    renderChoice();
    fireEvent.click(await screen.findByRole('button', { name: 'Resume session' }));
    expect(screen.getByRole('list', { name: 'Sessions to resume' })).toHaveFocus();
  });

  it('#1691: the list has a capped height and scrolls, so a long list is not a very long page', async () => {
    vi.mocked(userDataApi.listResumableSessions).mockResolvedValue(rows);
    renderChoice();
    fireEvent.click(await screen.findByRole('button', { name: 'Resume session' }));
    const list = screen.getByRole('list', { name: 'Sessions to resume' });
    expect(list).toHaveClass('max-h-[60vh]', 'overflow-y-auto');
  });

  it('a missing hero shows an error line, not a silent stop', () => {
    renderChoice({ characterId: null });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This link has no hero. Pick a hero first.',
    );
    expect(screen.queryByRole('button', { name: 'Start new session' })).not.toBeInTheDocument();
    expect(userDataApi.listResumableSessions).not.toHaveBeenCalled();
  });
});

describe('lastSceneLine', () => {
  it('takes the last non-empty line and removes asset tags', () => {
    expect(lastSceneLine('one\n\nthe last line  ')).toBe('the last line');
    expect(lastSceneLine(null)).toBe('No scene recorded');
  });
});
