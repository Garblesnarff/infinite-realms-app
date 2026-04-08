import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

import { SceneManager } from '../SceneManager';

// Mock trpc
vi.mock('@/infrastructure/api/trpc-client', () => ({
  trpc: {
    scenes: {
      list: {
        useQuery: vi.fn(() => ({
          data: [],
          isLoading: false,
          refetch: vi.fn(),
        })),
      },
      delete: { useMutation: vi.fn(() => ({ mutate: vi.fn() })) },
      setActive: { useMutation: vi.fn(() => ({ mutate: vi.fn() })) },
      create: { useMutation: vi.fn(() => ({ mutate: vi.fn() })) },
    },
  },
}));

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

describe('SceneManager', () => {
  it('renders the standardized EmptyState when there are no scenes', () => {
    render(<SceneManager campaignId="test-campaign" />, { wrapper });

    expect(screen.getByText('No Scenes Yet')).toBeInTheDocument();
    expect(screen.getByText('Create your first scene to bring your campaign to life with interactive battle maps.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Create First Scene/i })).toBeInTheDocument();
  });
});
