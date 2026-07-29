/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ensureActionOptions, messageHasOptions } from '../ensure-action-options';

import { llmApiClient } from '@/infrastructure/api';
import logger from '@/lib/logger';

vi.mock('@/infrastructure/api', () => ({
  llmApiClient: {
    generateText: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  default: {
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

describe('ensure-action-options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('messageHasOptions', () => {
    it('returns true when text contains numbered options', () => {
      const text = 'You are in a forest.\n\n1. **Look around**, examine the trees.\n2. **Listen**, try to hear any sounds.';
      expect(messageHasOptions(text)).toBe(true);
    });

    it('returns true when text contains lettered options', () => {
      const text = 'A stranger approaches.\n\nA. **Greet them**, wave politely.\nB. **Draw sword**, stay alert.\nC. **Hide**, blend into shadows.';
      expect(messageHasOptions(text)).toBe(true);
    });

    it('returns false when text is empty or nullish', () => {
      expect(messageHasOptions('')).toBe(false);
      expect(messageHasOptions(null as any)).toBe(false);
      expect(messageHasOptions(undefined as any)).toBe(false);
    });

    it('returns false when text contains no parseable options', () => {
      const text = 'You see a glowing cave mouth. The air is cold and damp.';
      expect(messageHasOptions(text)).toBe(false);
    });

    it('returns false and catches error if parsing throws', () => {
      expect(messageHasOptions({ invalid: 'type' } as any)).toBe(false);
    });
  });

  describe('ensureActionOptions', () => {
    it('returns unchanged text if it is empty, null, or undefined', async () => {
      expect(await ensureActionOptions('')).toBe('');
      expect(await ensureActionOptions(null as any)).toBe(null as any);
      expect(await ensureActionOptions(undefined as any)).toBe(undefined as any);
      expect(llmApiClient.generateText).not.toHaveBeenCalled();
    });

    it('returns unchanged text if options are already present', async () => {
      const text = 'The tavern is busy.\n\nA. **Order a drink**, talk to the barkeep.\nB. **Sit in the corner**, observe the crowd.';
      const result = await ensureActionOptions(text);
      expect(result).toBe(text);
      expect(llmApiClient.generateText).not.toHaveBeenCalled();
    });

    it('calls LLM API to repair and append options when options are missing', async () => {
      const text = 'A massive dragon lands in front of you. Its eyes burn with ancient fury.';
      const repairedResponse = 'A. **Fight**, prepare your weapon.\nB. **Run**, seek cover behind the rocks.\nC. **Negotiate**, appeal to its wisdom.';

      vi.mocked(llmApiClient.generateText).mockResolvedValue(repairedResponse);

      const result = await ensureActionOptions(text);

      expect(llmApiClient.generateText).toHaveBeenCalledTimes(1);
      expect(llmApiClient.generateText).toHaveBeenCalledWith({
        prompt: expect.stringContaining(text),
        temperature: 0.8,
        maxTokens: 400,
      });
      expect(result).toBe(`${text}\n\n${repairedResponse}`);
      expect(logger.warn).toHaveBeenCalledWith('[EnsureOptions] DM response had no action options; repairing');
    });

    it('appends static fallback options if LLM API returns an empty response', async () => {
      const text = 'You wake up in a damp jail cell.';
      vi.mocked(llmApiClient.generateText).mockResolvedValue('');

      const result = await ensureActionOptions(text);

      expect(llmApiClient.generateText).toHaveBeenCalledTimes(1);
      expect(result).toContain(text);
      expect(result).toContain('A. **Take in your surroundings**');
      expect(result).toContain('B. **Speak up**');
      expect(result).toContain('C. **Act on instinct**');
      expect(logger.warn).toHaveBeenCalledWith('[EnsureOptions] Using static fallback options');
    });

    it('appends static fallback options if LLM API returns invalid options (fewer than 2)', async () => {
      const text = 'You are walking along the shore.';
      const invalidResponse = 'A. **Only one option here**, nothing else to do.';
      vi.mocked(llmApiClient.generateText).mockResolvedValue(invalidResponse);

      const result = await ensureActionOptions(text);

      expect(llmApiClient.generateText).toHaveBeenCalledTimes(1);
      expect(result).toContain(text);
      expect(result).toContain('A. **Take in your surroundings**');
      expect(logger.warn).toHaveBeenCalledWith('[EnsureOptions] Using static fallback options');
    });

    it('appends static fallback options if LLM API throws an error', async () => {
      const text = 'The floor beneath you crumbles!';
      vi.mocked(llmApiClient.generateText).mockRejectedValue(new Error('LLM Service Unavailable'));

      const result = await ensureActionOptions(text);

      expect(llmApiClient.generateText).toHaveBeenCalledTimes(1);
      expect(result).toContain(text);
      expect(result).toContain('A. **Take in your surroundings**');
      expect(logger.warn).toHaveBeenCalledWith('[EnsureOptions] Options repair call failed:', expect.any(Error));
      expect(logger.warn).toHaveBeenCalledWith('[EnsureOptions] Using static fallback options');
    });
  });
});
