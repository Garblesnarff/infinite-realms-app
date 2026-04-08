import { renderHook, waitFor } from '@testing-library/react';
import React, { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSessionInitialization } from '../game-session/use-session-initialization';

const {
  limitMock,
  orderMock,
  eqCharacterMock,
  eqCampaignMock,
  selectMock,
  fromMock,
} = vi.hoisted(() => {
  const limit = vi.fn();
  const order = vi.fn(() => ({ limit }));
  const eqCharacter = vi.fn(() => ({ order }));
  const eqCampaign = vi.fn(() => ({ eq: eqCharacter }));
  const select = vi.fn(() => ({ eq: eqCampaign }));
  const from = vi.fn(() => ({ select }));

  return {
    limitMock: limit,
    orderMock: order,
    eqCharacterMock: eqCharacter,
    eqCampaignMock: eqCampaign,
    selectMock: select,
    fromMock: from,
  };
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: fromMock,
  },
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('useSessionInitialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limitMock.mockResolvedValue({ data: [], error: null });
  });

  it('does not recreate the same session during StrictMode effect replay', async () => {
    const createGameSession = vi.fn().mockResolvedValue('session-1');
    const cleanupSession = vi.fn();
    const setSessionData = vi.fn();
    const setSessionState = vi.fn();
    const toast = vi.fn();
    const mountedRef = { current: true };

    renderHook(
      () =>
        useSessionInitialization({
          campaignId: 'campaign-1',
          characterId: 'character-1',
          forceNew: false,
          specificSessionId: undefined,
          starterCampaignId: undefined,
          setSessionData,
          setSessionState,
          createGameSession,
          cleanupSession,
          toast,
          mountedRef,
        }),
      {
        wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
      },
    );

    await waitFor(() => expect(createGameSession).toHaveBeenCalledTimes(1));
  });
});
