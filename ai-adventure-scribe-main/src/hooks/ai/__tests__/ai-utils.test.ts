/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { formatDMTask, fetchGameContext, fetchMemories } from '../ai-utils';

import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';
import { MEMORY_SELECT_COLUMNS } from '@/types/memory';

// Mock dependencies
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
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

describe('ai-utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('formatDMTask', () => {
    it('should format a task object correctly with full context', () => {
      const messages: any[] = [{ id: '1', text: 'Hello', role: 'user' }];
      const latestMessage: any = {
        text: 'What do I see?',
        context: { intent: 'explore', emotion: 'curious' }
      };

      const result = formatDMTask(messages, latestMessage);

      expect(result).toMatchObject({
        description: 'Respond to player message: What do I see?',
        expectedOutput: 'D&D appropriate response with game context',
        context: {
          messageHistory: messages,
          playerIntent: 'explore',
          playerEmotion: 'curious',
        },
      });
      expect(result.id).toMatch(/^task_\d+$/);
    });

    it('should use default intent and emotion if not provided', () => {
      const messages: any[] = [];
      const latestMessage: any = { text: 'Hello' };

      const result = formatDMTask(messages, latestMessage);

      expect(result.context.playerIntent).toBe('query');
      expect(result.context.playerEmotion).toBe('neutral');
    });
  });

  describe('fetchGameContext', () => {
    it('should fetch and return campaign and character details', async () => {
      const mockSession = {
        id: 'session-123',
        campaign_id: 'campaign-456',
        character_id: 'char-789',
        campaigns: { id: 'campaign-456', name: 'Lost Mine' },
        characters: { id: 'char-789', name: 'Gundren' },
      };

      const mockSelect = vi.fn().mockReturnThis();
      const mockEq = vi.fn().mockReturnThis();
      const mockSingle = vi.fn().mockResolvedValue({ data: mockSession, error: null });

      (supabase.from as any).mockReturnValue({
        select: mockSelect,
      });
      mockSelect.mockReturnValue({
        eq: mockEq,
      });
      mockEq.mockReturnValue({
        single: mockSingle,
      });

      const result = await fetchGameContext('session-123');

      expect(supabase.from).toHaveBeenCalledWith('game_sessions');
      expect(result).toEqual({
        campaign: mockSession.campaigns,
        character: mockSession.characters,
      });
    });

    it('should return null and log error if session fetch fails', async () => {
      const mockError = { message: 'Database error' };

      const mockSingle = vi.fn().mockResolvedValue({ data: null, error: mockError });
      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: mockSingle,
      });

      const result = await fetchGameContext('session-123');

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith('Error fetching session:', mockError);
    });

    it('should return null if campaign_id or character_id is missing', async () => {
      const mockSession = { id: 'session-123', campaign_id: null, character_id: 'char-789' };

      const mockSingle = vi.fn().mockResolvedValue({ data: mockSession, error: null });
      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: mockSingle,
      });

      const result = await fetchGameContext('session-123');

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith('No campaign or character IDs found in session');
    });

    it('should handle exceptions and return null', async () => {
      (supabase.from as any).mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      const result = await fetchGameContext('session-123');

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith('Error in fetchGameContext:', expect.any(Error));
    });
  });

  describe('fetchMemories', () => {
    it('should fetch memories and validate their types', async () => {
      const mockMemories = [
        { id: 'm1', content: 'Met a goblin', type: 'npc' },
        { id: 'm2', content: 'Found a sword', type: 'invalid-type' },
        { id: 'm3', content: 'It was rainy', type: null },
      ];

      const mockEq = vi.fn().mockResolvedValue({ data: mockMemories, error: null });
      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: mockEq,
      });

      const result = await fetchMemories('session-123');

      expect(supabase.from).toHaveBeenCalledWith('memories');
      // Verify explicit columns used
      const selectCall = (supabase.from as any).mock.results[0].value.select;
      expect(selectCall).toHaveBeenCalledWith(MEMORY_SELECT_COLUMNS);

      expect(result).toHaveLength(3);
      expect(result[0].type).toBe('npc');
      expect(result[1].type).toBe('general'); // Normalized
      expect(result[2].type).toBe('general'); // Normalized

      expect(logger.warn).toHaveBeenCalledTimes(2);
      expect(logger.warn).toHaveBeenCalledWith("[Memory] Invalid memory type detected: invalid-type, defaulting to 'general'");
    });

    it('should return empty array if no memories found', async () => {
      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      });

      const result = await fetchMemories('session-123');

      expect(result).toEqual([]);
    });
  });
});
