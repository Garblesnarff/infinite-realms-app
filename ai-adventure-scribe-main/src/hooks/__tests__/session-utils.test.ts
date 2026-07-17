/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  isValidSession,
  sanitizeSessionPatch,
  isSessionExpired,
  generateSessionSummary,
  createSessionInDatabase,
  cleanupSessionInDatabase,
  fetchExistingSessions,
  fetchSessionById,
  updateSessionInDatabase,
  SESSION_EXPIRY_TIME,
} from '../game-session/session-utils';

import { userDataApi } from '@/services/user-data-api';

// session-utils' database operations (createSessionInDatabase, cleanupSessionInDatabase,
// fetchExistingSessions, fetchSessionById, updateSessionInDatabase, generateSessionSummary)
// were migrated from supabase.from('game_sessions'/'dialogue_history') calls to userDataApi
// (the Bun server's REST API client) - see src/hooks/game-session/session-utils.ts. The mock
// target was updated to match; each function's real error-handling catch block already
// returns null/[]/default-message on failure, which is why the "should handle error..." /
// "should return null/empty..." tests kept passing even before this fix (an unmocked
// userDataApi call rejects with a real fetch error, which the catch block swallows) - only
// the "success" tests needed a working mock to get real data back.
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    createSession: vi.fn(),
    completeSession: vi.fn(),
    listSessions: vi.fn(),
    getSession: vi.fn(),
    updateSession: vi.fn(),
    listSessionMessages: vi.fn(),
  },
}));

