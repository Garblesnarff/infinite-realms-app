import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { MemoryList } from '../MemoryList';

import type { Memory } from '../types';

import { userDataApi } from '@/services/user-data-api';

vi.mock('@/services/user-data-api', () => ({
  userDataApi: { listSessions: vi.fn(async () => []) },
}));

const mem = (id: string, type: Memory['type'], content = `memory ${id}`): Memory =>
  ({
    id,
    type,
    content,
    importance: 5,
    metadata: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }) as Memory;

const baseProps = {
  selectedType: null,
  setSelectedType: vi.fn(),
  memoriesLoading: false,
};

describe('MemoryList (#1236 section B)', () => {
  beforeEach(() => {
    vi.mocked(userDataApi.listSessions).mockClear();
  });

  it('labels a memory with its session number when the campaign sessions are loaded', async () => {
    vi.mocked(userDataApi.listSessions).mockResolvedValueOnce([
      { id: 's-2', session_number: 2 } as never,
    ]);
    const known = { ...mem('1', 'npc'), session_id: 's-2' } as Memory;
    const unknown = { ...mem('2', 'npc'), session_id: 's-missing' } as Memory;
    render(
      <MemoryList
        {...baseProps}
        campaignId="camp-1"
        allMemories={[known, unknown]}
        sortedMemories={[known, unknown]}
      />,
    );

    expect(await screen.findByText(/^Session 2 · /)).toBeInTheDocument();
    expect(userDataApi.listSessions).toHaveBeenCalledWith({ campaignId: 'camp-1' });
    expect(screen.getAllByText(/^Session /)).toHaveLength(1);
  });

  it('does not load sessions when there is no campaign id', () => {
    const all = [mem('1', 'npc')];
    render(<MemoryList {...baseProps} allMemories={all} sortedMemories={all} />);
    expect(userDataApi.listSessions).not.toHaveBeenCalled();
  });

  it('states the count of all memories, not the filtered view', () => {
    const all = [mem('1', 'npc'), mem('2', 'item'), mem('3', 'location')];
    render(<MemoryList {...baseProps} allMemories={all} sortedMemories={[all[0]]} />);

    expect(
      screen.getByText('The DM remembers 3 things about this story.', { exact: false }),
    ).toBeInTheDocument();
  });

  it('uses the singular form for one memory', () => {
    const all = [mem('1', 'npc')];
    render(<MemoryList {...baseProps} allMemories={all} sortedMemories={all} />);
    expect(screen.getByText(/remembers 1 thing about/)).toBeInTheDocument();
  });

  it('shows chips only for categories that have memories, plus All', () => {
    const all = [mem('1', 'npc'), mem('2', 'npc'), mem('3', 'location')];
    render(<MemoryList {...baseProps} allMemories={all} sortedMemories={all} />);

    const group = screen.getByRole('group', { name: 'Filter memories' });
    const chips = within(group)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(chips).toEqual(['All', 'Locations', 'Characters']);
  });

  it('groups cards by category with counts in the group headings', () => {
    const all = [mem('1', 'npc'), mem('2', 'npc'), mem('3', 'location')];
    render(<MemoryList {...baseProps} allMemories={all} sortedMemories={all} />);

    expect(screen.getByRole('heading', { name: /Characters\s*\(2\)/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Locations\s*\(1\)/ })).toBeInTheDocument();
  });

  it('shows the new empty state when there are no memories', () => {
    render(<MemoryList {...baseProps} allMemories={[]} sortedMemories={[]} />);

    expect(
      screen.getByText('The DM has not written anything down yet. Play a scene and come back.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/remembers/)).not.toBeInTheDocument();
  });

  it('shows the loading text instead of the empty state while loading', () => {
    render(<MemoryList {...baseProps} memoriesLoading allMemories={[]} sortedMemories={[]} />);
    expect(screen.getByText('Loading memories...')).toBeInTheDocument();
    expect(screen.queryByText(/has not written anything/)).not.toBeInTheDocument();
  });

  it('calls setSelectedType when a chip is pressed', () => {
    const setSelectedType = vi.fn();
    const all = [mem('1', 'npc')];
    render(
      <MemoryList
        {...baseProps}
        setSelectedType={setSelectedType}
        allMemories={all}
        sortedMemories={all}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Characters' }));
    expect(setSelectedType).toHaveBeenCalledWith('npc');
  });

  it('has no pin, lock or edit controls yet', () => {
    const all = [mem('1', 'npc'), mem('2', 'location')];
    render(<MemoryList {...baseProps} allMemories={all} sortedMemories={all} />);
    expect(screen.queryByRole('button', { name: /pin|lock|edit/i })).not.toBeInTheDocument();
  });
});
