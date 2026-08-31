/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ensureActionOptions, messageHasOptions } from '../ensure-action-options';

import logger from '@/lib/logger';

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
      const text =
        'You are in a forest.\n\n1. **Look around**, examine the trees.\n2. **Listen**, try to hear any sounds.';
      expect(messageHasOptions(text)).toBe(true);
    });

    it('returns true when text contains lettered options', () => {
      const text =
        'A stranger approaches.\n\nA. **Greet them**, wave politely.\nB. **Draw sword**, stay alert.\nC. **Hide**, blend into shadows.';
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
    });

    it('returns unchanged text if options are already present', async () => {
      const text =
        'The tavern is busy.\n\nA. **Order a drink**, talk to the barkeep.\nB. **Sit in the corner**, observe the crowd.';
      const result = await ensureActionOptions(text);
      expect(result).toBe(text);
    });

    it('leaves free-text unchanged when options are missing', async () => {
      const text = 'You wake up in a damp jail cell.';

      const result = await ensureActionOptions(text);

      expect(result).toBe(text);
      expect(result).not.toContain('A. **Take in your surroundings**');
      expect(result).not.toContain('B. **Speak up**');
      expect(result).not.toContain('C. **Act on instinct**');
      expect(logger.warn).toHaveBeenCalledWith(
        '[EnsureOptions] DM response had no action options; leaving free-text only',
      );
    });
  });
});
