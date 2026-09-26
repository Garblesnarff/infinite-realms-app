import { describe, it, expect, vi, beforeEach } from 'vitest';

import { db } from '../../../../db/client';
import { NotFoundError } from '../../lib/errors.js';
import {
  chronicleGenerator,
  sampleTranscript,
  TRANSCRIPT_CHAR_BUDGET,
  type TranscriptTurn,
} from '../chronicle-generator.js';

const { generate, recordProviderUsage, checkQuotaAndConsume } = vi.hoisted(() => ({
  generate: vi.fn(),
  recordProviderUsage: vi.fn(),
  checkQuotaAndConsume: vi.fn(),
}));

// Mock the db client
vi.mock('../../../../db/client', () => ({
  db: {
    select: vi.fn(),
  },
}));

vi.mock('../llm-provider-service.js', () => ({
  LLMProviderService: {
    generate: (...args: unknown[]) => generate(...args),
  },
}));

vi.mock('../ai-usage-service.js', () => ({
  AIUsageService: {
    checkQuotaAndConsume: (...args: unknown[]) => checkQuotaAndConsume(...args),
    recordProviderUsage: (...args: unknown[]) => recordProviderUsage(...args),
  },
}));

describe('ChronicleGenerator Service', () => {
  const mockUserId = 'user-123';
  const mockSessionId = 'session-456';

  beforeEach(() => {
    vi.clearAllMocks();
    checkQuotaAndConsume.mockResolvedValue({ allowed: true, remaining: 10, resetAt: 'tomorrow' });
    recordProviderUsage.mockResolvedValue(undefined);
    generate.mockResolvedValue({
      text: JSON.stringify({
        chapterTitle: 'The Lantern Wood',
        chronicleText: 'Hera walked into the trees.',
        previouslyOn: 'Previously, on your adventure in Blackreach, Hera lit a lantern.',
        illustrationPrompt: 'An elf ranger in a wood, cinematic, no text no words no letters',
        summaryText: 'Hera walked into the trees.',
      }),
      model: 'deepseek/deepseek-chat',
      provider: 'openrouter',
      usage: { inputTokens: 40, outputTokens: 80, totalTokens: 120 },
    });
  });

  function mockOwnedSession(): void {
    let call = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db.select as any).mockImplementation(() => {
      const index = call;
      call += 1;
      const rows =
        index === 0
          ? [
              {
                sessionNumber: 3,
                currentSceneDescription: 'A lantern in the woods',
                campaignName: 'Blackreach',
                characterName: 'Hera',
                characterRace: 'Elf',
                characterClass: 'Ranger',
              },
            ]
          : [];
      const builder = {
        from: () => builder,
        leftJoin: () => builder,
        where: () => builder,
        limit: () => builder,
        orderBy: () => builder,
        then: (resolve: (value: unknown) => void) => resolve(rows),
      };
      return builder;
    });
  }

  describe('fetchSessionData', () => {
    it('should throw NotFoundError if the session is not found or not owned', async () => {
      // Mock the first query (sessionRows) to return empty
      const mockQB = {
        from: vi.fn().mockReturnThis(),
        leftJoin: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        then: vi.fn().mockImplementation((resolve) => resolve([])),
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (db.select as any).mockReturnValue(mockQB);

      // We expect the first Promise.all element to return empty, leading to a NotFoundError
      await expect(
        chronicleGenerator.generateProChronicle(mockSessionId, mockUserId),
      ).rejects.toThrow(NotFoundError);
      expect(generate).not.toHaveBeenCalled();
    });
  });

  describe('LLMProviderService routing', () => {
    it('prefers deepseek and records system-quota usage for a pro chronicle', async () => {
      mockOwnedSession();

      const content = await chronicleGenerator.generateProChronicle(
        mockSessionId,
        mockUserId,
        'pro',
      );

      expect(content.chapterTitle).toBe('The Lantern Wood');
      expect(checkQuotaAndConsume).toHaveBeenCalledWith({
        userId: mockUserId,
        plan: 'pro',
        type: 'llm_system',
        units: 1,
      });
      expect(generate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'deepseek/deepseek-chat',
          provider: 'openrouter',
          maxTokens: 2000,
          temperature: 0.9,
        }),
      );
      expect(recordProviderUsage).toHaveBeenCalledWith({
        userId: mockUserId,
        plan: 'pro',
        type: 'llm_system',
        provider: 'openrouter',
        model: 'deepseek/deepseek-chat',
        inputTokens: 40,
        outputTokens: 80,
        sessionId: mockSessionId,
      });
    });

    it('keeps deepseek as the preferred model for a free chronicle', async () => {
      mockOwnedSession();

      await chronicleGenerator.generateFreeChronicle(mockSessionId, mockUserId, 'free');

      expect(generate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'deepseek/deepseek-chat',
          maxTokens: 600,
          temperature: 0.8,
        }),
      );
      expect(recordProviderUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          plan: 'free',
          type: 'llm_system',
          inputTokens: 40,
          sessionId: mockSessionId,
        }),
      );
    });

    it('does not call the provider or record cost when the quota is spent', async () => {
      mockOwnedSession();
      checkQuotaAndConsume.mockResolvedValue({ allowed: false, remaining: 0, resetAt: 'tomorrow' });

      await expect(
        chronicleGenerator.generateProChronicle(mockSessionId, mockUserId, 'pro'),
      ).rejects.toThrow('AI quota exceeded');
      expect(generate).not.toHaveBeenCalled();
      expect(recordProviderUsage).not.toHaveBeenCalled();
    });
  });

  describe('sampleTranscript', () => {
    // Builds a 60-turn session alternating DM/player, each message padded out
    // so budget/cap behavior is actually exercised (issue #1681: the old
    // generator only ever saw 6 truncated DM-only messages).
    function buildTurns(count: number): TranscriptTurn[] {
      const turns: TranscriptTurn[] = [];
      const baseTime = new Date('2026-01-01T00:00:00Z').getTime();
      for (let i = 0; i < count; i++) {
        turns.push({
          message: `Turn ${i}: ${'lorem ipsum dolor sit amet '.repeat(20)}`,
          speakerType: i % 2 === 0 ? 'dm' : 'player',
          createdAt: new Date(baseTime + i * 60_000),
        });
      }
      return turns;
    }

    it('includes the first, a middle, and the last turn of a 60-turn session', () => {
      const turns = buildTurns(60);

      const result = sampleTranscript(turns);

      expect(result.length).toBeGreaterThan(0);
      expect(result.some((entry) => entry.includes('Turn 0:'))).toBe(true);
      expect(result.some((entry) => entry.includes('Turn 59:'))).toBe(true);
      // At least one turn strictly between the first-5/last-10 edges must be
      // present — this is the acceptance criterion from #1681: "chronicle
      // references at least one mid-session event".
      const turnNumbers = result.map((entry) => {
        const match = entry.match(/Turn (\d+):/);
        return match ? Number(match[1]) : -1;
      });
      expect(turnNumbers.some((n) => n > 4 && n < 50)).toBe(true);
    });

    it('includes player messages, not just DM narration', () => {
      const turns = buildTurns(60);

      const result = sampleTranscript(turns);

      expect(result.some((entry) => entry.startsWith('Player:'))).toBe(true);
      expect(result.some((entry) => entry.startsWith('DM:'))).toBe(true);
    });

    it('respects the overall character budget', () => {
      const turns = buildTurns(60);

      const result = sampleTranscript(turns);
      const totalChars = result.reduce((sum, entry) => sum + entry.length, 0);

      expect(totalChars).toBeLessThanOrEqual(TRANSCRIPT_CHAR_BUDGET);
    });

    it('returns an empty array for no turns', () => {
      expect(sampleTranscript([])).toEqual([]);
    });

    it('keeps output in chronological order', () => {
      const turns = buildTurns(60);

      const result = sampleTranscript(turns);
      const turnNumbers = result.map((entry) => {
        const match = entry.match(/Turn (\d+):/);
        return match ? Number(match[1]) : -1;
      });
      const sorted = [...turnNumbers].sort((a, b) => a - b);

      expect(turnNumbers).toEqual(sorted);
    });
  });
});
