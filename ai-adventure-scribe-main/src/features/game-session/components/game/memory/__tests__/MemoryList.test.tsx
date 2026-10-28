import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { MemoryList } from '../MemoryList';

import type { Memory } from '../types';

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
