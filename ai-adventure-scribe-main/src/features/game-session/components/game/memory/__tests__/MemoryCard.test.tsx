import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { MemoryCard } from '../MemoryCard';

import type { Memory } from '../types';

const base = (over: Partial<Memory>): Memory =>
  ({
    id: 'm1',
    type: 'npc',
    content: 'The innkeeper owes the party a favour.',
    importance: 9,
    metadata: { name: 'Bram' },
    created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: new Date().toISOString(),
    ...over,
  }) as Memory;

describe('MemoryCard (#1236 section B)', () => {
  it('shows the metadata pairs and a when line from created_at', () => {
    render(<MemoryCard memory={base({})} />);
    expect(screen.getByText(/name:/)).toHaveTextContent('name: Bram');
    expect(screen.getByText('3 days ago')).toBeInTheDocument();
  });

  it('shows the session number before the when line when the session is known', () => {
    render(<MemoryCard memory={base({})} sessionNumber={2} />);
    expect(screen.getByText('Session 2 · 3 days ago')).toBeInTheDocument();
  });

  it('keeps the when line relative-only when the session is not known', () => {
    render(<MemoryCard memory={base({})} sessionNumber={null} />);
    expect(screen.getByText('3 days ago')).toBeInTheDocument();
    expect(screen.queryByText(/^Session /)).not.toBeInTheDocument();
  });

  it('gives importance a text label and a matching number of pips', () => {
    const { container, rerender } = render(<MemoryCard memory={base({ importance: 9 })} />);
    expect(screen.getByText('Important')).toBeInTheDocument();
    expect(container.querySelectorAll('.bg-infinite-gold')).toHaveLength(3);

    rerender(<MemoryCard memory={base({ importance: 2 })} />);
    expect(screen.getByText('Minor')).toBeInTheDocument();
    expect(container.querySelectorAll('.bg-infinite-gold')).toHaveLength(1);
  });

  it('clamps content to two lines and expands on tap', () => {
    render(<MemoryCard memory={base({})} />);
    const text = screen.getByText('The innkeeper owes the party a favour.');
    expect(text).toHaveClass('line-clamp-2');

    const toggle = screen.getByRole('button', { name: 'Show more' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);

    expect(text).not.toHaveClass('line-clamp-2');
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });
});
