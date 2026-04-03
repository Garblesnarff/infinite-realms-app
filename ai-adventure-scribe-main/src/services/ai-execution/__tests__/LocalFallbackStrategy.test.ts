/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { AIService } from '@/services/ai-service';
import { LocalFallbackStrategy } from '../LocalFallbackStrategy';

// Mock logger
vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock AIService
vi.mock('@/services/ai-service', () => ({
  AIService: {
    chatWithDM: vi.fn(),
  },
}));

describe('LocalFallbackStrategy', () => {
  let strategy: LocalFallbackStrategy;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T12:00:00Z'));
    strategy = new LocalFallbackStrategy(7);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('should have a name and priority', () => {
    expect(strategy.name).toBe('local-fallback');
    expect(strategy.priority).toBe(7);
  });

  describe('canExecute', () => {
    it('should return true for dm-agent-execute', () => {
      expect(strategy.canExecute('dm-agent-execute')).toBe(true);
    });

    it('should return true for rules-interpreter-execute', () => {
      expect(strategy.canExecute('rules-interpreter-execute')).toBe(true);
    });

    it('should return false for other functions', () => {
      expect(strategy.canExecute('other-function')).toBe(false);
    });
  });

  describe('execute', () => {
    it('should handle rules-interpreter-execute', async () => {
      const result = await strategy.execute('rules-interpreter-execute');
      expect(result).toEqual({
        isValid: true,
        suggestions: [],
        errors: [],
        explanation: 'Local rules validation - action appears valid',
      });
    });

    it('should handle dm-agent-execute for non-combat payload', async () => {
      const mockResult = { text: 'Hello adventure', narrationSegments: [] };
      (AIService.chatWithDM as any).mockResolvedValue(mockResult);

      const payload = {
        task: { description: 'Talk to the innkeeper' },
        agentContext: {
          campaignDetails: { id: 'camp-1' },
          characterDetails: { id: 'char-1' }
        },
      };

      const result = await strategy.execute('dm-agent-execute', payload);

      expect(AIService.chatWithDM).toHaveBeenCalledWith({
        message: 'Talk to the innkeeper',
        context: expect.objectContaining({
          campaignId: 'camp-1',
          characterId: 'char-1',
          campaignDetails: { id: 'camp-1' },
          characterDetails: { id: 'char-1' },
        }),
        conversationHistory: [],
      });
      expect(result).toEqual({
        response: 'Hello adventure',
        narrationSegments: [],
        context: payload.agentContext,
        raw: {},
      });
    });

    it('should handle null/undefined payload', async () => {
      (AIService.chatWithDM as any).mockResolvedValue({ text: 'No payload text' });

      const result = await strategy.execute('dm-agent-execute', undefined as any);

      expect(AIService.chatWithDM).toHaveBeenCalledWith(expect.objectContaining({
        message: '',
      }));
      expect((result as any).response).toBe('No payload text');
    });

    it('should return stub for combat when narration is disabled', async () => {
      vi.stubEnv('VITE_ENABLE_COMBAT_DM_NARRATION', 'false');

      const payload = {
        task: { description: 'The dragon attacks in combat!' },
        agentContext: { campaignDetails: { id: 'camp-1' } },
      };

      const result = await strategy.execute('dm-agent-execute', payload);

      expect(AIService.chatWithDM).not.toHaveBeenCalled();
      expect(result).toEqual({
        response: '',
        narrationSegments: [],
        context: payload.agentContext,
        raw: {},
      });
    });

    it('should allow combat narration when enabled and not throttled', async () => {
      vi.stubEnv('VITE_ENABLE_COMBAT_DM_NARRATION', 'true');
      const mockResult = { text: 'The dragon breathes fire!', narrationSegments: [] };
      (AIService.chatWithDM as any).mockResolvedValue(mockResult);

      const payload = {
        task: { description: 'Start the battle' },
        agentContext: { campaignDetails: { id: 'camp-1' } },
      };

      // Ensure we are past the initial 0 lastGlobalNarrationAt
      vi.advanceTimersByTime(10000);

      const result = await strategy.execute('dm-agent-execute', payload);

      expect(AIService.chatWithDM).toHaveBeenCalled();
      expect((result as any).response).toBe('The dragon breathes fire!');
    });

    it('should throttle combat narration within 5s cooldown', async () => {
      vi.stubEnv('VITE_ENABLE_COMBAT_DM_NARRATION', 'true');
      const mockResult = { text: 'First attack', narrationSegments: [] };
      (AIService.chatWithDM as any).mockResolvedValue(mockResult);

      const payload = {
        task: { description: 'combat round 1' },
        agentContext: { campaignDetails: { id: 'camp-1' } },
      };

      // Advance time to clear any previous test's state
      vi.advanceTimersByTime(20000);

      // First call - should pass
      await strategy.execute('dm-agent-execute', payload);
      expect(AIService.chatWithDM).toHaveBeenCalledTimes(1);

      // Second call immediately - should be throttled
      const result2 = await strategy.execute('dm-agent-execute', {
        ...payload,
        task: { description: 'battle round 2' },
      });

      expect(AIService.chatWithDM).toHaveBeenCalledTimes(1);
      expect((result2 as any).response).toBe('');

      // Move time forward by 6s
      vi.advanceTimersByTime(6000);

      // Third call - should pass now
      await strategy.execute('dm-agent-execute', {
        ...payload,
        task: { description: 'combat round 3' },
      });
      expect(AIService.chatWithDM).toHaveBeenCalledTimes(2);
    });
  });
});
