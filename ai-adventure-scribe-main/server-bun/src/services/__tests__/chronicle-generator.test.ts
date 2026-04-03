import { describe, it, expect, vi, beforeEach } from 'vitest';

import { db } from '../../../../db/client';
import { NotFoundError } from '../../lib/errors.js';
import { chronicleGenerator } from '../chronicle-generator.js';

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
});
