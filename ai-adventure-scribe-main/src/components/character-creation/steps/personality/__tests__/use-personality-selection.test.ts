import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDispatch, mockToast, mockGetBatch, mockLoggerError } = vi.hoisted(() => ({
  mockDispatch: vi.fn(),
  mockToast: vi.fn(),
  mockGetBatch: vi.fn(),
  mockLoggerError: vi.fn(),
}));

vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({
    state: {
      character: {
        alignment: 'Lawful Good',
        background: { id: 'acolyte', name: 'Acolyte' },
        personalityTraits: ['', ''],
      },
    },
    dispatch: mockDispatch,
  }),
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

vi.mock('@/services/personalityService', () => ({
  personalityService: {
    getBatchRandomPersonality: mockGetBatch,
    getRandomPersonalityElement: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => {
  const m = {
    error: mockLoggerError,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
  return { __esModule: true, default: m, logger: m };
});

import { extractPersonalityText, usePersonalitySelection } from '../use-personality-selection';

describe('extractPersonalityText', () => {
  it('returns empty string for a missing element instead of throwing', () => {
    expect(extractPersonalityText(undefined, 'traits')).toBe('');
    expect(extractPersonalityText(null, 'ideals')).toBe('');
  });
});

describe('usePersonalitySelection handleRandomizeAll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs the real error when batch randomize fails', async () => {
    mockGetBatch.mockRejectedValueOnce(new Error('API request failed: 401 Unauthorized'));

    const { result } = renderHook(() => usePersonalitySelection());
    await act(async () => {
      await result.current.handleRandomizeAll();
    });

    expect(mockLoggerError).toHaveBeenCalledWith('Error randomizing all personality elements:', {
      name: 'Error',
      message: 'API request failed: 401 Unauthorized',
    });
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Error',
        variant: 'destructive',
      }),
    );
  });

  it('logs a real error when the batch payload is empty instead of reading .traits of undefined', async () => {
    mockGetBatch.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => usePersonalitySelection());
    await act(async () => {
      await result.current.handleRandomizeAll();
    });

    expect(mockLoggerError).toHaveBeenCalledWith('Error randomizing all personality elements:', {
      name: 'Error',
      message: 'Batch personality response was empty',
    });
  });

  it('applies every field from a complete batch payload', async () => {
    mockGetBatch.mockResolvedValueOnce({
      traits: { text: 'Brave' },
      traits2: { text: 'Curious' },
      ideals: { ideal: 'Freedom' },
      bonds: { bond: 'My village' },
      flaws: { flaw: 'Stubborn' },
    });

    const { result } = renderHook(() => usePersonalitySelection());
    await act(async () => {
      await result.current.handleRandomizeAll();
    });

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'UPDATE_CHARACTER',
      payload: { personalityTraits: ['Brave', 'Curious'] },
    });
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'UPDATE_CHARACTER',
      payload: { ideals: ['Freedom'] },
    });
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'UPDATE_CHARACTER',
      payload: { bonds: ['My village'] },
    });
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'UPDATE_CHARACTER',
      payload: { flaws: ['Stubborn'] },
    });
    expect(mockLoggerError).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'All Randomized!' }));
  });
});
