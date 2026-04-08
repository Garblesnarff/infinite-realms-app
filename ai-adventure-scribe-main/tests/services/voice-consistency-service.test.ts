import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import { voiceConsistencyService, type VoiceProfile } from '@/services/voice-consistency-service';
import { voiceProfileService } from '@/services/voice-profile-service';

// Mock Supabase client
vi.mock('@/integrations/supabase/client', () => {
  let mockData: any = null;
  let mockError: any = null;

  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    single: vi.fn(async () => ({ data: mockData, error: mockError })),
    upsert: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
  } as any;

  const supabase = {
    from: vi.fn((_table: string) => chain),
  } as any;

  return {
    supabase,
    __mock: {
      setData: (d: any) => (mockData = d),
      setError: (e: any) => (mockError = e),
      chain,
    },
  };
});

// Mock VoiceProfileService
vi.mock('@/services/voice-profile-service', () => ({
  voiceProfileService: {
    getVoiceProfile: vi.fn(),
    upsertVoiceProfile: vi.fn(),
    analyzeDialogue: vi.fn(),
  },
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('VoiceConsistencyService (Delegation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getVoiceProfile delegation', () => {
    it('should delegate getVoiceProfile to voiceProfileService', async () => {
      const mockProfile: VoiceProfile = {
        id: 'profile-1',
        character_id: 'char-1',
        voice_style: 'eloquent',
        speech_patterns: ['formal'],
        vocabulary_level: 'advanced',
        tone: 'serious',
        quirks: [],
        example_phrases: [],
        consistency_score: 0.90,
      };

      vi.mocked(voiceProfileService.getVoiceProfile).mockResolvedValue(mockProfile);

      const result = await voiceConsistencyService.getVoiceProfile('char-1');

      expect(result).toEqual(mockProfile);
      expect(voiceProfileService.getVoiceProfile).toHaveBeenCalledWith('char-1');
    });
  });

  describe('upsertVoiceProfile delegation', () => {
    it('should delegate upsertVoiceProfile to voiceProfileService', async () => {
      const newProfile: Partial<VoiceProfile> = {
        voice_style: 'timid',
      };

      const savedProfile: VoiceProfile = {
        id: 'profile-2',
        character_id: 'char-4',
        voice_style: 'timid',
        speech_patterns: [],
        vocabulary_level: 'average',
        tone: 'neutral',
        quirks: [],
        example_phrases: [],
        consistency_score: 0.70,
      };

      vi.mocked(voiceProfileService.upsertVoiceProfile).mockResolvedValue(savedProfile);

      const result = await voiceConsistencyService.upsertVoiceProfile('char-4', newProfile);

      expect(result).toEqual(savedProfile);
      expect(voiceProfileService.upsertVoiceProfile).toHaveBeenCalledWith('char-4', newProfile);
    });
  });

  describe('analyzeDialogue delegation', () => {
    it('should delegate analyzeDialogue to voiceProfileService', async () => {
      const dialogue = ['Test dialogue'];
      const mockAnalysis: Partial<VoiceProfile> = {
        voice_style: 'gruff',
      };

      vi.mocked(voiceProfileService.analyzeDialogue).mockResolvedValue(mockAnalysis);

      const result = await voiceConsistencyService.analyzeDialogue(dialogue);

      expect(result).toEqual(mockAnalysis);
      expect(voiceProfileService.analyzeDialogue).toHaveBeenCalledWith(dialogue);
    });
  });

  describe('Session Mapping logic (Existing)', () => {
    it('should normalize character names correctly', () => {
       // @ts-ignore - private method access for test
       const result = voiceConsistencyService.normalizeCharacterName('  The Goblin King!  ');
       expect(result).toBe('goblin king');
    });
  });
});
