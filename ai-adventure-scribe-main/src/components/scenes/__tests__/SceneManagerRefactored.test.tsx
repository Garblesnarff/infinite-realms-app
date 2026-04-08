import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

import { SceneManager } from '../SceneManager';

// Mock trpc
const mockRefetch = vi.fn();
const mockDeleteMutate = vi.fn();
const mockSetActiveMutate = vi.fn();
const mockCreateMutate = vi.fn();

vi.mock('@/infrastructure/api/trpc-client', () => ({
  trpc: {
    scenes: {
      list: {
        useQuery: vi.fn(),
      },
      delete: { useMutation: vi.fn(() => ({ mutate: mockDeleteMutate })) },
      setActive: { useMutation: vi.fn(() => ({ mutate: mockSetActiveMutate })) },
      create: { useMutation: vi.fn(() => ({ mutate: mockCreateMutate })) },
    },
  },
}));

import { trpc } from '@/infrastructure/api/trpc-client';

// Mock useToast
vi.mock('@/components/ui/use-toast', () => ({
  useToast: vi.fn(() => ({
    toast: vi.fn(),
  })),
}));

const queryClient = new QueryClient();

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>
    {children}
  </QueryClientProvider>
);

const mockScenes = [
  {
    id: 'scene-1',
    name: 'Forest Clearing',
    description: 'A quiet forest clearing.',
    width: 20,
    height: 20,
    isActive: true,
    thumbnailUrl: 'thumb1.png',
    gridType: 'square',
  },
  {
    id: 'scene-2',
    name: 'Dark Cave',
    description: 'A damp dark cave.',
    width: 30,
    height: 30,
    isActive: false,
    thumbnailUrl: '',
    gridType: 'square',
  },
];

describe('SceneManager Refactored', () => {
  it('renders grid view by default and shows scenes', () => {
    (trpc.scenes.list.useQuery as any).mockReturnValue({
      data: mockScenes,
      isLoading: false,
      refetch: mockRefetch,
    });

    render(<SceneManager campaignId="test-campaign" />, { wrapper });

    expect(screen.getByText('Forest Clearing')).toBeInTheDocument();
    expect(screen.getByText('Dark Cave')).toBeInTheDocument();
    expect(screen.getByText('2 scenes')).toBeInTheDocument();
    // Grid view specific check
    expect(screen.getByText('20 × 20 squares')).toBeInTheDocument();
  });

  it('switches to list view', () => {
    (trpc.scenes.list.useQuery as any).mockReturnValue({
      data: mockScenes,
      isLoading: false,
      refetch: mockRefetch,
    });

    render(<SceneManager campaignId="test-campaign" />, { wrapper });

    const listViewButton = screen.getByLabelText('List view');
    fireEvent.click(listViewButton);

    expect(screen.getByText('Forest Clearing')).toBeInTheDocument();
    expect(screen.getByText('Dark Cave')).toBeInTheDocument();
    // List view shows gridType
    expect(screen.getAllByText(/square/i)).toHaveLength(2);
  });

  it('triggers view scene on click', () => {
    const onViewScene = vi.fn();
    (trpc.scenes.list.useQuery as any).mockReturnValue({
      data: mockScenes,
      isLoading: false,
      refetch: mockRefetch,
    });

    render(<SceneManager campaignId="test-campaign" onViewScene={onViewScene} />, { wrapper });

    const forestCard = screen.getByLabelText('View scene: Forest Clearing');
    fireEvent.click(forestCard);

    expect(onViewScene).toHaveBeenCalledWith('scene-1');
  });
});
