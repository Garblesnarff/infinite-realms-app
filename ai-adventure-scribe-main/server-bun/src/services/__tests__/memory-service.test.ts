import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '../../../../db/client';
import { MemoryService } from '../memory-service.js';
import { SessionService } from '../session-service.js';

vi.mock('../../../../db/client', () => ({
  db: {
    query: { memories: { findMany: vi.fn(), findFirst: vi.fn() } },
    insert: vi.fn(),
    update: vi.fn(),
    execute: vi.fn(),
  },
}));

vi.mock('../session-service.js', () => ({
  SessionService: { getSessionById: vi.fn() },
}));

vi.mock('../campaign-service.js', () => ({
  CampaignService: { getById: vi.fn() },
}));

describe('MemoryService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('authorizes the session owner before listing memories', async () => {
    vi.mocked(SessionService.getSessionById).mockResolvedValue({ id: 'session-1' } as never);
    vi.mocked(db.query.memories.findMany).mockResolvedValue([]);

    await MemoryService.list('session-1', 'user-1', { limit: 15 });

    expect(SessionService.getSessionById).toHaveBeenCalledWith('session-1', 'user-1');
    expect(db.query.memories.findMany).toHaveBeenCalledOnce();
  });

  it('does not query memories when session ownership is denied', async () => {
    vi.mocked(SessionService.getSessionById).mockRejectedValue(new Error('Session not found'));

    await expect(MemoryService.list('session-for-user-b', 'user-a')).rejects.toThrow(
      'Session not found',
    );
    expect(db.query.memories.findMany).not.toHaveBeenCalled();
  });
});
