

/* eslint-disable @typescript-eslint/no-restricted-imports */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { VoiceConsistencyRepository } from '../voice-consistency-repository';

import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';

// Set up hoisted spy/mock functions
const { mockSelect, mockEq, mockInsert, mockUpdate } = vi.hoisted(() => ({
  mockSelect: vi.fn().mockReturnThis(),
  mockEq: vi.fn().mockReturnThis(),
  mockInsert: vi.fn(),
  mockUpdate: vi.fn().mockReturnThis(),
}));

// Mock Supabase client
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: mockSelect,
      eq: mockEq,
      insert: mockInsert,
      update: mockUpdate,
    })),
  },
}));

// Mock logger
vi.mock('@/lib/logger', () => {
  const m = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return {
    __esModule: true,
    default: m,
    logger: m,
  };
});

describe('VoiceConsistencyRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnThis();
    mockEq.mockReturnThis();
    mockUpdate.mockReturnThis();
  });

  describe('getSessionMappings', () => {
    const sessionId = 'session-123';

    it('should successfully retrieve and map session voice mappings', async () => {
      const mockDbData = [
        {
          id: 'mapping-1',
          character_name: 'Drizzt',
          voice_category: 'hero_male',
          voice_id: 'voice-drizzt',
          last_used: '2026-03-30T12:00:00.000Z',
          updated_at: '2026-03-30T12:00:00.000Z',
          appearance_count: 5,
        },
        {
          id: 'mapping-2',
          character_name: 'Elminster',
          voice_category: 'elder',
          voice_id: 'voice-elminster',
          last_used: null,
          updated_at: '2026-03-30T13:00:00.000Z',
          appearance_count: null,
        },
      ];

      mockEq.mockResolvedValueOnce({ data: mockDbData, error: null });

      const result = await VoiceConsistencyRepository.getSessionMappings(sessionId);

      expect(supabase.from).toHaveBeenCalledWith('character_voice_mappings');
      expect(mockSelect).toHaveBeenCalledWith(
        'id, character_name, voice_category, voice_id, last_used, updated_at, appearance_count',
      );
      expect(mockEq).toHaveBeenCalledWith('session_id', sessionId);
      expect(result).toHaveLength(2);

      // Mapping 1 assertions
      expect(result[0]).toEqual({
        id: 'mapping-1',
        characterName: 'Drizzt',
        voiceCategory: 'hero_male',
        voiceId: 'voice-drizzt',
        lastUsed: new Date('2026-03-30T12:00:00.000Z'),
        appearanceCount: 5,
      });

      // Mapping 2 assertions with fallbacks
      expect(result[1].id).toBe('mapping-2');
      expect(result[1].characterName).toBe('Elminster');
      expect(result[1].voiceCategory).toBe('elder');
      expect(result[1].voiceId).toBe('voice-elminster');
      expect(result[1].appearanceCount).toBe(1); // falls back to 1 when appearance_count is null
      expect(result[1].lastUsed).toBeInstanceOf(Date);
    });

    it('should return empty list when no mappings exist', async () => {
      mockEq.mockResolvedValueOnce({ data: [], error: null });

      const result = await VoiceConsistencyRepository.getSessionMappings(sessionId);

      expect(result).toEqual([]);
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining(`No voice mappings found for session: ${sessionId}`));
    });

    it('should return empty list and log error on database select failure', async () => {
      const mockError = { message: 'Database connection failed' };
      mockEq.mockResolvedValueOnce({ data: null, error: mockError });

      const result = await VoiceConsistencyRepository.getSessionMappings(sessionId);

      expect(result).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith('Error fetching voice mappings:', mockError);
    });

    it('should return empty list and log error on throw inside getSessionMappings', async () => {
      mockEq.mockRejectedValueOnce(new Error('CRITICAL DB FAILURE'));

      const result = await VoiceConsistencyRepository.getSessionMappings(sessionId);

      expect(result).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith('Error getting session mappings:', expect.any(Error));
    });
  });

  describe('saveCharacterVoiceMapping', () => {
    it('should insert new character voice mapping successfully', async () => {
      mockInsert.mockResolvedValueOnce({ error: null });

      await VoiceConsistencyRepository.saveCharacterVoiceMapping(
        'session-123',
        'Bruenor',
        'elder',
        'voice-bruenor',
        3,
      );

      expect(supabase.from).toHaveBeenCalledWith('character_voice_mappings');
      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          session_id: 'session-123',
          character_name: 'Bruenor',
          voice_category: 'elder',
          voice_id: 'voice-bruenor',
          appearance_count: 3,
          first_appearance: expect.any(String),
          last_used: expect.any(String),
          metadata: {},
        }),
      );
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Bruenor -> elder'));
    });

    it('should default appearance_count to 1 when omitted', async () => {
      mockInsert.mockResolvedValueOnce({ error: null });

      await VoiceConsistencyRepository.saveCharacterVoiceMapping(
        'session-123',
        'Bruenor',
        'elder',
        'voice-bruenor',
      );

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          appearance_count: 1,
        }),
      );
    });

    it('should throw or log error on database insert failure', async () => {
      const mockError = { message: 'Unique constraint violation' };
      mockInsert.mockResolvedValueOnce({ error: mockError });

      await VoiceConsistencyRepository.saveCharacterVoiceMapping(
        'session-123',
        'Bruenor',
        'elder',
        'voice-bruenor',
      );

      expect(logger.error).toHaveBeenCalledWith('Error saving character voice mapping:', mockError);
    });
  });

  describe('updateCharacterUsage', () => {
    it('should update character usage successfully', async () => {
      mockEq.mockResolvedValueOnce({ error: null });

      await VoiceConsistencyRepository.updateCharacterUsage('mapping-123', 8);

      expect(supabase.from).toHaveBeenCalledWith('character_voice_mappings');
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          appearance_count: 8,
          last_used: expect.any(String),
          updated_at: expect.any(String),
        }),
      );
      expect(mockEq).toHaveBeenCalledWith('id', 'mapping-123');
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('mapping-123 (count: 8)'));
    });

    it('should log error on database update failure', async () => {
      const mockError = { message: 'Foreign key failure' };
      mockEq.mockResolvedValueOnce({ error: mockError });

      await VoiceConsistencyRepository.updateCharacterUsage('mapping-123', 8);

      expect(logger.error).toHaveBeenCalledWith('Error updating character usage:', mockError);
    });
  });
});
