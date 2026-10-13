import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useSceneCreationWizard } from '../use-scene-creation-wizard';

import { trpc } from '@/infrastructure/api/trpc-client';

vi.mock('@/infrastructure/api/trpc-client', () => ({
  trpc: {
    scenes: {
      create: {
        useMutation: vi.fn(),
      },
      updateSettings: {
        useMutation: vi.fn(),
      },
    },
  },
}));

describe('useSceneCreationWizard loading state', () => {
  const campaignId = 'campaign-123';

  beforeEach(() => {
    vi.clearAllMocks();
    (trpc.scenes.updateSettings.useMutation as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    });
  });

  it('reports isLoading as true when createSceneMutation is pending', () => {
    (trpc.scenes.create.useMutation as ReturnType<typeof vi.fn>).mockReturnValue({
      mutate: vi.fn(),
      isPending: true,
    });

    const { result } = renderHook(() =>
      useSceneCreationWizard({
        campaignId,
      }),
    );

    expect(result.current.isLoading).toBe(true);
  });

  it('reports isLoading as false when createSceneMutation is not pending', () => {
    (trpc.scenes.create.useMutation as ReturnType<typeof vi.fn>).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });

    const { result } = renderHook(() =>
      useSceneCreationWizard({
        campaignId,
      }),
    );

    expect(result.current.isLoading).toBe(false);
  });
});
