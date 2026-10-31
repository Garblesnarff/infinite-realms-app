/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { VoiceConsistencyRepository } from '../voice/voice-consistency-repository';
import { VoiceConsistencyService } from '../voice-consistency-service';
import { VoiceDirector } from '../voice-director';
import { voiceProfileService } from '../voice-profile-service';
import { clearCharacterVoiceMappings } from '../voice-routing';

import logger from '@/lib/logger';

// Mock VoiceConsistencyRepository
vi.mock('../voice/voice-consistency-repository', () => ({
  VoiceConsistencyRepository: {
    getSessionMappings: vi.fn(),
    castSegments: vi.fn(),
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
    vi.resetAllMocks();
    clearCharacterVoiceMappings();
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
      vi.mocked(VoiceConsistencyRepository.getSessionMappings).mockRejectedValueOnce(
        new Error('DB failure'),
      );

      const result = await service.getSessionVoiceContext(sessionId);

      expect(result.knownCharacters).toEqual({});
      expect(result.availableVoiceCategories).toContain('hero_male');
      expect(result.availableVoiceCategories).not.toContain('default');
      expect(logger.error).toHaveBeenCalledWith('Error getting session voice context:', {
        message: 'DB failure',
        name: 'Error',
      });
    });
  });

  describe('processVoiceAssignments', () => {
    const spoken = (character: string, voice_id: string, voice_category?: string) => ({
      type: 'character',
      text: 'Hello.',
      character,
      voice_category,
      voice_id,
      npc_id: `npc-${character}`,
      voice_muted: false,
    });

    it('should correctly assign voices with one server batch and no client database writes', async () => {
      const cast = [
        { ...spoken('narrator', 'narrator', 'narrator'), type: 'dm', npc_id: null },
        spoken('Drizzt', 'thomas', 'hero_male'),
        spoken('Drizzt', 'thomas', 'hero_male'),
        spoken('Bruenor', 'sam', 'elder'),
      ];
      vi.mocked(VoiceConsistencyRepository.castSegments).mockResolvedValueOnce(cast);
      const segments = cast.map(
        ({ voice_id: _voice, npc_id: _npc, voice_muted: _muted, ...segment }) => segment,
      );
      const result = await service.processVoiceAssignments(sessionId, segments);
      expect(result.map((a) => a.voiceConfig.id)).toEqual(['narrator', 'thomas', 'thomas', 'sam']);
      expect(VoiceConsistencyRepository.castSegments).toHaveBeenCalledWith(sessionId, segments);
    });

    it('should pass server category assignments into VoiceDirector playback', async () => {
      vi.mocked(VoiceConsistencyRepository.castSegments).mockResolvedValueOnce([
        spoken('Veteran', 'sam', 'elder'),
        spoken('Sergeant Vance', 'thomas', 'gruff'),
      ]);
      await service.processVoiceAssignments(sessionId, [
        { type: 'character', text: 'The road is clear.', character: 'Veteran' },
        { type: 'character', text: 'Halt.', character: 'Sergeant Vance' },
      ]);
      const playback = VoiceDirector.processAISegments([
        { type: 'character', text: 'The road is clear.', character: 'Veteran' },
        { type: 'character', text: 'Halt.', character: 'Sergeant Vance' },
      ]);
      expect(playback.map((s) => s.voiceId)).toEqual(['sam', 'thomas']);
    });

    it('should use a server cast instead of a stale persisted narrator fallback', async () => {
      vi.mocked(VoiceConsistencyRepository.getSessionMappings).mockResolvedValueOnce([
        {
          id: 'old',
          characterName: 'sergeant vance',
          voiceCategory: 'gruff',
          voiceId: 'bIHbv24MWmeRgasZH58o',
          lastUsed: new Date(),
          appearanceCount: 1,
        },
      ]);
      vi.mocked(VoiceConsistencyRepository.castSegments).mockResolvedValueOnce([
        spoken('Sergeant Vance', 'thomas', 'guard'),
      ]);
      const result = await service.processVoiceAssignments(sessionId, [
        { type: 'character', text: 'Halt.', character: 'Sergeant Vance' },
      ]);
      expect(result[0].voiceConfig.id).toBe('thomas');
      expect(VoiceConsistencyRepository.getSessionMappings).not.toHaveBeenCalled();
    });

    it('should let the server infer a new character without a voice_category', async () => {
      const segments = [{ type: 'character', text: 'Halt!', character: 'Captain of the Guard' }];
      vi.mocked(VoiceConsistencyRepository.castSegments).mockResolvedValueOnce([
        spoken('Captain of the Guard', 'thomas', 'guard'),
      ]);
      const result = await service.processVoiceAssignments(sessionId, segments);
      expect(result[0].character).toBe('captain of the guard');
      expect(result[0].voiceConfig.id).toBe('thomas');
      expect(VoiceConsistencyRepository.castSegments).toHaveBeenCalledWith(sessionId, segments);
    });

    it('should leave free-text labels and unknown categories to the server', async () => {
      const segments = [
        {
          type: 'character',
          text: 'P-please...',
          character: 'Professor Emil Darkwater',
          voice_category: 'high-pitched, fast, breathless',
        },
        { type: 'character', text: 'Sit.', character: 'Innkeep Mara', voice_category: 'calm' },
        {
          type: 'character',
          text: 'The road is clear.',
          character: 'Veteran',
          voice_category: 'narrative',
        },
        {
          type: 'character',
          text: 'Who am I?',
          character: 'Mystery',
          voice_category: 'unmapped_style',
        },
      ];
      vi.mocked(VoiceConsistencyRepository.castSegments).mockResolvedValueOnce([
        spoken('Professor Emil Darkwater', 'mouse'),
        spoken('Innkeep Mara', 'serena'),
        spoken('Veteran', 'sam'),
        spoken('Mystery', 'nathan'),
      ]);
      const result = await service.processVoiceAssignments(sessionId, segments);
      expect(result.map((a) => a.voiceConfig.id)).toEqual(['mouse', 'serena', 'sam', 'nathan']);
      expect(VoiceConsistencyRepository.castSegments).toHaveBeenCalledWith(sessionId, segments);
    });

    it('should keep an unknown speaker audible with its provisional NPC voice', async () => {
      vi.mocked(VoiceConsistencyRepository.castSegments).mockResolvedValueOnce([
        spoken('Unknown NPC', 'fena'),
      ]);
      const result = await service.processVoiceAssignments(sessionId, [
        { type: 'character', text: 'Hello?', character: 'Unknown NPC' },
      ]);
      expect(result[0].voiceConfig.id).toBe('fena');
      expect(result[0].character).toBe('unknown npc');
    });

    it('omits player dialogue and ignores a response after cancellation', async () => {
      vi.mocked(VoiceConsistencyRepository.castSegments).mockResolvedValueOnce([
        { ...spoken('Player', ''), voice_muted: true },
      ]);
      expect(
        await service.processVoiceAssignments(sessionId, [
          { type: 'character', text: 'Hi', character: 'Player' },
        ]),
      ).toEqual([]);
      const controller = new AbortController();
      controller.abort();
      expect(await service.processVoiceAssignments(sessionId, [], controller.signal)).toEqual([]);
      expect(VoiceConsistencyRepository.castSegments).toHaveBeenCalledTimes(1);
    });
  });

  describe('clearSessionCache', () => {
    it('should print log when clearing session cache', () => {
      service.clearSessionCache(sessionId);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining(`Cleared voice cache for session: ${sessionId}`),
      );
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

      expect(voiceProfileService.upsertVoiceProfile).toHaveBeenCalledWith(
        characterId,
        partialProfile,
      );
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
