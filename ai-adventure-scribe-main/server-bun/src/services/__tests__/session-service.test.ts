/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { db } from '../../../../db/client';
import { gameSessions } from '../../../../db/schema/index';
import { NotFoundError } from '../../lib/errors.js';
import { SessionService } from '../session-service.js';

// Mock the db client
vi.mock('../../../../db/client', () => ({
  db: {
    query: {
      gameSessions: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      dialogueHistory: {
        findMany: vi.fn(),
      },
    },
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({
            limit: vi.fn(() => ({
              offset: vi.fn(),
            })),
          })),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      select: vi.fn(() => ({
        returning: vi.fn(),
      })),
      values: vi.fn(() => ({
        returning: vi.fn(),
      })),
    })),
    execute: vi.fn(),
  },
}));

describe('SessionService', () => {
  const userId = 'user-1';
  const sessionId = 'session-1';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getSessionWithMessages', () => {
    it('should parallelize session fetch and combined message/count query', async () => {
      const mockSession = { id: sessionId, userId };
      const mockMessagesWithCount = [
        { message: { id: 'msg-1', message: 'hello' }, totalCount: 1 },
      ];

      // Setup mocks
      vi.mocked(db.query.gameSessions.findFirst).mockResolvedValue(mockSession as unknown as any);

      const mockOffset = vi.fn().mockResolvedValue(mockMessagesWithCount);
      const mockLimit = vi.fn().mockReturnValue({ offset: mockOffset });
      const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
      const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
      const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
      vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);

      const result = await SessionService.getSessionWithMessages(sessionId, userId);

      expect(result.session).toEqual(mockSession);
      expect(result.messages).toEqual([mockMessagesWithCount[0].message]);
      expect(result.total).toBe(1);

      expect(db.query.gameSessions.findFirst).toHaveBeenCalled();
      expect(db.select).toHaveBeenCalled();
    });

    it('should throw NotFoundError if session is not found', async () => {
      vi.mocked(db.query.gameSessions.findFirst).mockResolvedValue(null);

      const mockOffset = vi.fn().mockResolvedValue([]);
      const mockLimit = vi.fn().mockReturnValue({ offset: mockOffset });
      const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
      const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
      const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
      vi.mocked(db.select).mockReturnValue({ from: mockFrom } as any);

      await expect(SessionService.getSessionWithMessages(sessionId, userId)).rejects.toThrow(
        NotFoundError
      );
    });
  });

  describe('getRecentMessages', () => {
    it('should parallelize session verification and combined message/count query', async () => {
      const mockSession = { id: sessionId, userId };
      const mockMessagesWithCount = [
        { message: { id: 'msg-1', message: 'hello', timestamp: new Date() }, totalCount: 1 },
      ];

      // Setup mocks
      vi.mocked(db.query.gameSessions.findFirst).mockResolvedValue(mockSession as unknown as any);

      const mockOffset = vi.fn().mockResolvedValue(mockMessagesWithCount);
      const mockLimit = vi.fn().mockReturnValue({ offset: mockOffset });
      const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit });
      const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy });
      const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
      vi.mocked(db.select).mockReturnValue({ from: mockFrom } as unknown as any);

      const result = await SessionService.getRecentMessages(sessionId, userId);

      expect(result.messages).toEqual([mockMessagesWithCount[0].message]);
      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);

      expect(db.query.gameSessions.findFirst).toHaveBeenCalled();
      expect(db.select).toHaveBeenCalled();
    });
  });

  describe('completeSession', () => {
    it('should update session and return it without calling getSessionById separately', async () => {
      const mockSession = { id: sessionId, status: 'completed' };

      const mockReturning = vi.fn().mockResolvedValue([mockSession]);
      const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning });
      const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
      vi.mocked(db.update).mockReturnValue({ set: mockSet } as unknown as any);

      const result = await SessionService.completeSession(sessionId, userId);

      expect(result).toEqual(mockSession);
      expect(db.update).toHaveBeenCalledWith(gameSessions);
      // Verify getSessionById was NOT called (it's not mocked to be called)
    });

    it('should throw NotFoundError if update fails to find session', async () => {
      const mockReturning = vi.fn().mockResolvedValue([]);
      const mockWhere = vi.fn().mockReturnValue({ returning: mockReturning });
      const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
      vi.mocked(db.update).mockReturnValue({ set: mockSet } as unknown as any);

      await expect(SessionService.completeSession(sessionId, userId))
        .rejects.toThrow(NotFoundError);
    });
  });

  describe('createSession Security', () => {
    it('should throw NotFoundError and NOT insert if campaign ownership verification fails', async () => {
      const campaignId = 'unowned-campaign';

      const mockReturning = vi.fn().mockResolvedValue([]);
      const mockSelect = vi.fn().mockReturnValue({ returning: mockReturning });
      vi.mocked(db.insert).mockReturnValue({ select: mockSelect } as unknown as any);

      // Verify that no values() insert is called
      const mockValues = vi.fn();
      vi.mocked(db.insert).mockReturnValue({ select: mockSelect, values: mockValues } as unknown as any);

      await expect(SessionService.createSession({ campaignId }, userId))
        .rejects.toThrow(NotFoundError);

      expect(db.insert).toHaveBeenCalledWith(gameSessions);
      expect(mockSelect).toHaveBeenCalled();
      expect(mockValues).not.toHaveBeenCalled();
    });

    it('should throw NotFoundError and NOT insert if character ownership verification fails', async () => {
      const characterId = 'unowned-character';

      const mockReturning = vi.fn().mockResolvedValue([]);
      const mockSelect = vi.fn().mockReturnValue({ returning: mockReturning });
      vi.mocked(db.insert).mockReturnValue({ select: mockSelect } as unknown as any);

      await expect(SessionService.createSession({ characterId }, userId))
        .rejects.toThrow(NotFoundError);

      expect(db.insert).toHaveBeenCalledWith(gameSessions);
      expect(mockSelect).toHaveBeenCalled();
    });

    it('should create session successfully with authorized campaign', async () => {
      const campaignId = 'owned-campaign';
      const mockSession = { id: 'new-session', campaignId };

      const mockReturning = vi.fn().mockResolvedValue([mockSession]);
      const mockSelect = vi.fn().mockReturnValue({ returning: mockReturning });
      vi.mocked(db.insert).mockReturnValue({ select: mockSelect } as unknown as any);

      const result = await SessionService.createSession({ campaignId }, userId);

      expect(result).toEqual(mockSession);
      expect(db.insert).toHaveBeenCalledWith(gameSessions);
      expect(mockSelect).toHaveBeenCalled();
    });
  });

  describe('getCampaignSessions', () => {
    it('should use explicit columns to avoid over-fetching heavy fields', async () => {
      const campaignId = 'campaign-1';
      const mockSessions = [{ id: 'session-1', campaignId }];

      // Setup mocks
      vi.mocked(db.query.gameSessions.findMany).mockResolvedValue(mockSessions as any);

      const result = await SessionService.getCampaignSessions(campaignId, userId);

      expect(result).toEqual(mockSessions);
      expect(db.query.gameSessions.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          columns: expect.objectContaining({
            id: true,
            sessionNotes: false,
            summary: false,
            currentSceneDescription: false,
          }),
        })
      );
    });
  });
});
