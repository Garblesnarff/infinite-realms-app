import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { PlayerMessage } from '../PlayerMessage';

import type { ChatMessage } from '@/types/game';

const baseMessage = (overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  text: 'I advance cautiously.',
  sender: 'player',
  timestamp: new Date('2026-10-25T12:00:00Z').toISOString(),
  characterName: 'Aria',
  ...overrides,
});

const renderPlayer = (
  props: Partial<React.ComponentProps<typeof PlayerMessage>> = {},
): ReturnType<typeof render> =>
  render(
    <PlayerMessage
      message={baseMessage()}
      messageId="player-1"
      isFirstInGroup
      isLastInGroup
      displayText="I advance cautiously."
      isLongMessage={false}
      isExpanded={false}
      onToggleExpanded={vi.fn()}
      {...props}
    />,
  );

describe('PlayerMessage (#88)', () => {
  it('labels the first message in a group "You · {character name}", right-aligned', () => {
    renderPlayer({ characterName: 'Aria' });

    const label = screen.getByText('You · Aria');
    expect(label.className).toMatch(/text-ir-steel-text/);
    expect(label.className).toMatch(/uppercase/);
  });

  it('labels with just "You" when the character name is missing', () => {
    renderPlayer({ characterName: undefined });

    expect(screen.getByText('You')).toBeInTheDocument();
    expect(screen.queryByText(/You ·/)).not.toBeInTheDocument();
  });

  it('shows no label on later messages in the group', () => {
    renderPlayer({ isFirstInGroup: false, characterName: 'Aria' });

    expect(screen.queryByText('You · Aria')).not.toBeInTheDocument();
  });

  it('renders a right-aligned bubble capped at 60ch with the player tint', () => {
    renderPlayer();

    const bubble = screen.getByText('I advance cautiously.').parentElement;
    expect(bubble?.className).toMatch(/max-w-\[60ch\]/);
    expect(bubble?.className).toMatch(/bg-\[color:var\(--ir-player\)\]/);
    expect(bubble?.className).not.toMatch(/ml-auto/);
  });

  it('renders a failed send dashed with "Not sent." and a Try again button', () => {
    const onRetrySend = vi.fn();
    renderPlayer({
      message: baseMessage({ context: { sendFailed: true } }),
      onRetrySend,
    });

    expect(screen.getByText('Not sent.')).toBeInTheDocument();
    const bubble = screen.getByText('I advance cautiously.').parentElement;
    expect(bubble?.className).toMatch(/border-dashed/);
    expect(bubble?.className).toMatch(
      /border-\[color:color-mix\(in_srgb,var\(--ir-hp-bad\)_60%,transparent\)\]/,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetrySend).toHaveBeenCalledTimes(1);
  });

  it('shows no failed UI for a normally sent message', () => {
    renderPlayer();

    expect(screen.queryByText('Not sent.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });
});
