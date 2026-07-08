import { afterEach, describe, expect, it, vi } from 'vitest';

import { LLMProviderService, TEXT_PROVIDER_TIMEOUT_MS } from '../llm-provider-service.js';

describe('LLMProviderService timeouts', () => {
  afterEach(() => vi.restoreAllMocks());

  it('passes a 60 second signal and returns a retryable timeout', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('timed out', 'TimeoutError')));
    const result = await LLMProviderService.generate({ prompt: 'hello' });
    expect(timeout).toHaveBeenCalledWith(TEXT_PROVIDER_TIMEOUT_MS);
    expect(result).toMatchObject({ status: 503, retryAfter: 1 });
  });
});
