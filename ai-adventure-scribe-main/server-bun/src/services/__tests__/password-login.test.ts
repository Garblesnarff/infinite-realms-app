import { describe, expect, it } from 'bun:test';

import { authenticatePassword } from '../password-login.js';

describe('authenticatePassword', () => {
  it('uses the WorkOS password exchange and returns only session tokens', async () => {
    const calls: unknown[] = [];
    const client = {
      userManagement: {
        authenticateWithPassword: async (payload: unknown) => {
          calls.push(payload);
          return { accessToken: 'access', refreshToken: 'refresh' };
        },
      },
    };
    const tokens = await authenticatePassword('agent@example.test', 'secret', 'client-id', client as never);
    expect(tokens).toEqual({ accessToken: 'access', refreshToken: 'refresh' });
    expect(calls).toHaveLength(1);
  });
});
