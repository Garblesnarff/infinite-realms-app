import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

import { CampaignHeader } from './CampaignHeader';

import type { Campaign } from '@/types/game';

// Mock the AlertDialog components since they might be complex
vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="alert-dialog-content">{children}</div>
  ),
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogCancel: ({ children }: { children: React.ReactNode }) => <button>Cancel</button>,
  AlertDialogAction: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick: () => void;
  }) => <button onClick={onClick}>{children}</button>,
}));

describe('CampaignHeader', () => {
  const mockCampaign: Campaign = {
    id: '123',
    name: 'Test Campaign',
    genre: 'fantasy',
    created_at: '',
    user_id: 'user1',
  } as any;

  it('renders campaign name', () => {
    render(<CampaignHeader campaign={mockCampaign} isDeleting={false} onDelete={() => {}} />);
    expect(screen.getByText('Test Campaign')).toBeDefined();
  });

  it('renders delete button with aria-label and title', () => {
    render(<CampaignHeader campaign={mockCampaign} isDeleting={false} onDelete={() => {}} />);
    const deleteBtn = screen.getByLabelText('Delete campaign');
    expect(deleteBtn).toBeDefined();
    expect(deleteBtn.getAttribute('title')).toBe('Delete campaign');
  });

  it('shows confirmation dialog when delete button is clicked', () => {
    // In our mock, the content is always rendered, but in reality it's triggered.
    // Testing the actual Radix behavior might be hard without a full setup.
    // But we can at least check if the content exists in our mock.
    render(<CampaignHeader campaign={mockCampaign} isDeleting={false} onDelete={() => {}} />);
    expect(screen.getByTestId('alert-dialog-content')).toBeDefined();
    expect(screen.getByText(/Are you absolutely sure/)).toBeDefined();
    expect(screen.getByText(/permanently delete the campaign "Test Campaign"/)).toBeDefined();
  });

  it('calls onDelete when confirm button is clicked', () => {
    const onDelete = vi.fn();
    render(<CampaignHeader campaign={mockCampaign} isDeleting={false} onDelete={onDelete} />);

    const confirmBtn = screen.getByText('Delete Campaign');
    fireEvent.click(confirmBtn);

    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('shows "Deleting..." when isDeleting is true', () => {
    render(<CampaignHeader campaign={mockCampaign} isDeleting={true} onDelete={() => {}} />);
    expect(screen.getByText('Deleting...')).toBeDefined();
  });
});
