/**
 * Voice Dialogue Parser Service
 *
 * Extracted from VoiceDirector to separate plain text dialogue detection
 * and parsing from core orchestration logic.
 *
 * Key responsibilities:
 * - Detecting dialogue and narration parts in plain text
 * - Attributing voices to detected character names
 */

import { detectVoiceCategoryFromNPCType } from './voice-classification';
import { VOICE_POOLS } from './voice-pools';
import { cleanSegmentText } from './voice-utils';
import { type AISegment, type VoiceSegment, assignVoice } from '../voice-routing';

import logger from '@/lib/logger';
import { stripAssetTags } from '@/lib/utils';
import { stripEngineGeneratedLines } from '@/utils/engine-lines';

export class VoiceDialogueParser {
  /**
   * Process plain text by detecting dialogue and attributing voices
   * Parses quoted speech with attribution to assign character voices
   */
  static processPlainText(text: string): VoiceSegment[] {
    logger.info('📝 VoiceDialogueParser: Processing plain text with dialogue detection');

    // Strip engine transcript lines before normalizing whitespace. The
    // normalizer collapses line boundaries, which would otherwise make the
    // engine line indistinguishable from the narration that follows it.
    const textWithoutEngineLines = typeof text === 'string' ? stripEngineGeneratedLines(text) : '';
    const textWithoutAssetTags = stripAssetTags(textWithoutEngineLines);
    const cleanText = cleanSegmentText(textWithoutAssetTags);
    if (!cleanText) {
      return [];
    }

    // Parse text into dialogue and narration segments
    const parsedSegments = VoiceDialogueParser.parseDialogueFromText(cleanText);

    if (parsedSegments.length === 0) {
      // No dialogue found, return as single DM segment
      const dmVoice = VOICE_POOLS.dm[0];
      return [
        {
          id: `fallback_${Date.now()}`,
          type: 'dm',
          text: cleanText,
          character: 'DM',
          voiceId: dmVoice.id,
          voiceName: dmVoice.name,
          voiceSettings: dmVoice.settings,
          isGenerating: false,
          isPlaying: false,
        },
      ];
    }

    // Convert parsed segments to voice segments
    return parsedSegments.map((segment, index) => {
      const voiceConfig = assignVoice(segment);
      return {
        id: `parsed_${Date.now()}_${index}`,
        type: segment.type,
        text: segment.text,
        character: segment.character || (segment.type === 'dm' ? 'DM' : 'Unknown'),
        voiceId: voiceConfig.id,
        voiceName: voiceConfig.name,
        voiceSettings: voiceConfig.settings,
        isGenerating: false,
        isPlaying: false,
      };
    });
  }

  /**
   * Parse dialogue from plain text
   * Returns an array of segments with type 'dm' (narration) or 'character' (dialogue)
   */
  private static parseDialogueFromText(text: string): AISegment[] {
    const segments: AISegment[] = [];

    // Regex to find quoted dialogue with optional attribution
    // Improved to handle smart quotes and apostrophes in character names
    const dialoguePattern =
      /(?:(?:(?:the\s+)?([\w']+(?:\s+[\w']+)?)\s+(?:says?|asks?|replies?|exclaims?|mutters?|whispers?|shouts?|growls?|warns?|declares?|announces?|speaks?|responds?),?\s*)?["“]([^"”]+)["”](?:\s*,?\s*(?:(?:says?|asks?|replies?|exclaims?|mutters?|whispers?|shouts?|growls?|warns?|declares?|announces?|speaks?|responds?)\s+)?(?:the\s+)?([\w']+(?:\s+[\w']+)?))?)/gi;

    let lastIndex = 0;
    let match;

    while ((match = dialoguePattern.exec(text)) !== null) {
      // Add narration before this dialogue (if any)
      const narrationBefore = text.slice(lastIndex, match.index).trim();
      if (narrationBefore) {
        segments.push({
          type: 'dm',
          text: narrationBefore,
        });
      }

      // Extract character name and dialogue
      const preCharacter = match[1]; // Character mentioned before quote
      const dialogue = match[2]; // The actual dialogue
      const postCharacter = match[3]; // Character mentioned after quote

      // Use whichever character name we found
      const characterName = (preCharacter || postCharacter || '').trim();
      const voiceCategory = detectVoiceCategoryFromNPCType(characterName);

      if (dialogue.trim()) {
        segments.push({
          type: 'character',
          text: dialogue.trim(),
          character: characterName || 'Unknown NPC',
          voice_category: voiceCategory,
        });
      }

      lastIndex = match.index + match[0].length;
    }

    // Add any remaining narration after the last dialogue
    const remainingText = text.slice(lastIndex).trim();
    if (remainingText) {
      segments.push({
        type: 'dm',
        text: remainingText,
      });
    }

    // If we found no dialogue, return empty to trigger fallback
    const hasDialogue = segments.some((s) => s.type === 'character');
    if (!hasDialogue) {
      return [];
    }

    logger.info(
      `🎭 Parsed ${segments.length} segments (${segments.filter((s) => s.type === 'character').length} dialogue)`,
    );
    return segments;
  }
}
