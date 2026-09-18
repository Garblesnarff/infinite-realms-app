import { describe, it, expect, vi, beforeEach } from 'vitest';

import { VoiceConsistencyRepository } from '../voice-consistency-repository';

import logger from '@/lib/logger';

const { mockGetMappings, mockUpsertMapping, mockUpdateMapping } = vi.hoisted(() => ({
  mockGetMappings: vi.fn(),
  mockUpsertMapping: vi.fn(),
  mockUpdateMapping: vi.fn(),
}));

vi.mock('@/services/issue-1784-api', () => ({
  issue1784Api: {
    getVoiceMappings: mockGetMappings,
    upsertVoiceMapping: mockUpsertMapping,
    updateVoiceMapping: mockUpdateMapping,
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

      mockGetMappings.mockResolvedValueOnce(mockDbData);

      const result = await VoiceConsistencyRepository.getSessionMappings(sessionId);

      expect(mockGetMappings).toHaveBeenCalledWith(sessionId);
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
      mockGetMappings.mockResolvedValueOnce([]);

      const result = await VoiceConsistencyRepository.getSessionMappings(sessionId);

      expect(result).toEqual([]);
      expect(logger.debug).toHaveBeenCalledWith(
        expect.stringContaining(`No voice mappings found for session: ${sessionId}`),
      );
    });

    it('should return empty list and log error on database select failure', async () => {
      const mockError = new Error('Database connection failed');
      mockGetMappings.mockRejectedValueOnce(mockError);

      const result = await VoiceConsistencyRepository.getSessionMappings(sessionId);

      expect(result).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith('Error getting session mappings:', {
        message: 'Database connection failed',
        name: 'Error',
        status: undefined,
      });
    });

    it('should return empty list and log error on throw inside getSessionMappings', async () => {
      mockGetMappings.mockRejectedValueOnce(new Error('CRITICAL DB FAILURE'));

      const result = await VoiceConsistencyRepository.getSessionMappings(sessionId);

      expect(result).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith(
        'Error getting session mappings:',
        expect.objectContaining({
          message: 'CRITICAL DB FAILURE',
          name: 'Error',
        }),
      );
    });

    it('uses mappings returned as an already-parsed object', async () => {
      mockGetMappings.mockResolvedValueOnce([
        {
          id: 'mapping-obj',
          character_name: 'Professor Emil Darkwater',
          voice_category: 'villain_male',
          voice_id: 'voice-villain',
          last_used: '2026-09-15T12:00:00.000Z',
          updated_at: '2026-09-15T12:00:00.000Z',
          appearance_count: 4,
        },
      ]);

      const result = await VoiceConsistencyRepository.getSessionMappings(sessionId);

      expect(result).toEqual([
        {
          id: 'mapping-obj',
          characterName: 'Professor Emil Darkwater',
          voiceCategory: 'villain_male',
          voiceId: 'voice-villain',
          lastUsed: new Date('2026-09-15T12:00:00.000Z'),
          appearanceCount: 4,
        },
      ]);
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('parses mappings returned as a JSON string', async () => {
      mockGetMappings.mockResolvedValueOnce(
        JSON.stringify([
          {
            id: 'mapping-str',
            character_name: 'Professor Emil Darkwater',
            voice_category: 'villain_male',
            voice_id: 'voice-villain',
            last_used: '2026-09-15T12:00:00.000Z',
            updated_at: '2026-09-15T12:00:00.000Z',
            appearance_count: 2,
          },
        ]),
      );

      const result = await VoiceConsistencyRepository.getSessionMappings(sessionId);

      expect(result).toEqual([
        {
          id: 'mapping-str',
          characterName: 'Professor Emil Darkwater',
          voiceCategory: 'villain_male',
          voiceId: 'voice-villain',
          lastUsed: new Date('2026-09-15T12:00:00.000Z'),
          appearanceCount: 2,
        },
      ]);
    });

    it('returns an empty map and logs VOICE_MAPPINGS_UNREADABLE on malformed mappings', async () => {
      mockGetMappings.mockResolvedValueOnce('[object Object]');

      const result = await VoiceConsistencyRepository.getSessionMappings(sessionId);

      expect(result).toEqual([]);
      expect(logger.error).toHaveBeenCalledWith('VOICE_MAPPINGS_UNREADABLE', { sessionId });
    });

    it.each([null, undefined, 12])(
      'returns an empty map and logs VOICE_MAPPINGS_UNREADABLE when mappings are %s',
      async (payload) => {
        mockGetMappings.mockResolvedValueOnce(payload);

        const result = await VoiceConsistencyRepository.getSessionMappings(sessionId);

        expect(result).toEqual([]);
        expect(logger.error).toHaveBeenCalledWith('VOICE_MAPPINGS_UNREADABLE', {
          sessionId,
          shape: typeof payload,
        });
      },
    );
  });

  describe('saveCharacterVoiceMapping', () => {
    it('should insert new character voice mapping successfully', async () => {
      mockUpsertMapping.mockResolvedValueOnce({});

      await VoiceConsistencyRepository.saveCharacterVoiceMapping(
        'session-123',
        'Bruenor',
        'elder',
        'voice-bruenor',
        3,
      );

      expect(mockUpsertMapping).toHaveBeenCalledWith('session-123', {
        character_name: 'Bruenor',
        voice_category: 'elder',
        voice_id: 'voice-bruenor',
        appearance_count: 3,
      });
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Bruenor -> elder'));
    });

    it('should default appearance_count to 1 when omitted', async () => {
      mockUpsertMapping.mockResolvedValueOnce({});

      await VoiceConsistencyRepository.saveCharacterVoiceMapping(
        'session-123',
        'Bruenor',
        'elder',
        'voice-bruenor',
      );

      expect(mockUpsertMapping).toHaveBeenCalledWith('session-123', {
        character_name: 'Bruenor',
        voice_category: 'elder',
        voice_id: 'voice-bruenor',
        appearance_count: 1,
      });
    });

    it('should throw or log error on database insert failure', async () => {
      const mockError = new Error('Unique constraint violation');
      mockUpsertMapping.mockRejectedValueOnce(mockError);

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
      mockUpdateMapping.mockResolvedValueOnce({});

      await VoiceConsistencyRepository.updateCharacterUsage('mapping-123', 8);

      expect(mockUpdateMapping).toHaveBeenCalledWith('mapping-123', { appearance_count: 8 });
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('mapping-123 (count: 8)'));
    });

    it('should log error on database update failure', async () => {
      const mockError = new Error('Foreign key failure');
      mockUpdateMapping.mockRejectedValueOnce(mockError);

      await VoiceConsistencyRepository.updateCharacterUsage('mapping-123', 8);

      expect(logger.error).toHaveBeenCalledWith('Error updating character usage:', mockError);
    });
  });
});
