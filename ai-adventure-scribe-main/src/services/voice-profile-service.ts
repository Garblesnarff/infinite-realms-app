/**
 * Voice Profile Service
 *
 * Manages rich character voice profiles and AI-powered dialogue analysis.
 * Handles persistent voice characteristics like style, tone, and quirks.
 *
 * Dependencies:
 * - Authenticated #1784 voice-profile API
 * - LLM API client (src/services/llm-api-client.ts)
 *
 * @author AI Dungeon Master Team
 */

import { llmApiClient } from '@/infrastructure/api';
import logger from '@/lib/logger';
import { issue1784Api } from '@/services/issue-1784-api';

export interface VoiceProfile {
  id?: string;
  character_id: string;
  voice_style: string;
  speech_patterns: string[];
  vocabulary_level: 'simple' | 'average' | 'advanced' | 'archaic';
  tone: string;
  quirks: string[];
  example_phrases: string[];
  consistency_score: number;
  created_at?: Date;
  updated_at?: Date;
}

export class VoiceProfileService {
  /**
   * Retrieves the voice profile for a character
   */
  async getVoiceProfile(characterId: string): Promise<VoiceProfile | null> {
    try {
      const data = await issue1784Api.getVoiceProfile(characterId);
      if (!data) {
        logger.debug(`No voice profile found for character: ${characterId}`);
        return null;
      }
      return data as VoiceProfile;
    } catch (error) {
      logger.error('Error accessing voice profile database:', error);
      return null;
    }
  }

  /**
   * Creates or updates a character's voice profile
   */
  async upsertVoiceProfile(
    characterId: string,
    profile: Partial<Omit<VoiceProfile, 'id' | 'character_id' | 'created_at' | 'updated_at'>>,
  ): Promise<VoiceProfile | null> {
    try {
      const data = await issue1784Api.upsertVoiceProfile(characterId, {
        voice_style: profile.voice_style || '',
        speech_patterns: profile.speech_patterns || [],
        vocabulary_level: profile.vocabulary_level || 'average',
        tone: profile.tone || '',
        quirks: profile.quirks || [],
        example_phrases: profile.example_phrases || [],
        consistency_score: profile.consistency_score || 0.0,
      });

      logger.info(`✅ Voice profile saved for character: ${characterId}`);
      return data as VoiceProfile;
    } catch (error) {
      logger.error('Error upserting voice profile:', error);
      return null;
    }
  }

  /**
   * Analyzes dialogue to extract voice characteristics using AI
   */
  async analyzeDialogue(dialogue: string[]): Promise<Partial<VoiceProfile>> {
    try {
      if (!dialogue || dialogue.length === 0) {
        logger.warn('No dialogue provided for analysis');
        return {
          voice_style: 'neutral',
          speech_patterns: [],
          vocabulary_level: 'average',
          tone: 'neutral',
          quirks: [],
          example_phrases: [],
          consistency_score: 0.0,
        };
      }

      const prompt = `Analyze the following dialogue samples and extract voice characteristics:

Dialogue samples:
${dialogue.map((line, i) => `${i + 1}. "${line}"`).join('\n')}

Please analyze and provide a JSON response with the following structure:
{
  "voice_style": "string describing overall style (e.g., gruff, eloquent, timid, confident)",
  "speech_patterns": ["array", "of", "speech", "pattern", "descriptors"],
  "vocabulary_level": "simple|average|advanced|archaic",
  "tone": "string describing emotional tone (e.g., serious, humorous, sarcastic)",
  "quirks": ["array", "of", "unique", "speech", "quirks"],
  "example_phrases": ["array", "of", "representative", "phrases"],
  "consistency_score": 0.85
}

Be specific and base your analysis on the actual dialogue provided. The consistency_score should be between 0 and 1.`;

      const response = await llmApiClient.generateText({
        prompt,
        temperature: 0.3,
        maxTokens: 1000,
      });

      // Parse the JSON response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.error('Failed to parse AI response for voice analysis');
        throw new Error('Invalid AI response format');
      }

      const analysis = JSON.parse(jsonMatch[0]);

      // Validate and normalize the response
      const voiceProfile: Partial<VoiceProfile> = {
        voice_style: analysis.voice_style || 'neutral',
        speech_patterns: Array.isArray(analysis.speech_patterns) ? analysis.speech_patterns : [],
        vocabulary_level: ['simple', 'average', 'advanced', 'archaic'].includes(
          analysis.vocabulary_level,
        )
          ? analysis.vocabulary_level
          : 'average',
        tone: analysis.tone || 'neutral',
        quirks: Array.isArray(analysis.quirks) ? analysis.quirks : [],
        example_phrases: Array.isArray(analysis.example_phrases)
          ? analysis.example_phrases
          : dialogue.slice(0, 3),
        consistency_score:
          typeof analysis.consistency_score === 'number'
            ? Math.max(0, Math.min(1, analysis.consistency_score))
            : 0.0,
      };

      logger.info('🎭 Voice analysis completed:', voiceProfile);
      return voiceProfile;
    } catch (error) {
      logger.error('Error analyzing dialogue:', error);

      // Return a default profile on error
      return {
        voice_style: 'neutral',
        speech_patterns: ['conversational'],
        vocabulary_level: 'average',
        tone: 'neutral',
        quirks: [],
        example_phrases: dialogue.slice(0, 3),
        consistency_score: 0.5,
      };
    }
  }
}

// Singleton instance
export const voiceProfileService = new VoiceProfileService();
