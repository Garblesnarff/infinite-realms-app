/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { VoiceConsistencyRepository } from '../voice/voice-consistency-repository';
import { VoiceConsistencyService } from '../voice-consistency-service';
import { VoiceMapper } from '../voice-mapper';
import { voiceProfileService } from '../voice-profile-service';

import logger from '@/lib/logger';

// Mock VoiceConsistencyRepository
vi.mock('../voice/voice-consistency-repository', () => ({
  VoiceConsistencyRepository: {
    getSessionMappings: vi.fn(),
    saveCharacterVoiceMapping: vi.fn(),
    updateCharacterUsage: vi.fn(),
  },
}));

// Mock voiceProfileService
vi.mock('../voice-profile-service', () => ({
  voiceProfileService: {
    getVoiceProfile: vi.fn(),
    upsertVoiceProfile: vi.fn(),
    analyzeDialogue: vi.fn(),
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

describe('VoiceConsistencyService', () => {
  let service: VoiceConsistencyService;
  const sessionId = 'session-999';

  beforeEach(() => {
    vi.clearAllMocks();
    service = new VoiceConsistencyService();
  });

  describe('getSessionVoiceContext', () => {
    it('should retrieve mappings and map them to SessionVoiceContext correctly', async () => {
      const mockDate = new Date('2026-03-30T15:00:00.000Z');
      const mockMappings = [
        {
          id: 'mapping-1',
          characterName: 'Drizzt',
          voiceCategory: 'hero_male',
          voiceId: 'voice-drizzt',
          lastUsed: mockDate,
          appearanceCount: 12,
        },
        {
          id: 'mapping-2',
          characterName: 'Catti-Brie',
          voiceCategory: 'hero_female',
          voiceId: 'voice-catti',
          lastUsed: mockDate,
          appearanceCount: 4,
        },
      ];

      vi.mocked(VoiceConsistencyRepository.getSessionMappings).mockResolvedValueOnce(mockMappings);

      const result = await service.getSessionVoiceContext(sessionId);

      expect(VoiceConsistencyRepository.getSessionMappings).toHaveBeenCalledWith(sessionId);
      expect(result.knownCharacters).toEqual({
        Drizzt: {
          voiceCategory: 'hero_male',
          appearances: 12,
          lastUsed: mockDate,
        },
        'Catti-Brie': {
          voiceCategory: 'hero_female',
          appearances: 4,
          lastUsed: mockDate,
        },
      });

      // default is excluded, should contain others like hero_male, elder, etc.
      expect(result.availableVoiceCategories).toContain('hero_male');
      expect(result.availableVoiceCategories).toContain('elder');
      expect(result.availableVoiceCategories).not.toContain('default');
    });

    it('should return minimal context when Repository throws or rejects', async () => {
      vi.mocked(VoiceConsistencyRepository.getSessionMappings).mockRejectedValueOnce(new Error('DB failure'));

      const result = await service.getSessionVoiceContext(sessionId);

      expect(result.knownCharacters).toEqual({});
      expect(result.availableVoiceCategories).toContain('hero_male');
      expect(result.availableVoiceCategories).not.toContain('default');
      expect(logger.error).toHaveBeenCalledWith('Error getting session voice context:', expect.any(Error));
    });
  });

  describe('processVoiceAssignments', () => {
    it('should correctly assign voices and perform aggregated database operations in parallel', async () => {
      const mockDate = new Date();
      const mockMappings = [
        {
          id: 'map-id-drizzt',
          characterName: 'drizzt',
          voiceCategory: 'hero_male',
          voiceId: 'voice-drizzt',
          lastUsed: mockDate,
          appearanceCount: 3,
        },
      ];

      vi.mocked(VoiceConsistencyRepository.getSessionMappings).mockResolvedValueOnce(mockMappings);
      vi.mocked(VoiceConsistencyRepository.updateCharacterUsage).mockResolvedValue(undefined as any);
      vi.mocked(VoiceConsistencyRepository.saveCharacterVoiceMapping).mockResolvedValue(undefined as any);

      // Segments containing narration, existing character, and new character
      const segments = [
        { type: 'narration', text: 'Suddenly, a cold wind blows.' },
        { type: 'dialogue', text: 'I walk in silence.', character: 'Drizzt' },
        { type: 'dialogue', text: 'I walk in silence again.', character: 'Drizzt' },
        { type: 'dialogue', text: 'By the hammer of Moradin!', character: 'Bruenor', voice_category: 'elder' },
      ];

      const result = await service.processVoiceAssignments(sessionId, segments);

      // Assert segment voice assignments
      expect(result).toHaveLength(4);

      // Narrator segment
      expect(result[0]).toEqual({
        character: 'narrator',
        voiceCategory: 'narrator',
        voiceConfig: VoiceMapper.getNarratorVoice(),
        isNewCharacter: false,
      });

      // Existing Drizzt segments (normalized to lowercase)
      expect(result[1]).toEqual({
        character: 'drizzt',
        voiceCategory: 'hero_male',
        voiceConfig: VoiceMapper.getAllVoices().hero_male,
        isNewCharacter: false,
      });
      expect(result[2]).toEqual({
        character: 'drizzt',
        voiceCategory: 'hero_male',
        voiceConfig: VoiceMapper.getAllVoices().hero_male,
        isNewCharacter: false,
      });

      // New Bruenor segment
      expect(result[3]).toEqual({
        character: 'bruenor',
        voiceCategory: 'elder',
        voiceConfig: VoiceMapper.getAllVoices().elder,
        isNewCharacter: true,
      });

      // Assert updates were aggregated: Drizzt was hit twice, so total count increases by 2: 3 + 2 = 5
      expect(VoiceConsistencyRepository.updateCharacterUsage).toHaveBeenCalledTimes(1);
      expect(VoiceConsistencyRepository.updateCharacterUsage).toHaveBeenCalledWith('map-id-drizzt', 5);

      // Assert insertions were aggregated: Bruenor was hit once
      expect(VoiceConsistencyRepository.saveCharacterVoiceMapping).toHaveBeenCalledTimes(1);
      expect(VoiceConsistencyRepository.saveCharacterVoiceMapping).toHaveBeenCalledWith(
        sessionId,
        'bruenor',
        'elder',
        VoiceMapper.getAllVoices().elder.id,
        1,
      );
    });

    it('should fallback to default or inferred voice category for a new character if voice_category is not provided', async () => {
      vi.mocked(VoiceConsistencyRepository.getSessionMappings).mockResolvedValueOnce([]);
      vi.mocked(VoiceConsistencyRepository.saveCharacterVoiceMapping).mockResolvedValue(undefined as any);

      const segments = [
        { type: 'dialogue', text: 'Halt!', character: 'Captain of the Guard' }, // should infer 'guard' or something else
      ];

      const result = await service.processVoiceAssignments(sessionId, segments);

      expect(result[0].character).toBe('captain of the guard');
      expect(result[0].isNewCharacter).toBe(true);
      // Let's verify that a voice was mapped
      expect(result[0].voiceCategory).toBeDefined();
      expect(result[0].voiceConfig).toBeDefined();

      expect(VoiceConsistencyRepository.saveCharacterVoiceMapping).toHaveBeenCalledTimes(1);
    });
  });

  describe('clearSessionCache', () => {
    it('should print log when clearing session cache', () => {
      service.clearSessionCache(sessionId);
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(`Cleared voice cache for session: ${sessionId}`));
    });
  });

  describe('getSessionStats', () => {
    it('should calculate session statistics from database mappings', async () => {
      const mockMappings = [
        {
          id: 'm1',
          characterName: 'Aribeth',
          voiceCategory: 'hero_female',
          voiceId: 'v1',
          lastUsed: new Date('2026-03-30T10:00:00.000Z'),
          appearanceCount: 1,
        },
        {
          id: 'm2',
          characterName: 'Fenthick',
          voiceCategory: 'hero_male',
          voiceId: 'v2',
          lastUsed: new Date('2026-03-30T12:00:00.000Z'),
          appearanceCount: 3,
        },
        {
          id: 'm3',
          characterName: 'Nasher',
          voiceCategory: 'elder',
          voiceId: 'v3',
          lastUsed: new Date('2026-03-30T11:00:00.000Z'),
          appearanceCount: 5,
        },
      ];

      vi.mocked(VoiceConsistencyRepository.getSessionMappings).mockResolvedValueOnce(mockMappings);

      const stats = await service.getSessionStats(sessionId);

      expect(stats.totalCharacters).toBe(3);
      expect(stats.voiceCategoryCounts).toEqual({
        hero_female: 1,
        hero_male: 1,
        elder: 1,
      });

      // recentCharacters should be sorted by lastUsed descending: Fenthick (12:00), Nasher (11:00), Aribeth (10:00)
      expect(stats.recentCharacters).toEqual([
        'Fenthick(hero_male)',
        'Nasher(elder)',
        'Aribeth(hero_female)',
      ]);
    });
  });

  describe('Delegated voiceProfileService methods', () => {
    const characterId = 'char-abc';

    it('should delegate getVoiceProfile to voiceProfileService', async () => {
      const mockProfile = { id: 'prof-1' } as any;
      vi.mocked(voiceProfileService.getVoiceProfile).mockResolvedValueOnce(mockProfile);

      const result = await service.getVoiceProfile(characterId);

      expect(voiceProfileService.getVoiceProfile).toHaveBeenCalledWith(characterId);
      expect(result).toBe(mockProfile);
    });

    it('should delegate upsertVoiceProfile to voiceProfileService', async () => {
      const partialProfile = { tone: 'authoritative' };
      const mockProfile = { id: 'prof-1', ...partialProfile } as any;
      vi.mocked(voiceProfileService.upsertVoiceProfile).mockResolvedValueOnce(mockProfile);

      const result = await service.upsertVoiceProfile(characterId, partialProfile);

      expect(voiceProfileService.upsertVoiceProfile).toHaveBeenCalledWith(characterId, partialProfile);
      expect(result).toBe(mockProfile);
    });

    it('should delegate analyzeDialogue to voiceProfileService', async () => {
      const dialogue = ['Hello', 'World'];
      const partialProfile = { tone: 'kind' };
      vi.mocked(voiceProfileService.analyzeDialogue).mockResolvedValueOnce(partialProfile);

      const result = await service.analyzeDialogue(dialogue);

      expect(voiceProfileService.analyzeDialogue).toHaveBeenCalledWith(dialogue);
      expect(result).toBe(partialProfile);
    });
  });
});
