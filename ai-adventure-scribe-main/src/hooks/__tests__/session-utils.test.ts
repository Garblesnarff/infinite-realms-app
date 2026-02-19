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
  SESSION_EXPIRY_TIME
} from '../game-session/session-utils';

import { supabase } from '@/integrations/supabase/client';

// Mock Supabase
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
    }))
  }
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
        turn_count: 5
      };

      const { sanitized, removed } = sanitizeSessionPatch(patch as any);

      expect(sanitized).toEqual({
        current_scene_description: 'Updated scene',
        turn_count: 5
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
        start_time: new Date().toISOString()
      };
      expect(isSessionExpired(session as any)).toBe(false);
    });

    it('should return true if session is older than SESSION_EXPIRY_TIME', () => {
      const longAgo = new Date(Date.now() - SESSION_EXPIRY_TIME - 1000).toISOString();
      const session = {
        id: 's1',
        start_time: longAgo
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
      (supabase.from as any).mockReturnValue({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockSession, error: null })
      });

      const result = await createSessionInDatabase('c1', 'ch1');
      expect(result).toEqual(mockSession);
      expect(supabase.from).toHaveBeenCalledWith('game_sessions');
    });

    it('should handle error when creating a session', async () => {
      (supabase.from as any).mockReturnValue({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: 'error' } })
      });

      const result = await createSessionInDatabase('c1', 'ch1');
      expect(result).toBeNull();
    });

    it('should cleanup a session in the database', async () => {
      (supabase.from as any).mockReturnValue({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null })
      });

      const result = await cleanupSessionInDatabase('s1', 'summary');
      expect(result).toBe(true);
    });

    it('should handle error when cleaning up a session', async () => {
      (supabase.from as any).mockReturnValue({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: { message: 'error' } })
      });

      const result = await cleanupSessionInDatabase('s1', 'summary');
      expect(result).toBe(false);
    });

    it('should fetch existing sessions', async () => {
      const mockSessions = [{ id: 's1' }, { id: 's2' }];
      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: mockSessions, error: null })
      });

      const result = await fetchExistingSessions('c1', 'ch1');
      expect(result).toEqual(mockSessions);
    });

    it('should return empty array if fetching existing sessions fails', async () => {
      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: null, error: { message: 'error' } })
      });

      const result = await fetchExistingSessions('c1', 'ch1');
      expect(result).toEqual([]);
    });

    it('should fetch session by id', async () => {
      const mockSession = { id: 's1' };
      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockSession, error: null })
      });

      const result = await fetchSessionById('s1');
      expect(result).toEqual(mockSession);
    });

    it('should return null if fetching session by id fails', async () => {
      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: 'error' } })
      });

      const result = await fetchSessionById('s1');
      expect(result).toBeNull();
    });

    it('should update a session in the database', async () => {
      const mockSession = { id: 's1', turn_count: 5 };
      (supabase.from as any).mockReturnValue({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockSession, error: null })
      });

      const result = await updateSessionInDatabase('s1', { turn_count: 5 });
      expect(result).toEqual(mockSession);
    });

    it('should return null if updating session fails', async () => {
      (supabase.from as any).mockReturnValue({
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: 'error' } })
      });

      const result = await updateSessionInDatabase('s1', { turn_count: 5 });
      expect(result).toBeNull();
    });
  });

  describe('generateSessionSummary', () => {
    it('should return a summary based on dialogue history', async () => {
      const mockMessages = [
        { message: 'Hello', speaker_type: 'player' },
        { message: 'Welcome', speaker_type: 'dm' },
        { message: 'I attack', speaker_type: 'player' }
      ];

      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: mockMessages, error: null })
      });

      const summary = await generateSessionSummary('session-123');
      expect(summary).toBe('Session completed with 3 total interactions: 2 player actions and 1 DM responses.');
    });

    it('should handle empty dialogue history', async () => {
      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null })
      });

      const summary = await generateSessionSummary('session-123');
      expect(summary).toBe('No activity recorded in this session');
    });

    it('should return default message if sessionId is missing', async () => {
      const summary = await generateSessionSummary('');
      expect(summary).toBe('No activity recorded in this session');
    });

    it('should handle database errors gracefully', async () => {
      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: null, error: { message: 'DB Error' } })
      });

      const summary = await generateSessionSummary('session-123');
      expect(summary).toBe('No activity recorded in this session');
    });
  });
});