// Mock Logger
vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('session-utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isValidSession', () => {
    it('should return true for a valid session object', () => {
      const validSession = { id: 'session-123' };
      expect(isValidSession(validSession)).toBe(true);
    });

    it('should return false for null or undefined', () => {
      expect(isValidSession(null)).toBe(false);
      expect(isValidSession(undefined)).toBe(false);
    });

    it('should return false for objects without an id', () => {
      expect(isValidSession({})).toBe(false);
      expect(isValidSession({ name: 'test' })).toBe(false);
    });

    it('should return false for non-object types', () => {
      expect(isValidSession('session-123')).toBe(false);
      expect(isValidSession(123)).toBe(false);
    });
  });

  describe('sanitizeSessionPatch', () => {
    it('should remove immutable fields from the patch', () => {
      const patch = {
        id: 'new-id',
        campaign_id: 'new-campaign',
        character_id: 'new-character',
        created_at: '2023-01-01',
        updated_at: '2023-01-01',
        sequence_number: 10,
        current_scene_description: 'Updated scene',
        turn_count: 5,
      };

      const { sanitized, removed } = sanitizeSessionPatch(patch as any);

      expect(sanitized).toEqual({
        current_scene_description: 'Updated scene',
        turn_count: 5,
      });
      expect(removed).toContain('id');
      expect(removed).toContain('campaign_id');
      expect(removed).toContain('character_id');
      expect(removed).toContain('created_at');
      expect(removed).toContain('updated_at');
      expect(removed).toContain('sequence_number');
    });

    it('should return an empty sanitized object if only immutable fields are provided', () => {
      const patch = { id: 'new-id' };
      const { sanitized, removed } = sanitizeSessionPatch(patch as any);
      expect(Object.keys(sanitized)).toHaveLength(0);
      expect(removed).toEqual(['id']);
    });

    it('should return the same object if no immutable fields are present', () => {
      const patch = { current_scene_description: 'test' };
      const { sanitized, removed } = sanitizeSessionPatch(patch as any);
      expect(sanitized).toEqual(patch);
      expect(removed).toHaveLength(0);
    });
  });

  describe('isSessionExpired', () => {
    it('should return false if session is not expired', () => {
      const session = {
        id: 's1',
        start_time: new Date().toISOString(),
      };
      expect(isSessionExpired(session as any)).toBe(false);
    });

    it('should return true if session is older than SESSION_EXPIRY_TIME', () => {
      const longAgo = new Date(Date.now() - SESSION_EXPIRY_TIME - 1000).toISOString();
      const session = {
        id: 's1',
        start_time: longAgo,
      };
      expect(isSessionExpired(session as any)).toBe(true);
    });

    it('should return false if start_time is missing (defaults to now)', () => {
      const session = { id: 's1' };
      expect(isSessionExpired(session as any)).toBe(false);
    });
  });

  describe('database operations', () => {
    it('should create a session in the database', async () => {
      const mockSession = { id: 's1', campaign_id: 'c1', character_id: 'ch1' };
      vi.mocked(userDataApi.createSession).mockResolvedValueOnce(mockSession);

      const result = await createSessionInDatabase('c1', 'ch1');
      expect(result).toEqual(mockSession);
      expect(userDataApi.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ campaign_id: 'c1', character_id: 'ch1' }),
      );
    });

    it('should handle error when creating a session', async () => {
      vi.mocked(userDataApi.createSession).mockRejectedValueOnce(new Error('error'));

      const result = await createSessionInDatabase('c1', 'ch1');
      expect(result).toBeNull();
    });

    it('should cleanup a session in the database', async () => {
      vi.mocked(userDataApi.completeSession).mockResolvedValueOnce({});

      const result = await cleanupSessionInDatabase('s1', 'summary');
      expect(result).toBe(true);
      expect(userDataApi.completeSession).toHaveBeenCalledWith('s1', 'summary');
    });

    it('should handle error when cleaning up a session', async () => {
      vi.mocked(userDataApi.completeSession).mockRejectedValueOnce(new Error('error'));

      const result = await cleanupSessionInDatabase('s1', 'summary');
      expect(result).toBe(false);
    });

    it('should fetch existing sessions', async () => {
      const mockSessions = [{ id: 's1' }, { id: 's2' }];
      vi.mocked(userDataApi.listSessions).mockResolvedValueOnce(mockSessions);

      const result = await fetchExistingSessions('c1', 'ch1');
      expect(result).toEqual(mockSessions);
    });

    it('should return empty array if fetching existing sessions fails', async () => {
      vi.mocked(userDataApi.listSessions).mockRejectedValueOnce(new Error('error'));

      const result = await fetchExistingSessions('c1', 'ch1');
      expect(result).toEqual([]);
    });

    it('should fetch session by id', async () => {
      const mockSession = { id: 's1' };
      vi.mocked(userDataApi.getSession).mockResolvedValueOnce(mockSession);

      const result = await fetchSessionById('s1');
      expect(result).toEqual(mockSession);
    });

    it('should return null if fetching session by id fails', async () => {
      vi.mocked(userDataApi.getSession).mockRejectedValueOnce(new Error('error'));

      const result = await fetchSessionById('s1');
      expect(result).toBeNull();
    });

    it('should update a session in the database', async () => {
      const mockSession = { id: 's1', turn_count: 5 };
      vi.mocked(userDataApi.updateSession).mockResolvedValueOnce(mockSession);

      const result = await updateSessionInDatabase('s1', { turn_count: 5 });
      expect(result).toEqual(mockSession);
    });

    it('should return null if updating session fails', async () => {
      vi.mocked(userDataApi.updateSession).mockRejectedValueOnce(new Error('error'));

      const result = await updateSessionInDatabase('s1', { turn_count: 5 });
      expect(result).toBeNull();
    });
  });

  describe('generateSessionSummary', () => {
    it('should return a summary based on dialogue history', async () => {
      const mockMessages = [
        { message: 'Hello', speaker_type: 'player' },
        { message: 'Welcome', speaker_type: 'dm' },
        { message: 'I attack', speaker_type: 'player' },
      ];

      vi.mocked(userDataApi.listSessionMessages).mockResolvedValueOnce({
        messages: mockMessages as any,
        total: mockMessages.length,
        hasMore: false,
      });

      const summary = await generateSessionSummary('session-123');
      expect(summary).toBe(
        'Session completed with 3 total interactions: 2 player actions and 1 DM responses.',
      );
    });

    it('should handle empty dialogue history', async () => {
      vi.mocked(userDataApi.listSessionMessages).mockResolvedValueOnce({
        messages: [],
        total: 0,
        hasMore: false,
      });

      const summary = await generateSessionSummary('session-123');
      expect(summary).toBe('No activity recorded in this session');
    });

    it('should return default message if sessionId is missing', async () => {
      const summary = await generateSessionSummary('');
      expect(summary).toBe('No activity recorded in this session');
    });

    it('should handle database errors gracefully', async () => {
      vi.mocked(userDataApi.listSessionMessages).mockRejectedValueOnce(new Error('DB Error'));

      const summary = await generateSessionSummary('session-123');
      expect(summary).toBe('No activity recorded in this session');
    });
  });
});
