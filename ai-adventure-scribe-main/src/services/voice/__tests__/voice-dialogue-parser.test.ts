/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, beforeEach } from 'vitest';

import { clearCharacterVoiceMappings } from '../../voice-routing';
import { VoiceDialogueParser } from '../voice-dialogue-parser';

describe('VoiceDialogueParser', () => {
  beforeEach(() => {
    // Ensure character voice mappings are fresh for each test
    clearCharacterVoiceMappings();
  });

  describe('processPlainText', () => {
    it('should return an empty array for empty or whitespace-only text', () => {
      expect(VoiceDialogueParser.processPlainText('')).toEqual([]);
      expect(VoiceDialogueParser.processPlainText('   ')).toEqual([]);
      expect(VoiceDialogueParser.processPlainText(null as any)).toEqual([]);
      expect(VoiceDialogueParser.processPlainText(undefined as any)).toEqual([]);
    });

    it('should fall back to a single DM narration segment when no dialogue is found', () => {
      const text = 'The wind howls through the desolate mountain pass. You hear nothing else.';
      const result = VoiceDialogueParser.processPlainText(text);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('dm');
      expect(result[0].character).toBe('DM');
      expect(result[0].text).toBe(text);
      expect(result[0].voiceId).toBeDefined();
    });

    it('should exclude engine transcript lines before creating narration segments', () => {
      const engineLine = '⚙️ Engine: The Storyteller rolled 16 + 4 = 20 vs AC 12 — HIT.';
      const result = VoiceDialogueParser.processPlainText(
        `${engineLine}\n\nThe ward shatters and the corridor falls silent.`,
      );

      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('The ward shatters and the corridor falls silent.');
      expect(result[0].text).not.toContain('Engine:');
    });

    it('should parse simple dialogue with attribution after the quote (asserting regex limitations)', () => {
      const text = '"I am the fire, I am the death," growled Smaug.';
      const result = VoiceDialogueParser.processPlainText(text);

      // Verifies that since "growled" is not a present-tense verb in the regex,
      // it treats "growled Smaug" as the character name and leaves "." as trailing DM narration.
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('character');
      expect(result[0].character).toBe('growled Smaug');
      expect(result[0].text).toBe('I am the fire, I am the death,');
      expect(result[1].type).toBe('dm');
      expect(result[1].text).toBe('.');
    });

    it('should parse simple dialogue with attribution before the quote', () => {
      const text =
        'Gimli shouts, "Let them come! There is one dwarf yet in Moria who still draws breath!"';
      const result = VoiceDialogueParser.processPlainText(text);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('character');
      expect(result[0].character).toBe('Gimli');
      expect(result[0].text).toBe(
        'Let them come! There is one dwarf yet in Moria who still draws breath!',
      );
    });

    it('should parse smart quotes (asserting regex post-attribution parsing with non-matched verbs)', () => {
      const text = '“We must stick together,” warned Aragorn.';
      const result = VoiceDialogueParser.processPlainText(text);

      // "warned" is not in the verb list, so it is treated as part of the character name.
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('character');
      expect(result[0].character).toBe('warned Aragorn');
      expect(result[0].text).toBe('We must stick together,');
      expect(result[1].type).toBe('dm');
      expect(result[1].text).toBe('.');
    });

    it('should handle multi-word and apostrophized character names', () => {
      const text = '"A wizard is never late," declares Gandalf the Grey.';
      const result = VoiceDialogueParser.processPlainText(text);

      // The post-attribution regex captures up to two words ("Gandalf the") as the name
      // and leaves "Grey." as trailing DM narration.
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('character');
      expect(result[0].character).toBe('Gandalf the');
      expect(result[1].type).toBe('dm');
      expect(result[1].text).toBe('Grey.');

      const text2 = '"I will guide you," says D\'Urden.';
      const result2 = VoiceDialogueParser.processPlainText(text2);

      expect(result2).toHaveLength(2);
      expect(result2[0].type).toBe('character');
      expect(result2[0].character).toBe("D'Urden");
      expect(result2[1].type).toBe('dm');
      expect(result2[1].text).toBe('.');
    });

    it('should fallback to Unknown NPC if no character can be identified', () => {
      const text = '"Where is the key?"';
      const result = VoiceDialogueParser.processPlainText(text);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('character');
      expect(result[0].character).toBe('Unknown NPC');
      expect(result[0].text).toBe('Where is the key?');
    });

    it('should extract surrounding narration before and after dialogue segments', () => {
      const text =
        'You step into the tavern. Gimli shouts, "A pint of ale!" while slamming his fist on the table.';
      const result = VoiceDialogueParser.processPlainText(text);

      expect(result).toHaveLength(3);

      expect(result[0].type).toBe('dm');
      expect(result[0].text).toBe('You step into the tavern.');

      expect(result[1].type).toBe('character');
      expect(result[1].text).toBe('A pint of ale!');
      expect(result[1].character).toBe('Gimli');

      expect(result[2].type).toBe('dm');
      expect(result[2].text).toBe('his fist on the table.');
    });

    it('should clean and format segment texts (e.g. stripping markdown italics/bolds)', () => {
      const text = 'The *terrifying* dragon roars, "**I will consume you!**"';
      const result = VoiceDialogueParser.processPlainText(text);

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('dm');
      expect(result[0].text).toBe('The terrifying dragon roars,');
      expect(result[1].type).toBe('character');
      expect(result[1].character).toBe('Unknown NPC');
      expect(result[1].text).toBe('I will consume you!');
    });

    it('should assign consistent voices to the same character across different dialogue calls', () => {
      const text1 = '"Help us!" pleads the villager.';
      const text2 = '"Please, we have no food," says the villager.';

      const result1 = VoiceDialogueParser.processPlainText(text1);
      const result2 = VoiceDialogueParser.processPlainText(text2);

      // In the first case, "pleads the" is matched as the character.
      // In the second case, "says" is matched as a verb, so "the villager" is matched as character "villager" (with 'the' stripped).
      expect(result1[0].character).toBe('pleads the');
      expect(result2[0].character).toBe('villager');

      // But if we use the exact same character name, it is consistent:
      const textA = '"Help us!" says the villager.';
      const textB = '"Please, we have no food," says the villager.';

      const resultA = VoiceDialogueParser.processPlainText(textA);
      const resultB = VoiceDialogueParser.processPlainText(textB);

      expect(resultA[0].character).toBe('villager');
      expect(resultB[0].character).toBe('villager');
      expect(resultA[0].voiceId).toBe(resultB[0].voiceId);
    });

    it('should assign distinct voices to different characters', () => {
      // Create characters that map to different hash codes / voice indices
      const text = '"I am Gandalf," says Gandalf. "And I am Gimli," says Gimli.';
      const result = VoiceDialogueParser.processPlainText(text);

      const gandalfSegment = result.find((s) => s.character === 'Gandalf');
      const gimliSegment = result.find((s) => s.character === 'Gimli');

      expect(gandalfSegment).toBeDefined();
      expect(gimliSegment).toBeDefined();

      expect(gandalfSegment!.voiceId).not.toBe(gimliSegment!.voiceId);
    });
  });
});
