import { useQuery } from '@tanstack/react-query';
import { renderHook, act } from '@testing-library/react';
import { useNavigate } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';

import { useCharacterSelection } from '../use-character-selection';

import type { Mock } from 'vitest';


import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

// Mocks
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
    order: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    single: vi.fn(),
  },
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
}));

describe('useCharacterSelection', () => {
  const mockNavigate = vi.fn();
  const mockToast = vi.fn();
  const mockOnClose = vi.fn();
  const mockUser = { id: 'user-123' };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    (useNavigate as Mock).mockReturnValue(mockNavigate);
    (useToast as Mock).mockReturnValue({ toast: mockToast });
    (useAuth as Mock).mockReturnValue({ user: mockUser });

    // Default implementation for useQuery to avoid issues
    (useQuery as Mock).mockImplementation(({ queryKey }) => {
      if (queryKey.includes('starterLink')) return { data: null, isLoading: false };
      if (queryKey.includes('starterTemplates')) return { data: [], isLoading: false };
      if (queryKey.includes('characters')) return { data: [], isLoading: false };
      return { data: null, isLoading: false };
    });
  });

  it('initializes correctly', () => {
    const { result } = renderHook(() => useCharacterSelection({
      campaignId: 'camp-1',
      campaignName: 'Campaign 1',
      onClose: mockOnClose,
      isOpen: true,
    }));

    expect(result.current.isCreating).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it('handles handleCreateCharacter', () => {
    const { result } = renderHook(() => useCharacterSelection({
      campaignId: 'camp-1',
      campaignName: 'Campaign 1',
      onClose: mockOnClose,
      isOpen: true,
    }));

    act(() => {
      result.current.handleCreateCharacter();
    });

    expect(mockNavigate).toHaveBeenCalledWith('/app/characters/create?campaign=camp-1');
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('handles startGameWithCharacter', () => {
    const { result } = renderHook(() => useCharacterSelection({
      campaignId: 'camp-1',
      campaignName: 'Campaign 1',
      onClose: mockOnClose,
      isOpen: true,
    }));

    const mockCharacter = { id: 'char-1', name: 'Grog' } as any;

    act(() => {
      result.current.startGameWithCharacter(mockCharacter);
    });

    expect(mockOnClose).toHaveBeenCalled();
    // Since navigate is in a setTimeout(0)
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(mockNavigate).toHaveBeenCalledWith('/app/game/camp-1?character=char-1&new=true');
  });
});
