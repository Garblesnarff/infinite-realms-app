import { render } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';

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

  // MessageMetadata.tsx formats the timestamp with `toLocaleTimeString()`, which is
  // timezone-dependent - hardcoding "/10:00/" (the UTC hour) fails whenever the test
  // runner's TZ isn't UTC (e.g. it renders "05:00 AM" in a UTC-5 sandbox). Compute the
  // expected string the same way the component does so the assertion is TZ-agnostic.
  const expectedTime = new Date(mockMessage.timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

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
    expect(getByText(expectedTime)).toBeDefined();
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

    expect(queryByText(expectedTime)).toBeNull();
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

  describe('mood word (#2256)', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('does not render the emotion when DEV is false, and keeps the location', () => {
      vi.stubEnv('DEV', false);
      const { container, getByText } = render(
        <MessageMetadata
          message={mockMessage as any}
          isFirstInGroup={true}
          isLastInGroup={true}
          isPlayer={false}
        />,
      );

      expect(container.textContent).not.toContain('Mysterious');
      expect(getByText('Dark Dungeon')).toBeDefined();
    });

    it('renders the emotion when DEV is true', () => {
      vi.stubEnv('DEV', true);
      const { getByText } = render(
        <MessageMetadata
          message={mockMessage as any}
          isFirstInGroup={true}
          isLastInGroup={true}
          isPlayer={false}
        />,
      );

      expect(getByText('Mysterious')).toBeDefined();
    });
  });
});
