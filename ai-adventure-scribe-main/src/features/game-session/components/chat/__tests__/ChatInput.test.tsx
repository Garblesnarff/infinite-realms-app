/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ChatInput } from '../ChatInput';

import { PENDING_INPUT_STORAGE_KEY, SESSION_ENDED_STORAGE_KEY } from '@/services/auth/TokenService';
import * as diceParser from '@/utils/diceCommandParser';

// Mock UI components
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, className, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} className={className} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/textarea', () => ({
  Textarea: React.forwardRef(({ value, onChange, onKeyDown, ...props }: any, ref: any) => (
    <textarea ref={ref} value={value} onChange={onChange} onKeyDown={onKeyDown} {...props} />
  )),
}));

// Mock dice command parser
vi.mock('@/utils/diceCommandParser', () => ({
  mightBeDiceCommand: vi.fn(),
  getDiceCommandSuggestions: vi.fn(),
}));

describe('ChatInput', () => {
  const mockOnSendMessage = vi.fn();
  const user = userEvent.setup();

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.removeItem(SESSION_ENDED_STORAGE_KEY);
  });

  it('renders correctly', () => {
    render(<ChatInput onSendMessage={mockOnSendMessage} isDisabled={false} />);

    expect(
      screen.getByPlaceholderText(/describe what your character would like to do/i),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/describe what your character would like to do/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send message/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/quick dice roll/i)).toBeInTheDocument();
  });

  it('updates input value on change', async () => {
    render(<ChatInput onSendMessage={mockOnSendMessage} isDisabled={false} />);
    const textarea = screen.getByPlaceholderText(/describe what your character would like to do/i);

    await user.type(textarea, 'Hello world');
    expect(textarea).toHaveValue('Hello world');
  });

  it('calls onSendMessage when clicking send button', async () => {
    render(<ChatInput onSendMessage={mockOnSendMessage} isDisabled={false} />);
    const textarea = screen.getByPlaceholderText(/describe what your character would like to do/i);
    const sendButton = screen.getByRole('button', { name: /send message/i });

    await user.type(textarea, 'Action!');
    await user.click(sendButton);

    expect(mockOnSendMessage).toHaveBeenCalledWith('Action!');
    expect(textarea).toHaveValue('');
  });

  it('calls onSendMessage when pressing Enter (without Shift)', async () => {
    render(<ChatInput onSendMessage={mockOnSendMessage} isDisabled={false} />);
    const textarea = screen.getByPlaceholderText(/describe what your character would like to do/i);

    await user.type(textarea, 'Jump{Enter}');

    expect(mockOnSendMessage).toHaveBeenCalledWith('Jump');
    expect(textarea).toHaveValue('');
  });

  it('keeps pending input when the session ends during send', async () => {
    let resolveSend!: () => void;
    const onSendMessage = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve;
        }),
    );

    render(<ChatInput onSendMessage={onSendMessage} isDisabled={false} />);
    const textarea = screen.getByPlaceholderText(/describe what your character would like to do/i);
    const sendButton = screen.getByRole('button', { name: /send message/i });

    await user.type(textarea, 'Keep this turn');
    void user.click(sendButton);

    await waitFor(() => {
      expect(sessionStorage.getItem(PENDING_INPUT_STORAGE_KEY)).toBe('Keep this turn');
    });

    localStorage.setItem(SESSION_ENDED_STORAGE_KEY, String(Date.now()));
    resolveSend();

    await waitFor(() => {
      expect(textarea).toHaveValue('Keep this turn');
    });
  });

  it('allows new line when pressing Shift+Enter', async () => {
    render(<ChatInput onSendMessage={mockOnSendMessage} isDisabled={false} />);
    const textarea = screen.getByPlaceholderText(/describe what your character would like to do/i);

    await user.type(textarea, 'Line 1');
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    await user.type(textarea, 'Line 2');

    expect(textarea).toHaveValue('Line 1\nLine 2');
    expect(mockOnSendMessage).not.toHaveBeenCalled();
  });

  it('is disabled when isDisabled prop is true', () => {
    render(<ChatInput onSendMessage={mockOnSendMessage} isDisabled={true} />);

    const textarea = screen.getByPlaceholderText(/describe what your character would like to do/i);
    const sendButton = screen.getByLabelText(/sending message/i);

    expect(textarea).toBeDisabled();
    expect(sendButton).toBeDisabled();
    expect(screen.getByLabelText(/attach file/i)).toBeDisabled();
  });

  it('does not send empty messages', async () => {
    render(<ChatInput onSendMessage={mockOnSendMessage} isDisabled={false} />);
    const sendButton = screen.getByRole('button', { name: /send message/i });

    expect(sendButton).toBeDisabled();

    await user.type(
      screen.getByPlaceholderText(/describe what your character would like to do/i),
      '   ',
    );
    expect(sendButton).toBeDisabled();

    await user.click(sendButton);
    expect(mockOnSendMessage).not.toHaveBeenCalled();
  });

  it('shows dice suggestions when typing dice commands', async () => {
    vi.mocked(diceParser.mightBeDiceCommand).mockReturnValue(true);
    vi.mocked(diceParser.getDiceCommandSuggestions).mockReturnValue(['/roll 1d20', '/roll 2d6']);

    render(<ChatInput onSendMessage={mockOnSendMessage} isDisabled={false} />);
    const textarea = screen.getByPlaceholderText(/describe what your character would like to do/i);

    await user.type(textarea, '/r');

    expect(screen.getByText(/dice roll suggestions/i)).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '/roll 1d20' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '/roll 2d6' })).toBeInTheDocument();
  });

  it('updates input and hides suggestions when a suggestion is clicked', async () => {
    vi.mocked(diceParser.mightBeDiceCommand).mockReturnValue(true);
    vi.mocked(diceParser.getDiceCommandSuggestions).mockReturnValue(['/roll 1d20']);

    render(<ChatInput onSendMessage={mockOnSendMessage} isDisabled={false} />);
    const textarea = screen.getByPlaceholderText(/describe what your character would like to do/i);

    await user.type(textarea, '/r');
    const suggestion = screen.getByRole('option', { name: '/roll 1d20' });

    // Now mock it to return false for subsequent calls
    vi.mocked(diceParser.mightBeDiceCommand).mockReturnValue(false);

    await user.click(suggestion);

    expect(textarea).toHaveValue('/roll 1d20');

    // The suggestions should be hidden. We check that the listbox is gone.
    await waitFor(
      () => {
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });

  it('handles quick dice roll button', async () => {
    render(<ChatInput onSendMessage={mockOnSendMessage} isDisabled={false} />);
    const quickDice = screen.getByLabelText(/quick dice roll/i);
    const textarea = screen.getByPlaceholderText(/describe what your character would like to do/i);

    // Should work when empty
    await user.click(quickDice);
    expect(textarea).toHaveValue('/roll 1d20');

    // Should NOT override when not empty
    await user.clear(textarea);
    await user.type(textarea, 'Something');
    await user.click(quickDice);
    expect(textarea).toHaveValue('Something');
  });

  it('shows character count when exceeding 500 characters', async () => {
    render(<ChatInput onSendMessage={mockOnSendMessage} isDisabled={false} />);
    const textarea = screen.getByPlaceholderText(/describe what your character would like to do/i);

    const longText = 'a'.repeat(501);
    await user.click(textarea);
    await user.paste(longText);

    expect(screen.getByText('501/1000')).toBeInTheDocument();
  });
});
