/* eslint-disable @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ChatInput } from '../ChatInput';

import { SESSION_ENDED_STORAGE_KEY } from '@/services/auth/TokenService';

// Mock UI components (same shape as ChatInput.test.tsx)
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

describe('ChatInput length cap (#1307)', () => {
  const mockOnSendMessage = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.removeItem(SESSION_ENDED_STORAGE_KEY);
  });

  const composer = () => screen.getByLabelText(/describe what your character would like to do/i);
  const sendButton = () => screen.getByLabelText(/send message/i);

  it('shows a plain too-long message and disables send over the cap', () => {
    render(<ChatInput onSendMessage={mockOnSendMessage} isDisabled={false} />);

    fireEvent.change(composer(), { target: { value: 'a'.repeat(20_001) } });

    expect(screen.getByRole('alert')).toHaveTextContent(/too long/i);
    expect(sendButton()).toBeDisabled();
  });

  it('does not send over-cap text', () => {
    render(<ChatInput onSendMessage={mockOnSendMessage} isDisabled={false} />);

    fireEvent.change(composer(), { target: { value: 'a'.repeat(20_001) } });
    fireEvent.click(sendButton());

    expect(mockOnSendMessage).not.toHaveBeenCalled();
  });

  it('sends text exactly at the cap', async () => {
    render(<ChatInput onSendMessage={mockOnSendMessage} isDisabled={false} />);

    fireEvent.change(composer(), { target: { value: 'a'.repeat(20_000) } });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(sendButton()).not.toBeDisabled();
    fireEvent.click(sendButton());

    await waitFor(() => expect(mockOnSendMessage).toHaveBeenCalledWith('a'.repeat(20_000)));
  });

  it('disables Retry over the cap after a failed send', () => {
    // A failed turn leaves the composer text in place with a Retry button; a
    // user edit past the cap must not be able to go out through Retry either.
    const mockOnRetry = vi.fn();
    render(
      <ChatInput
        onSendMessage={mockOnSendMessage}
        isDisabled={false}
        sendError="Send failed"
        onRetry={mockOnRetry}
      />,
    );

    fireEvent.change(composer(), { target: { value: 'a'.repeat(20_001) } });

    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(retry).toBeDisabled();
    fireEvent.click(retry);

    expect(mockOnRetry).not.toHaveBeenCalled();
  });

  it('keeps Retry enabled at the cap after a failed send', () => {
    const mockOnRetry = vi.fn();
    render(
      <ChatInput
        onSendMessage={mockOnSendMessage}
        isDisabled={false}
        sendError="Send failed"
        onRetry={mockOnRetry}
      />,
    );

    fireEvent.change(composer(), { target: { value: 'a'.repeat(20_000) } });

    expect(screen.getByRole('button', { name: 'Retry' })).not.toBeDisabled();
  });
});
