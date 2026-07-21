import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '../../../../db/client';
import { CampaignService } from '../campaign-service.js';
import { MemoryService } from '../memory-service.js';
import { SessionService } from '../session-service.js';

vi.mock('../../../../db/client', () => {
  const insertChain = {
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
  };
  return {
    db: {
      query: { memories: { findMany: vi.fn(), findFirst: vi.fn() } },
      insert: vi.fn(() => insertChain),
      update: vi.fn(),
      execute: vi.fn(),
    },
  };
});

vi.mock('../session-service.js', () => ({
  SessionService: { getSessionById: vi.fn() },
}));

vi.mock('../campaign-service.js', () => ({
  CampaignService: { getById: vi.fn() },
}));

describe('MemoryService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('authorizes the session owner before listing memories and excludes the embedding column', async () => {
    vi.mocked(SessionService.getSessionById).mockResolvedValue({ id: 'session-1' } as never);
    vi.mocked(db.query.memories.findMany).mockResolvedValue([]);

    await MemoryService.list('session-1', 'user-1', { limit: 15 });

    expect(SessionService.getSessionById).toHaveBeenCalledWith('session-1', 'user-1');
    expect(db.query.memories.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        columns: { embedding: false },
      }),
    );
  });

  it('authorizes the session owner before getting memory by ID and excludes the embedding column', async () => {
    const mockMemory = { id: 'memory-1', sessionId: 'session-1' };
    vi.mocked(db.query.memories.findFirst).mockResolvedValue(mockMemory as never);
    vi.mocked(SessionService.getSessionById).mockResolvedValue({ id: 'session-1' } as never);

    const result = await MemoryService.getById('memory-1', 'user-1');

    expect(result).toEqual(mockMemory);
    expect(db.query.memories.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        columns: { embedding: false },
      }),
    );
    expect(SessionService.getSessionById).toHaveBeenCalledWith('session-1', 'user-1');
  });

  it('does not query memories when session ownership is denied', async () => {
    vi.mocked(SessionService.getSessionById).mockRejectedValue(new Error('Session not found'));

    await expect(MemoryService.list('session-for-user-b', 'user-a')).rejects.toThrow(
      'Session not found',
    );
    expect(db.query.memories.findMany).not.toHaveBeenCalled();
  });

  describe('insert (batch)', () => {
    it('returns an empty array immediately when no records are provided', async () => {
      const result = await MemoryService.insert([], 'user-1');
      expect(result).toEqual([]);
      expect(SessionService.getSessionById).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('verifies ownership once for multiple records with the same sessionId', async () => {
      vi.mocked(SessionService.getSessionById).mockResolvedValue({ id: 'session-1' } as never);
      vi.mocked(db.insert).mockImplementation(() => ({
        values: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{ id: 'mem-1' }, { id: 'mem-2' }]),
      } as any));

      const records = [
        { sessionId: 'session-1', content: 'Memory 1' },
        { sessionId: 'session-1', content: 'Memory 2' },
      ] as any;

      const result = await MemoryService.insert(records, 'user-1');

      expect(result).toHaveLength(2);
      expect(SessionService.getSessionById).toHaveBeenCalledOnce();
      expect(SessionService.getSessionById).toHaveBeenCalledWith('session-1', 'user-1');
      expect(db.insert).toHaveBeenCalledOnce();
    });

    it('verifies ownership of mixed unique sessionIds and campaignIds in parallel', async () => {
      vi.mocked(SessionService.getSessionById).mockResolvedValue({ id: 'session-1' } as never);
      vi.mocked(CampaignService.getById).mockResolvedValue({ id: 'camp-1' } as never);

      const records = [
        { sessionId: 'session-1', content: 'Memory 1' },
        { campaignId: 'camp-1', content: 'Memory 2' },
      ] as any;

      await MemoryService.insert(records, 'user-1');

      expect(SessionService.getSessionById).toHaveBeenCalledOnce();
      expect(SessionService.getSessionById).toHaveBeenCalledWith('session-1', 'user-1');
      expect(CampaignService.getById).toHaveBeenCalledOnce();
      expect(CampaignService.getById).toHaveBeenCalledWith('camp-1', 'user-1');
      expect(db.insert).toHaveBeenCalledOnce();
    });

    it('throws NotFoundError if a record is missing both parent references', async () => {
      const records = [{ content: 'Memory without parent' }] as any;

      await expect(MemoryService.insert(records, 'user-1')).rejects.toThrow(
        /Memory parent not found/,
      );
      expect(SessionService.getSessionById).not.toHaveBeenCalled();
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('throws NotFoundError and aborts insert if a campaignId ownership verification fails', async () => {
      vi.mocked(SessionService.getSessionById).mockResolvedValue({ id: 'session-1' } as never);
      vi.mocked(CampaignService.getById).mockResolvedValue(null as never);

      const records = [
        { sessionId: 'session-1', content: 'Memory 1' },
        { campaignId: 'camp-invalid', content: 'Memory 2' },
      ] as any;

      await expect(MemoryService.insert(records, 'user-1')).rejects.toThrow(
        /Memory parent not found/,
      );
      expect(db.insert).not.toHaveBeenCalled();
    });
  });
});
