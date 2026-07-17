/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as sessionUtils from '../game-session/session-utils';
import { useGameSession } from '../use-game-session';

import { supabase } from '@/integrations/supabase/client';
import { userDataApi } from '@/services/user-data-api';

// Mock dependencies
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

// createGameSession (delegated to useSessionManagement, see
// src/hooks/game-session/use-session-management.ts) now creates sessions via
// userDataApi.createSession() (the Bun server's REST API client) instead of
// supabase.from('game_sessions').insert(...).select().single(), so the mock target was
// updated to match. The supabase.from mock above is left in place - it's still used
// elsewhere in this hook tree and is harmless dead weight for the tests that don't touch it.
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    createSession: vi.fn(),
    completeSession: vi.fn(),
    updateSession: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(() => ({
    toast: vi.fn(),
  })),
}));

vi.mock('../game-session/session-utils', () => ({
  CLEANUP_INTERVAL: 1000,
  isValidSession: vi.fn((s) => !!s && !!s.id),
  sanitizeSessionPatch: vi.fn((p) => {
    const {
      id,
      campaign_id: _,
      character_id: __,
      created_at: ___,
      updated_at: ____,
      sequence_number: _____,
      ...rest
    } = p;
    const removed = [];
    if (id) removed.push('id');
    return { sanitized: rest, removed };
  }),
  isSessionExpired: vi.fn(),
  generateSessionSummary: vi.fn().mockResolvedValue('Summary'),
}));

vi.mock('../game-session/use-session-initialization', () => ({
  useSessionInitialization: vi.fn(),
}));

describe('useGameSession', () => {
  const campaignId = 'camp-1';
  const characterId = 'char-1';

  beforeEach(() => {
    vi.clearAllMocks();

    (supabase.from as any).mockReturnValue({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert: vi.fn().mockReturnThis(),
    });
  });

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useGameSession(campaignId, characterId));
    expect(result.current.sessionState).toBe('idle');
    expect(result.current.sessionData).toBe(null);
  });

  describe('safeSetSessionData', () => {
    it('should set valid session data', () => {
      const { result } = renderHook(() => useGameSession(campaignId, characterId));
      const mockSession = { id: 'sess-1' };

      act(() => {
        result.current.setSessionData(mockSession as any);
      });

      expect(result.current.sessionData).toEqual(mockSession);
    });

    it('should not set invalid session data', () => {
      vi.mocked(sessionUtils.isValidSession).mockReturnValue(false);
      const { result } = renderHook(() => useGameSession(campaignId, characterId));

      act(() => {
        result.current.setSessionData({ invalid: true } as any);
      });

      expect(result.current.sessionData).toBe(null);
    });
  });

  describe('createGameSession', () => {
    it('should validate parameters', async () => {
      const { result } = renderHook(() => useGameSession());

      let sessId;
      await act(async () => {
        sessId = await result.current.createGameSession('', '');
      });
      expect(sessId).toBe(null);
    });

    it('should insert new session and update state', async () => {
      const mockNewSession = { id: 'new-sess-1', status: 'active' };
      vi.mocked(userDataApi.createSession).mockResolvedValue(mockNewSession);

      const { result } = renderHook(() => useGameSession(campaignId, characterId));

      let newId;
      await act(async () => {
        newId = await result.current.createGameSession(campaignId, characterId);
      });

      expect(newId).toBe('new-sess-1');
      expect(result.current.sessionData).toEqual(mockNewSession);
      expect(result.current.sessionState).toBe('active');
    });
  });
});
