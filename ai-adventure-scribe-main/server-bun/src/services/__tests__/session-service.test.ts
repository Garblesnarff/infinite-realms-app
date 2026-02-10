import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../../../../db/client.js';
import { SessionService } from '../session-service.js';
import { NotFoundError } from '../../lib/errors.js';
import { gameSessions } from '../../../../db/schema/index.js';

// Mock the db client
vi.mock('../../../../db/client.js', () => ({
  db: {
    query: {
      gameSessions: {
        findFirst: vi.fn(),
      },
      dialogueHistory: {
        findMany: vi.fn(),
      },
    },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(),
        })),
      })),
    })),
  },
}));

describe('SessionService', () => {
  const userId = 'user-1';
  const sessionId = 'session-1';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getSessionWithMessages', () => {
    it('should parallelize session, messages and count queries', async () => {
      const mockSession = { id: sessionId, userId };
      const mockMessages = [{ id: 'msg-1', message: 'hello' }];
      const mockCount = [{ count: 1 }];

      // Setup mocks for Promise.all
      vi.mocked(db.query.gameSessions.findFirst).mockResolvedValue(mockSession as any);
      vi.mocked(db.query.dialogueHistory.findMany).mockResolvedValue(mockMessages as any);
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(mockCount),
        }),
      } as any);

      const result = await SessionService.getSessionWithMessages(sessionId, userId);

      expect(result.session).toEqual(mockSession);
      expect(result.messages).toEqual(mockMessages);
      expect(result.total).toBe(1);

      expect(db.query.gameSessions.findFirst).toHaveBeenCalled();
      expect(db.query.dialogueHistory.findMany).toHaveBeenCalled();
    });

    it('should throw NotFoundError if session is not found', async () => {
      vi.mocked(db.query.gameSessions.findFirst).mockResolvedValue(null);
      vi.mocked(db.query.dialogueHistory.findMany).mockResolvedValue([]);
      vi.mocked(db.select).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ count: 0 }]),
        }),
      } as any);

      await expect(SessionService.getSessionWithMessages(sessionId, userId))
        .rejects.toThrow(NotFoundError);
    });
  });

  describe('completeSession', () => {
    it('should update session and return it without calling getSessionById separately', async () => {
      const mockSession = { id: sessionId, status: 'completed' };

      const mockReturning = vi.fn().mockResolvedValue([mockSession]);
      const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning });
      const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
      vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);

      const result = await SessionService.completeSession(sessionId, userId);

      expect(result).toEqual(mockSession);
      expect(db.update).toHaveBeenCalledWith(gameSessions);
      // Verify getSessionById was NOT called (it's not mocked to be called)
    });

    it('should throw NotFoundError if update fails to find session', async () => {
      const mockReturning = vi.fn().mockResolvedValue([]);
      const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning });
      const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
      vi.mocked(db.update).mockReturnValue({ set: mockSet } as any);

      await expect(SessionService.completeSession(sessionId, userId))
        .rejects.toThrow(NotFoundError);
    });
  });
});
