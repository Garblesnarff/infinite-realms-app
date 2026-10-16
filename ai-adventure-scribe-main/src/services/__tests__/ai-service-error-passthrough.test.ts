/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { AIService } from '../ai-service';
import { processDMResponse } from '../ai/dm-response-processor';
import { fetchSceneState } from '../narrative/scene-state-client';
import { SessionStateService } from '../session-state-service';
import { userDataApi } from '@/services/user-data-api';

import { llmApiClient } from '@/infrastructure/api';
import {
  ApiClientError,
  PartyDefeatedError,
  QuotaExceededError,
  SessionExpiredError,
} from '@/infrastructure/api/rest-client';

vi.mock('@/infrastructure/api', () => ({
  llmApiClient: {
    generateText: vi.fn(),
    lastGenerateRequestId: null,
    lastRequestId: null,
  },
}));

vi.mock('../ai/context-builder', () => ({
  ContextBuilder: { build: vi.fn().mockResolvedValue('prompt') },
}));

vi.mock('../memory-manager', () => ({
  MemoryManager: { getRelevantMemories: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../narrative/scene-state-client', () => ({
  fetchSceneState: vi.fn(),
}));

vi.mock('../session-state-service', () => ({
  SessionStateService: {
    getLatestRollOutcome: vi.fn(),
  },
}));

vi.mock('../ai/dm-response-processor', () => ({
  processDMResponse: vi.fn(),
  processDMResponseSideEffects: vi.fn(),
  runDeferredDMResponseWork: vi.fn(),
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    reportClientFailure: vi.fn(),
  },
}));

describe('chatWithDM typed error passthrough (#2601)', () => {
  // The dedupe key is sessionId|message|historyLen: each test gets its own
  // message so a rejected in-flight promise from one test never leaks into
  // the next (the in-flight map is module state, not cleared by clearAllMocks).
  const mockParams = (message: string, sessionId = 'session-123'): any => ({
    message,
    context: { sessionId, campaignId: 'campaign-456' },
    conversationHistory: [],
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchSceneState).mockResolvedValue(null);
    vi.mocked(SessionStateService.getLatestRollOutcome).mockResolvedValue(null);
  });

  it('rethrows SessionExpiredError without wrapping', async () => {
    const sessionError = new SessionExpiredError();
    vi.mocked(llmApiClient.generateText).mockRejectedValue(sessionError);

    await expect(AIService.chatWithDM(mockParams('Hello DM'))).rejects.toThrow(sessionError);
    try {
      await AIService.chatWithDM(mockParams('Hello DM'));
    } catch (e) {
      expect(e).toBeInstanceOf(SessionExpiredError);
    }
  });

  it('rethrows ApiClientError with status preserved', async () => {
    const apiError = new ApiClientError('Rate limited', 429, true, 60);
    vi.mocked(llmApiClient.generateText).mockRejectedValue(apiError);

    try {
      await AIService.chatWithDM(mockParams('Hello DM 429'));
      expect.unreachable();
    } catch (e: any) {
      expect(e).toBeInstanceOf(ApiClientError);
      expect(e.status).toBe(429);
    }
  });

  it('preserves AbortError identity', async () => {
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';
    vi.mocked(llmApiClient.generateText).mockRejectedValue(abortError);

    try {
      await AIService.chatWithDM(mockParams('Hello DM abort'));
      expect.unreachable();
    } catch (e: any) {
      expect(e.name).toBe('AbortError');
    }
  });

  it('still rethrows QuotaExceededError (regression)', async () => {
    const quotaError = new QuotaExceededError('Quota exceeded');
    vi.mocked(llmApiClient.generateText).mockRejectedValue(quotaError);

    await expect(AIService.chatWithDM(mockParams('Hello DM quota'))).rejects.toThrow(quotaError);
  });

  it('still returns terminal state for PartyDefeatedError (regression)', async () => {
    const defeatedError = new PartyDefeatedError('enc-123');
    vi.mocked(llmApiClient.generateText).mockRejectedValue(defeatedError);

    const result = await AIService.chatWithDM(mockParams('Hello DM defeated'));
    expect(result.terminalState).toBe('party_defeated');
  });

  it('wraps genuinely unknown errors', async () => {
    vi.mocked(llmApiClient.generateText).mockRejectedValue(new Error('mystery'));

    try {
      await AIService.chatWithDM(mockParams('Hello DM unknown'));
      expect.unreachable();
    } catch (e: any) {
      expect(e.message).toBe('Failed to get DM response - AI service unavailable');
      expect(e.cause?.message).toBe('mystery');
    }
  });

  it('processing failure reports client_turn_failure and rethrows the processing message', async () => {
    vi.mocked(llmApiClient.generateText).mockResolvedValue('{"text":"hello"}');
    const processingError = new Error('processing exploded');
    vi.mocked(processDMResponse).mockRejectedValue(processingError);

    try {
      await AIService.chatWithDM(mockParams('Hello DM processing error'));
      expect.unreachable();
    } catch (e: any) {
      expect(e.message).toBe(
        "Something went wrong processing the DM's reply. Your action was not resolved — try again.",
      );
      expect(e.cause).toBe(processingError);
    }

    expect(userDataApi.reportClientFailure).toHaveBeenCalledTimes(1);
    expect(userDataApi.reportClientFailure).toHaveBeenCalledWith(
      'client_turn_failure',
      'session-123',
      expect.stringContaining('Error: processing exploded'),
      { message: 'processing exploded' },
    );
  });

  it('fetch/llm transport failure produces transport message and no processing telemetry', async () => {
    vi.mocked(llmApiClient.generateText).mockRejectedValue(new Error('network failure'));

    try {
      await AIService.chatWithDM(mockParams('Hello DM fetch error'));
      expect.unreachable();
    } catch (e: any) {
      expect(e.message).toBe('Failed to get DM response - AI service unavailable');
      expect(e.cause?.message).toBe('network failure');
    }

    expect(userDataApi.reportClientFailure).not.toHaveBeenCalled();
  });

  it('rate-limits client_turn_failure to one report per session per minute', async () => {
    vi.mocked(llmApiClient.generateText).mockResolvedValue('{"text":"hello"}');
    vi.mocked(processDMResponse).mockRejectedValue(new Error('repeated error'));

    try {
      await AIService.chatWithDM(mockParams('Hello DM rate limit 1', 'session-rate-limit'));
    } catch {}

    try {
      await AIService.chatWithDM(mockParams('Hello DM rate limit 2', 'session-rate-limit'));
    } catch {}

    expect(userDataApi.reportClientFailure).toHaveBeenCalledTimes(1);
  });
});
