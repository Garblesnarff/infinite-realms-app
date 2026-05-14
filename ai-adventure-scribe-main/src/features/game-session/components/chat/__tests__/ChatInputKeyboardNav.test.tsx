import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

import { ChatInput } from '../ChatInput';

import * as diceParser from '@/utils/diceCommandParser';

// Mock the dice parser
vi.mock('@/utils/diceCommandParser', () => ({
  mightBeDiceCommand: vi.fn(),
  getDiceCommandSuggestions: vi.fn(),
}));

describe('ChatInput Keyboard Navigation', () => {
  const onSendMessage = vi.fn();

  it('navigates through suggestions with ArrowDown and ArrowUp', async () => {
    vi.mocked(diceParser.mightBeDiceCommand).mockReturnValue(true);
    vi.mocked(diceParser.getDiceCommandSuggestions).mockReturnValue(['/roll 1d20', '/roll 2d6']);

    render(<ChatInput onSendMessage={onSendMessage} isDisabled={false} />);

    const textarea = screen.getByPlaceholderText(/Describe what your character/i);
    fireEvent.change(textarea, { target: { value: '/roll' } });

    const suggestions = screen.getAllByRole('option');
    expect(suggestions).toHaveLength(2);

    // First suggestion selected by default
    expect(suggestions[0]).toHaveAttribute('aria-selected', 'true');
    expect(suggestions[1]).toHaveAttribute('aria-selected', 'false');

    // ArrowDown to next suggestion
    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    expect(suggestions[0]).toHaveAttribute('aria-selected', 'false');
    expect(suggestions[1]).toHaveAttribute('aria-selected', 'true');

    // ArrowDown again to wrap to first
    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    expect(suggestions[0]).toHaveAttribute('aria-selected', 'true');
    expect(suggestions[1]).toHaveAttribute('aria-selected', 'false');

    // ArrowUp to wrap to last
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    expect(suggestions[0]).toHaveAttribute('aria-selected', 'false');
    expect(suggestions[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('selects suggestion with Enter', () => {
    vi.mocked(diceParser.mightBeDiceCommand).mockReturnValue(true);
    vi.mocked(diceParser.getDiceCommandSuggestions).mockReturnValue(['/roll 1d20', '/roll 2d6']);

    render(<ChatInput onSendMessage={onSendMessage} isDisabled={false} />);

    const textarea = screen.getByPlaceholderText(/Describe what your character/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '/roll' } });

    // Mock mightBeDiceCommand to return false for the next call (after selection)
    vi.mocked(diceParser.mightBeDiceCommand).mockReturnValue(false);

    // Select second suggestion
    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    expect(textarea.value).toBe('/roll 2d6');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('dismisses suggestions with Escape', () => {
    vi.mocked(diceParser.mightBeDiceCommand).mockReturnValue(true);
    vi.mocked(diceParser.getDiceCommandSuggestions).mockReturnValue(['/roll 1d20']);

    render(<ChatInput onSendMessage={onSendMessage} isDisabled={false} />);

    const textarea = screen.getByPlaceholderText(/Describe what your character/i);
    fireEvent.change(textarea, { target: { value: '/roll' } });

    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
