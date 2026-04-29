import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { expect, it, describe, vi } from 'vitest';

import { SimpleMessageList } from '../SimpleMessageList';

import type { ChatMessage } from '@/services/ai-service';

describe('SimpleMessageList', () => {
  const mockMessages: ChatMessage[] = [
    {
      id: '1',
      role: 'assistant',
      content: 'Hello! Choose one:\nA. Option 1\nB. Option 2',
      timestamp: new Date('2025-01-01T10:00:00Z'),
    },
    {
      id: '2',
      role: 'user',
      content: 'I choose Option 1',
      timestamp: new Date('2025-01-01T10:01:00Z'),
    },
  ];

  const defaultProps = {
    messages: mockMessages,
    isSending: false,
    isLoadingHistory: false,
    streamingMessage: '',
    onOptionSelect: vi.fn(),
    onOptionDoubleClick: vi.fn(),
    messagesEndRef: { current: null } as React.RefObject<HTMLDivElement>,
  };

  it('renders messages correctly', () => {
    render(<SimpleMessageList {...defaultProps} />);
    expect(screen.getByText(/Hello! Choose one/)).toBeDefined();
    expect(screen.getByText('I choose Option 1')).toBeDefined();
  });

  it('renders choices and handles clicks', () => {
    render(<SimpleMessageList {...defaultProps} />);
    const option1 = screen.getByLabelText('Choose Option 1');
    const option2 = screen.getByLabelText('Choose Option 2');

    expect(option1).toBeDefined();
    expect(option2).toBeDefined();

    fireEvent.click(option1);
    expect(defaultProps.onOptionSelect).toHaveBeenCalledWith('Option 1');

    fireEvent.doubleClick(option2);
    expect(defaultProps.onOptionDoubleClick).toHaveBeenCalledWith('Option 2');
  });

  it('renders loading state when isLoadingHistory is true', () => {
    render(<SimpleMessageList {...defaultProps} isLoadingHistory={true} />);
    expect(screen.getByText('Loading conversation...')).toBeDefined();
  });

  it('renders thinking state when isSending is true', () => {
    render(<SimpleMessageList {...defaultProps} isSending={true} />);
    expect(screen.getByText('Thinking...')).toBeDefined();
  });

  it('renders streaming message when available', () => {
    render(
      <SimpleMessageList
        {...defaultProps}
        isSending={true}
        streamingMessage="The dragon breathes..."
      />,
    );
    expect(screen.getByText(/The dragon breathes/)).toBeDefined();
  });

  it('renders empty state message when no messages', () => {
    render(<SimpleMessageList {...defaultProps} messages={[]} />);
    expect(screen.getByText(/Welcome to your adventure/)).toBeDefined();
  });
});
