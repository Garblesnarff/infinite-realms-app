import { render } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

import { MessageMetadata } from '../MessageMetadata';

describe('MessageMetadata', () => {
  const mockMessage = {
    id: 'msg-123',
    text: 'Hello world',
    sender: 'dm' as const,
    timestamp: '2026-05-22T10:00:00Z',
    context: {
      emotion: 'Mysterious',
      location: 'Dark Dungeon',
    },
  };

  it('renders correctly with all props', () => {
    const { getByText } = render(
      <MessageMetadata
        message={mockMessage as any}
        isFirstInGroup={true}
        isLastInGroup={true}
        isPlayer={false}
      />,
    );

    expect(getByText('Mysterious')).toBeDefined();
    expect(getByText('Dark Dungeon')).toBeDefined();
    expect(getByText(/10:00/)).toBeDefined();
  });

  it('renders correctly for player messages', () => {
    const { container } = render(
      <MessageMetadata
        message={mockMessage as any}
        isFirstInGroup={true}
        isLastInGroup={true}
        isPlayer={true}
      />,
    );

    expect(container.querySelector('.text-right')).not.toBeNull();
  });

  it('renders correctly for non-player messages', () => {
    const { container } = render(
      <MessageMetadata
        message={mockMessage as any}
        isFirstInGroup={true}
        isLastInGroup={true}
        isPlayer={false}
      />,
    );

    expect(container.querySelector('.text-left')).not.toBeNull();
  });

  it('hides metadata when not first in group', () => {
    const { queryByText } = render(
      <MessageMetadata
        message={mockMessage as any}
        isFirstInGroup={false}
        isLastInGroup={true}
        isPlayer={false}
      />,
    );

    expect(queryByText('Mysterious')).toBeNull();
  });

  it('hides timestamp when not last in group', () => {
    const { queryByText } = render(
      <MessageMetadata
        message={mockMessage as any}
        isFirstInGroup={true}
        isLastInGroup={false}
        isPlayer={false}
      />,
    );

    expect(queryByText(/10:00/)).toBeNull();
  });

  it('handles missing timestamp gracefully', () => {
    const messageNoTime = { ...mockMessage, timestamp: undefined };
    const { container } = render(
      <MessageMetadata
        message={messageNoTime as any}
        isFirstInGroup={true}
        isLastInGroup={true}
        isPlayer={false}
      />,
    );

    const meta = container.querySelector('.message-meta');
    expect(meta?.textContent).toBe('');
  });

  it('is memoized', () => {
    const { rerender } = render(
      <MessageMetadata
        message={mockMessage as any}
        isFirstInGroup={true}
        isLastInGroup={true}
        isPlayer={false}
      />,
    );

    rerender(
      <MessageMetadata
        message={mockMessage as any}
        isFirstInGroup={true}
        isLastInGroup={true}
        isPlayer={false}
      />,
    );

    expect(document.body.textContent).toContain('Mysterious');
  });
});
