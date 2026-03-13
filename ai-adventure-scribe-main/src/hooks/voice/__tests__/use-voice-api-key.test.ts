/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useToast } from '../../use-toast';
import { useVoiceApiKey } from '../use-voice-api-key';

import { supabase } from '@/integrations/supabase/client';


// Mock dependencies
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(),
    },
  },
}));

vi.mock('../../use-toast', () => ({
  useToast: vi.fn(() => ({
    toast: vi.fn(),
  })),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('useVoiceApiKey', () => {
  const mockToast = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useToast as any).mockReturnValue({ toast: mockToast });
    // Default: no environment variable
    vi.stubEnv('VITE_ELEVENLABS_API_KEY', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should fetch API key from environment variable if available', async () => {
    vi.stubEnv('VITE_ELEVENLABS_API_KEY', 'env-key-123');

    const { result } = renderHook(() => useVoiceApiKey());

    await waitFor(() => {
      expect(result.current.apiKey).toBe('env-key-123');
    });

    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it('should fetch API key from Supabase if env var is missing', async () => {
    (supabase.functions.invoke as any).mockResolvedValue({
      data: { secret: 'supabase-key-456' },
      error: null,
    });

    const { result } = renderHook(() => useVoiceApiKey());

    await waitFor(() => {
      expect(result.current.apiKey).toBe('supabase-key-456');
    });

    expect(supabase.functions.invoke).toHaveBeenCalledWith('get-secret', {
      body: { secretName: 'ELEVEN_LABS_API_KEY' },
    });
  });

  it('should handle Supabase error correctly', async () => {
    (supabase.functions.invoke as any).mockResolvedValue({
      data: null,
      error: { message: 'Function error' },
    });

    const { result } = renderHook(() => useVoiceApiKey());

    await waitFor(() => {
      expect(result.current.error).toContain('Function error');
    });

    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'destructive',
    }));
  });

  it('should handle empty Supabase response', async () => {
    (supabase.functions.invoke as any).mockResolvedValue({
      data: { secret: null },
      error: null,
    });

    const { result } = renderHook(() => useVoiceApiKey());

    await waitFor(() => {
      expect(result.current.error).toContain('ElevenLabs API key is empty or not found');
    });
  });

  it('should handle non-Error objects in catch block', async () => {
    (supabase.functions.invoke as any).mockRejectedValue('String error');

    const { result } = renderHook(() => useVoiceApiKey());

    await waitFor(() => {
      expect(result.current.error).toContain('API Key Error: Unknown error');
    });
  });

  it('should retry fetching API key', async () => {
    (supabase.functions.invoke as any)
      .mockResolvedValueOnce({ data: null, error: { message: 'First fail' } })
      .mockResolvedValueOnce({ data: { secret: 'retry-success' }, error: null });

    const { result } = renderHook(() => useVoiceApiKey());

    await waitFor(() => {
      expect(result.current.error).toBeDefined();
    });

    await act(async () => {
      await result.current.retryApiKeyFetch();
    });

    await waitFor(() => {
      expect(result.current.apiKey).toBe('retry-success');
      expect(result.current.error).toBeUndefined();
    });
  });

  describe('waitForApiKey', () => {
    it('should resolve immediately if key is available', async () => {
      vi.stubEnv('VITE_ELEVENLABS_API_KEY', 'instant-key');
      const { result } = renderHook(() => useVoiceApiKey());

      await waitFor(() => {
        expect(result.current.apiKey).toBe('instant-key');
      });

      const key = await result.current.waitForApiKey();
      expect(key).toBe('instant-key');
    });

    it('should wait and resolve when key becomes available', async () => {
      let resolveInvoke: (val: any) => void;
      const invokePromise = new Promise((resolve) => {
        resolveInvoke = resolve;
      });
      (supabase.functions.invoke as any).mockReturnValue(invokePromise);

      const { result } = renderHook(() => useVoiceApiKey());

      const waitPromise = result.current.waitForApiKey();

      // Still waiting
      expect(result.current.apiKey).toBeNull();

      act(() => {
        resolveInvoke({ data: { secret: 'delayed-key' }, error: null });
      });

      const key = await waitPromise;
      expect(key).toBe('delayed-key');
    });

    it('should return null on timeout', async () => {
      // Mock invoke to never resolve or resolve slowly
      (supabase.functions.invoke as any).mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(() => useVoiceApiKey());

      // Use a short timeout for the test
      const key = await result.current.waitForApiKey(100);
      expect(key).toBeNull();
    });
  });
});
