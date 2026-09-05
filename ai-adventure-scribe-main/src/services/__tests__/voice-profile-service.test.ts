/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { voiceProfileService, type VoiceProfile } from '../voice-profile-service';

import logger from '@/lib/logger';

// Use vi.hoisted to declare mocked functions that can be used in the hoisted vi.mock calls
const { mockGetProfile, mockUpsertProfile, mockGenerateText } = vi.hoisted(() => ({
  mockGetProfile: vi.fn(),
  mockUpsertProfile: vi.fn(),
  mockGenerateText: vi.fn(),
}));

vi.mock('@/services/issue-1784-api', () => ({
  issue1784Api: {
    getVoiceProfile: mockGetProfile,
    upsertVoiceProfile: mockUpsertProfile,
  },
}));

// Mock LLM API client
vi.mock('@/infrastructure/api', () => ({
  llmApiClient: {
    generateText: mockGenerateText,
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

describe('VoiceProfileService', () => {
  const mockCharacterId = 'char-123';
  const mockProfile: VoiceProfile = {
    id: 'profile-456',
    character_id: mockCharacterId,
    voice_style: 'raspy and slow',
    speech_patterns: ['frequent pauses', 'mumbles'],
    vocabulary_level: 'simple',
    tone: 'monotone',
    quirks: ['clears throat before speaking'],
    example_phrases: ['Hmm...', 'Let me think.'],
    consistency_score: 0.85,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getVoiceProfile', () => {
    it('should query database and return a voice profile on success', async () => {
      mockGetProfile.mockResolvedValueOnce(mockProfile);

      const result = await voiceProfileService.getVoiceProfile(mockCharacterId);

      expect(mockGetProfile).toHaveBeenCalledWith(mockCharacterId);
      expect(result).toEqual(mockProfile);
    });

    it('should return null and debug log on PGRST116 (not found) error', async () => {
      mockGetProfile.mockResolvedValueOnce(null);

      const result = await voiceProfileService.getVoiceProfile(mockCharacterId);

      expect(result).toBeNull();
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('No voice profile found'));
    });

    it('should return null and error log on other database errors', async () => {
      const mockDbError = new Error('DB connection error');
      mockGetProfile.mockRejectedValueOnce(mockDbError);

      const result = await voiceProfileService.getVoiceProfile(mockCharacterId);

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        'Error accessing voice profile database:',
        mockDbError,
      );
    });

    it('should return null and log exception on unexpected code crashes', async () => {
      const crashError = new Error('Database crash');
      mockGetProfile.mockRejectedValueOnce(crashError);

      const result = await voiceProfileService.getVoiceProfile(mockCharacterId);

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        'Error accessing voice profile database:',
        crashError,
      );
    });
  });

  describe('upsertVoiceProfile', () => {
    it('should perform upsert query and return updated profile on success', async () => {
      const inputProfile: Partial<VoiceProfile> = {
        voice_style: 'eloquent and fast',
        speech_patterns: ['articulate', 'precise'],
        vocabulary_level: 'advanced',
        quirks: ['uses rare idioms'],
      };

      const updatedProfileResponse = {
        ...mockProfile,
        ...inputProfile,
      };

      mockUpsertProfile.mockResolvedValueOnce(updatedProfileResponse);

      const result = await voiceProfileService.upsertVoiceProfile(mockCharacterId, inputProfile);

      expect(mockUpsertProfile).toHaveBeenCalledWith(mockCharacterId, {
        voice_style: 'eloquent and fast',
        speech_patterns: ['articulate', 'precise'],
        vocabulary_level: 'advanced',
        tone: '',
        quirks: ['uses rare idioms'],
        example_phrases: [],
        consistency_score: 0.0,
      });
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Voice profile saved for character'),
      );
      expect(result).toEqual(updatedProfileResponse);
    });

    it('should return null and log errors when upsert returns a database error', async () => {
      const mockDbError = new Error('Unique constraint violation');
      mockUpsertProfile.mockRejectedValueOnce(mockDbError);

      const result = await voiceProfileService.upsertVoiceProfile(mockCharacterId, {});

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith('Error upserting voice profile:', mockDbError);
    });

    it('should return null and log exception on unexpected exceptions', async () => {
      const crashError = new Error('Network timeout during upsert');
      mockUpsertProfile.mockRejectedValueOnce(crashError);

      const result = await voiceProfileService.upsertVoiceProfile(mockCharacterId, {});

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith('Error upserting voice profile:', crashError);
    });
  });

  describe('analyzeDialogue', () => {
    it('should return default profile if dialogue is empty or null', async () => {
      const result1 = await voiceProfileService.analyzeDialogue([]);
      expect(result1).toEqual({
        voice_style: 'neutral',
        speech_patterns: [],
        vocabulary_level: 'average',
        tone: 'neutral',
        quirks: [],
        example_phrases: [],
        consistency_score: 0.0,
      });
      expect(logger.warn).toHaveBeenCalledWith('No dialogue provided for analysis');

      const result2 = await voiceProfileService.analyzeDialogue(null as any);
      expect(result2).toEqual({
        voice_style: 'neutral',
        speech_patterns: [],
        vocabulary_level: 'average',
        tone: 'neutral',
        quirks: [],
        example_phrases: [],
        consistency_score: 0.0,
      });
    });

    it('should correctly analyze dialogue and parse JSON response from LLM API client', async () => {
      const dialogue = [
        'Halt! Who goes there?',
        'State your business with the captain, or be gone!',
      ];

      const mockAiResponse = `
        Some introductory conversational fluff.
        \`\`\`json
        {
          "voice_style": "authoritative and loud",
          "speech_patterns": ["stern tone", "military cadence"],
          "vocabulary_level": "simple",
          "tone": "commanding",
          "quirks": ["inflects upward on warnings"],
          "example_phrases": ["Halt! Who goes there?"],
          "consistency_score": 0.9
        }
        \`\`\`
        Concluding conversational fluff.
      `;

      mockGenerateText.mockResolvedValueOnce(mockAiResponse);

      const result = await voiceProfileService.analyzeDialogue(dialogue);

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining('Halt! Who goes there?'),
          temperature: 0.3,
          maxTokens: 1000,
        }),
      );

      expect(result).toEqual({
        voice_style: 'authoritative and loud',
        speech_patterns: ['stern tone', 'military cadence'],
        vocabulary_level: 'simple',
        tone: 'commanding',
        quirks: ['inflects upward on warnings'],
        example_phrases: ['Halt! Who goes there?'],
        consistency_score: 0.9,
      });

      expect(logger.info).toHaveBeenCalledWith('🎭 Voice analysis completed:', expect.any(Object));
    });

    it('should apply correct default properties/normalization if JSON keys are missing or invalid', async () => {
      const dialogue = ['Greetings, traveler.', 'May the stars guide you.'];

      const mockIncompleteAiResponse = `{
        "voice_style": null,
        "speech_patterns": "invalid_not_array",
        "vocabulary_level": "very_high_which_is_invalid",
        "quirks": {},
        "example_phrases": null,
        "consistency_score": "not_a_number"
      }`;

      mockGenerateText.mockResolvedValueOnce(mockIncompleteAiResponse);

      const result = await voiceProfileService.analyzeDialogue(dialogue);

      expect(result).toEqual({
        voice_style: 'neutral',
        speech_patterns: [],
        vocabulary_level: 'average',
        tone: 'neutral',
        quirks: [],
        example_phrases: ['Greetings, traveler.', 'May the stars guide you.'],
        consistency_score: 0.0,
      });
    });

    it('should clamp consistency_score between 0.0 and 1.0', async () => {
      const dialogue = ['I am the law!'];

      mockGenerateText.mockResolvedValueOnce(`{
        "consistency_score": 1.5,
        "vocabulary_level": "average"
      }`);
      const resultHigh = await voiceProfileService.analyzeDialogue(dialogue);
      expect(resultHigh.consistency_score).toBe(1.0);

      mockGenerateText.mockResolvedValueOnce(`{
        "consistency_score": -0.5,
        "vocabulary_level": "average"
      }`);
      const resultLow = await voiceProfileService.analyzeDialogue(dialogue);
      expect(resultLow.consistency_score).toBe(0.0);
    });

    it('should throw an error and log if AI response contains no JSON block', async () => {
      const dialogue = ['Hello'];
      mockGenerateText.mockResolvedValueOnce('This is plain text with no braces at all');

      // Failure results in fallback profile being returned gracefully
      const result = await voiceProfileService.analyzeDialogue(dialogue);

      expect(logger.error).toHaveBeenCalledWith('Failed to parse AI response for voice analysis');
      expect(result).toEqual({
        voice_style: 'neutral',
        speech_patterns: ['conversational'],
        vocabulary_level: 'average',
        tone: 'neutral',
        quirks: [],
        example_phrases: ['Hello'],
        consistency_score: 0.5,
      });
    });

    it('should return default fallback profile on general generator exception', async () => {
      const dialogue = ['Hello'];
      mockGenerateText.mockRejectedValueOnce(new Error('LLM Client rate limited'));

      const result = await voiceProfileService.analyzeDialogue(dialogue);

      expect(logger.error).toHaveBeenCalledWith('Error analyzing dialogue:', expect.any(Error));
      expect(result).toEqual({
        voice_style: 'neutral',
        speech_patterns: ['conversational'],
        vocabulary_level: 'average',
        tone: 'neutral',
        quirks: [],
        example_phrases: ['Hello'],
        consistency_score: 0.5,
      });
    });
  });

  describe('Integration: Voice Profile Workflow', () => {
    it('should create and retrieve voice profile from analyzed dialogue', async () => {
      const dialogue = [
        'Greetings, noble adventurers!',
        'Indeed, I have heard tales of your valor.',
        'Pray tell, what brings you to my humble establishment?',
      ];

      mockGenerateText.mockResolvedValueOnce(
        JSON.stringify({
          voice_style: 'eloquent',
          speech_patterns: ['formal', 'archaic phrasing'],
          vocabulary_level: 'archaic',
          tone: 'welcoming',
          quirks: ['uses "pray tell"'],
          example_phrases: dialogue,
          consistency_score: 0.88,
        }),
      );

      const analysis = await voiceProfileService.analyzeDialogue(dialogue);

      expect(analysis.voice_style).toBe('eloquent');
      expect(analysis.vocabulary_level).toBe('archaic');

      const characterId = 'char-merchant-1';
      const savedProfile: VoiceProfile = {
        id: 'profile-3',
        character_id: characterId,
        voice_style: 'eloquent',
        speech_patterns: ['formal', 'archaic phrasing'],
        vocabulary_level: 'archaic',
        tone: 'welcoming',
        quirks: ['uses "pray tell"'],
        example_phrases: dialogue,
        consistency_score: 0.88,
      };

      mockUpsertProfile.mockResolvedValueOnce(savedProfile);
      const upserted = await voiceProfileService.upsertVoiceProfile(characterId, analysis);
      expect(upserted).toEqual(savedProfile);

      mockGetProfile.mockResolvedValueOnce(savedProfile);
      const retrieved = await voiceProfileService.getVoiceProfile(characterId);

      expect(retrieved).toEqual(savedProfile);
      expect(retrieved?.voice_style).toBe('eloquent');
      expect(retrieved?.vocabulary_level).toBe('archaic');
    });
  });
});
