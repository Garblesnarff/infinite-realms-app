import { beforeEach, describe, expect, it, vi } from 'vitest';

import { db } from '../../../../db/client';
import { SessionMessageService } from '../session/session-message-service.js';

vi.mock('../../../../db/client', () => ({
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(() => ({})) })) })),
    transaction: vi.fn(),
  },
}));

describe('SessionMessageService.addMessages', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inserts messages and increments turn count in one transaction', async () => {
    const returning = vi.fn().mockResolvedValue([{ id: 'message-1' }]);
    const insert = vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(() => ({ returning })),
      })),
    }));
    const update = vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    }));
    const tx = {
      query: { gameSessions: { findFirst: vi.fn().mockResolvedValue({ id: 'session-1' }) } },
      insert,
      update,
    };
    (db.transaction as ReturnType<typeof vi.fn>).mockImplementation(async (callback) =>
      callback(tx),
    );

    const result = await SessionMessageService.addMessages(
      [{ id: 'message-1', sessionId: 'session-1', speakerType: 'player', message: 'Hello' }],
      'user-1',
    );

    expect(result).toEqual([{ id: 'message-1' }]);
    expect(db.transaction).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
  });

  it('does not increment turn count when a retry conflicts on message id', async () => {
    const insert = vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([]) })),
      })),
    }));
    const update = vi.fn();
    const tx = {
      query: { gameSessions: { findFirst: vi.fn().mockResolvedValue({ id: 'session-1' }) } },
      insert,
      update,
    };
    (db.transaction as ReturnType<typeof vi.fn>).mockImplementation(async (callback) =>
      callback(tx),
    );

    await SessionMessageService.addMessages(
      [{ id: 'message-1', sessionId: 'session-1', speakerType: 'player', message: 'Hello' }],
      'user-1',
    );

    expect(update).not.toHaveBeenCalled();
  });
});
