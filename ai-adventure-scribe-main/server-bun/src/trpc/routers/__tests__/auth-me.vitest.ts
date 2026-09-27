/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }));

vi.mock('../../../../../db/client', () => ({
  db: { query: { users: { findFirst } } },
}));

vi.mock('../../../services/workos.js', () => ({
  workos: {},
  authConfig: { clientId: 'client_test', redirectUri: 'http://localhost/callback' },
}));

import { authRouter } from '../auth.js';

describe('auth.me email (#2292)', () => {
  beforeEach(() => {
    findFirst.mockReset();
  });

  it('falls back to the users row when the access token carries no email claim', async () => {
    findFirst.mockResolvedValue({ email: 'player@example.com', plan: 'free' });
    const caller = authRouter.createCaller({ user: { userId: 'user_1', plan: 'free' } } as any);

    const me = await caller.me();

    expect(me.email).toBe('player@example.com');
    expect(me.plan).toBe('free');
  });

  it('prefers the token email when the token has one', async () => {
    findFirst.mockResolvedValue({ email: 'old@example.com', plan: 'free' });
    const caller = authRouter.createCaller({
      user: { userId: 'user_1', email: 'token@example.com', plan: 'free' },
    } as any);

    expect((await caller.me()).email).toBe('token@example.com');
  });
});
