import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useToast } from '../../use-toast';
import { useVoiceApiKey } from '../use-voice-api-key';

vi.mock('../../use-toast', () => ({ useToast: vi.fn(() => ({ toast: vi.fn() })) }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

describe('useVoiceApiKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useToast).mockReturnValue({ toast: vi.fn(), dismiss: vi.fn(), toasts: [] });
  });

  it('uses an opaque proxy marker instead of exposing a provider key', async () => {
    const { result } = renderHook(() => useVoiceApiKey());
    await waitFor(() => expect(result.current.apiKey).toBe('server-proxy'));
    expect(result.current.apiKey).not.toMatch(/^sk_/);
  });

  it('can retry proxy initialization', async () => {
    const { result } = renderHook(() => useVoiceApiKey());
    await act(() => result.current.retryApiKeyFetch());
    expect(result.current.apiKey).toBe('server-proxy');
    await expect(result.current.waitForApiKey()).resolves.toBe('server-proxy');
  });
});
