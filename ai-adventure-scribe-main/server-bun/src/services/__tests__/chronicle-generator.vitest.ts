import { describe, it, expect, vi, beforeEach } from 'vitest';

import { db } from '../../../../db/client';
import { NotFoundError } from '../../lib/errors.js';
import {
  chronicleGenerator,
  sampleTranscript,
  TRANSCRIPT_CHAR_BUDGET,
  type TranscriptTurn,
} from '../chronicle-generator.js';

// Mock the db client
vi.mock('../../../../db/client', () => ({
  db: {
    select: vi.fn(),
  },
}));

// Mock OpenAI
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  })),
}));

describe('ChronicleGenerator Service', () => {
  const mockUserId = 'user-123';
  const mockSessionId = 'session-456';

  beforeEach(() => {
    vi.clearAllMocks();
  });

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
      await expect(chronicleGenerator.generateProChronicle(mockSessionId, mockUserId))
        .rejects.toThrow(NotFoundError);
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
