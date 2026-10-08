/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../db/client', () => ({
  db: {},
}));

vi.mock('../../../services/workos.js', () => ({
  workos: {},
  authConfig: { clientId: 'client_test', redirectUri: 'http://localhost/callback' },
}));

import { authRouter } from '../auth.js';

describe('auth tRPC router contract (#2673 step 1)', () => {
  it('exposes exactly the procedures the client calls', () => {
    // auth.me is called by src/contexts/AuthContext.tsx. getAuthUrl has no
    // caller today and is left for a later step.
    const procedures = Object.keys((authRouter as any)._def.procedures).sort();

    expect(procedures).toEqual(['getAuthUrl', 'me']);
  });
});
