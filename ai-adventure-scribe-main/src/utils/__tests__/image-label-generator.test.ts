import { describe, it, expect } from 'vitest';
import { generateImageLabel, formatLabelForDisplay } from '../image-label-generator';

describe('image-label-generator', () => {
  describe('generateImageLabel', () => {
    describe('UUID and hex string filtering', () => {
      it('should filter out UUID segments (4-8 hex chars)', () => {
        const label = generateImageLabel(
          null,
          'scene a66f6d92 4a01 4b0f in the ancient temple',
        );
        expect(label).not.toContain('a66f6d92');
        expect(label).not.toContain('4a01');
        expect(label).not.toContain('4b0f');
        expect(label).toContain('ancient');
        expect(label).toContain('temple');
      });

      it('should filter out long hex strings', () => {
        const label = generateImageLabel(
          null,
          'combat 58c4258ae55a ccfa1848 in the dark forest',
        );
        expect(label).not.toContain('58c4258ae55a');
        expect(label).not.toContain('ccfa1848');
        expect(label).toContain('dark');
        expect(label).toContain('forest');
      });

      it('should filter out full UUIDs', () => {
        const label = generateImageLabel(
          'Campaign',
          'scene a66f6d92-4a01-4b0f-85fd-58c4258ae55a in the dragon lair',
        );
        expect(label).not.toContain('a66f6d92');
        expect(label).not.toContain('4a01');
        expect(label).not.toContain('4b0f');
        expect(label).not.toContain('85fd');
        expect(label).toContain('campaign');
        expect(label).toContain('dragon');
        expect(label).toContain('lair');
      });

      it('should filter out technical prefixes', () => {
        const label = generateImageLabel(null, 'id_test msg_data ref_value in the ancient tavern');
        expect(label).not.toContain('id_test');
        expect(label).not.toContain('msg_data');
        expect(label).not.toContain('ref_value');
        expect(label).toContain('ancient');
        expect(label).toContain('tavern');
      });

      it('should filter out high-digit-ratio words', () => {
        const label = generateImageLabel(null, 'a1b2c3 test123data in the ancient ruins');
        expect(label).not.toContain('a1b2c3');
        expect(label).not.toContain('test123data');
        expect(label).toContain('ancient');
        expect(label).toContain('ruins');
      });
    });

    describe('keyword scoring and prioritization', () => {
      it('should prioritize fantasy terms (dragon, wizard, etc.)', () => {
        const label = generateImageLabel(
          null,
          'you walk down the road and see a massive dragon guarding treasure',
          { maxKeywords: 3 },
        );
        // Should prioritize "dragon" and "treasure" over generic words
        expect(label).toContain('dragon');
        expect(label).toContain('treasure');
      });

      it('should prioritize location terms (tavern, forest, etc.)', () => {
        const label = generateImageLabel(
          null,
          'you enter the small building which is a tavern near the forest',
          { maxKeywords: 3 },
        );
        // Should prioritize "tavern" and "forest" over "building"
        expect(label).toContain('tavern');
        expect(label).toContain('forest');
      });

      it('should prioritize longer words (more specific)', () => {
        const label = generateImageLabel(
          null,
          'the mysterious innkeeper nervously watches the entrance',
          { maxKeywords: 3 },
        );
        // Should prefer longer words like "mysterious" and "innkeeper"
        expect(label).toContain('mysterious');
        expect(label).toContain('innkeeper');
      });

      it('should deprioritize generic verbs', () => {
        const label = generateImageLabel(
          null,
          'you make your way to the ancient castle and take a look around',
          { maxKeywords: 3 },
        );
        // Should prioritize "ancient" and "castle" over "make" and "take"
        expect(label).toContain('ancient');
        expect(label).toContain('castle');
        expect(label).not.toContain('make');
        expect(label).not.toContain('take');
      });
    });

    describe('stop words filtering', () => {
      it('should filter common stop words (a, an, the, etc.)', () => {
        const label = generateImageLabel(
          null,
          'a dragon in the forest near an ancient temple',
        );
        expect(label).not.toContain('the');
        expect(label).not.toContain('in');
        expect(label).not.toContain('near');
        expect(label).toContain('dragon');
        expect(label).toContain('forest');
      });

      it('should filter meta-narrative terms (scene, turn, roll, etc.)', () => {
        const label = generateImageLabel(
          null,
          'scene turn 5 roll for initiative in the goblin camp',
        );
        expect(label).not.toContain('scene');
        expect(label).not.toContain('turn');
        expect(label).not.toContain('roll');
        expect(label).toContain('goblin');
        expect(label).toContain('camp');
      });

      it('should filter generic verbs from stop words (walk, look, enter)', () => {
        const label = generateImageLabel(
          null,
          'you walk and look at the mysterious tower near the ancient gate',
          { maxKeywords: 4 },
        );
        expect(label).not.toContain('walk');
        expect(label).not.toContain('look');
        expect(label).toContain('tower');
        expect(label).toContain('mysterious');
        expect(label).toContain('ancient');
        expect(label).toContain('gate');
      });
    });

    describe('campaign context integration', () => {
      it('should include sanitized campaign name', () => {
        const label = generateImageLabel(
          "The Dragon's Lair",
          'ancient temple with treasure',
        );
        expect(label).toContain('dragons');
        expect(label).toContain('lair');
      });

      it('should pass genre context for scoring', () => {
        const label = generateImageLabel(null, 'the small village near the mountains', {
          genre: 'fantasy',
        });
        // Genre context doesn't change behavior currently, but ensures no errors
        expect(label).toContain('village');
        expect(label).toContain('mountains');
      });

      it('should use character name as fallback', () => {
        const label = generateImageLabel(null, '', {
          characterName: 'Elara Moonwhisper',
        });
        expect(label).toContain('elara');
        // Note: "moonwhisper" truncated to "moonwhisp" due to 20 char limit
        expect(label).toContain('moonwhisp');
      });

      it('should prioritize campaign + keywords over character fallback', () => {
        const label = generateImageLabel('My Campaign', 'dragon temple', {
          characterName: 'Test Character',
        });
        expect(label).toContain('campaign');
        expect(label).toContain('dragon');
        expect(label).toContain('temple');
        expect(label).not.toContain('character');
      });
    });

    describe('edge cases and error handling', () => {
      it('should handle empty input gracefully', () => {
        const label = generateImageLabel(null, null);
        expect(label).toBe('scene'); // fallback
      });

      it('should handle only UUIDs/hex strings', () => {
        const label = generateImageLabel(
          null,
          'a66f6d92 4a01 4b0f 85fd 58c4258ae55a ccfa1848',
        );
        expect(label).toBe('scene'); // fallback when no good keywords
      });

      it('should handle very long campaign names', () => {
        const label = generateImageLabel(
          'This Is A Very Long Campaign Name That Should Be Truncated Properly',
          'dragon',
        );
        // Campaign name should be truncated to maxCampaignLength (default 20)
        const parts = label.split('-');
        const campaignPart = parts.slice(0, parts.length - 1).join('-');
        expect(campaignPart.length).toBeLessThanOrEqual(20);
      });

      it('should handle very long scene text', () => {
        const longText =
          'dragon ' +
          'filler '.repeat(100) +
          'castle ' +
          'noise '.repeat(50) +
          'ancient temple';
        const label = generateImageLabel(null, longText, { maxKeywords: 4 });
        // Should extract meaningful keywords despite length
        // Scoring prioritizes: dragon (+3), ancient (+2), castle (+2), temple (+2)
        expect(label).toContain('dragon');
        expect(label).toContain('ancient');
        expect(label).toContain('castle');
        expect(label).toContain('temple');
      });

      it('should handle special characters in campaign name', () => {
        const label = generateImageLabel("The Dragon's Lair & Castle #1", 'treasure hunt');
        // Should sanitize special chars
        expect(label).not.toContain("'");
        expect(label).not.toContain('&');
        expect(label).not.toContain('#');
        expect(label).toContain('dragons');
        expect(label).toContain('lair');
      });

      it('should handle numbers in scene text', () => {
        const label = generateImageLabel(null, '5 dragons attack the 10 villagers in town', {
          maxKeywords: 4,
        });
        // Should filter pure numbers but keep meaningful words
        // Scoring: dragons (+3), villagers (+2 for length), attack (+2 for length), town (+2)
        expect(label).not.toContain('5');
        expect(label).not.toContain('10');
        expect(label).toContain('dragons');
        expect(label).toContain('villagers');
        expect(label).toContain('attack');
        expect(label).toContain('town');
      });

      it('should handle whitespace-only input', () => {
        const label = generateImageLabel('   ', '   ', { fallbackLabel: 'default' });
        expect(label).toBe('default');
      });

      it('should respect maxKeywords parameter', () => {
        const label = generateImageLabel(
          null,
          'ancient dragon temple fortress castle tower ruins',
          { maxKeywords: 2 },
        );
        const keywords = label.split('-');
        expect(keywords.length).toBe(2);
      });

      it('should respect custom fallback label', () => {
        const label = generateImageLabel(null, null, { fallbackLabel: 'custom-fallback' });
        expect(label).toBe('custom-fallback');
      });
    });

    describe('real-world examples', () => {
      it('should handle typical DM narrative', () => {
        const label = generateImageLabel(
          'Dragons of Autumn',
          'You enter the dimly lit tavern. The innkeeper looks up nervously as you approach.',
        );
        expect(label).toContain('dragons');
        expect(label).toContain('autumn');
        expect(label).toContain('tavern');
        expect(label).toContain('innkeeper');
      });

      it('should handle combat scenes', () => {
        const label = generateImageLabel(
          'Quest for the Crown',
          'The goblin horde surrounds you in the dark forest clearing. Roll initiative!',
        );
        expect(label).toContain('quest');
        expect(label).toContain('crown');
        expect(label).toContain('goblin');
        expect(label).toContain('forest');
        expect(label).not.toContain('roll');
      });

      it('should handle exploration scenes', () => {
        const label = generateImageLabel(
          'Ruins of Eternity',
          'The ancient temple stands before you, covered in mysterious runes and magical symbols.',
        );
        expect(label).toContain('ruins');
        expect(label).toContain('eternity');
        expect(label).toContain('ancient');
        expect(label).toContain('temple');
      });

      it('should handle the original problem case', () => {
        const label = generateImageLabel(
          'Campaign',
          'scene a66f6d92 4a01 4b0f 85fd 58c4258ae55a ccfa1848',
        );
        // Should NOT contain any UUID segments
        expect(label).not.toContain('a66f6d92');
        expect(label).not.toContain('4a01');
        expect(label).not.toContain('4b0f');
        expect(label).not.toContain('85fd');
        expect(label).not.toContain('58c4258ae55a');
        expect(label).not.toContain('ccfa1848');
        // Should fall back to campaign name only
        expect(label).toBe('campaign');
      });
    });
  });

  describe('formatLabelForDisplay', () => {
    it('should capitalize each word', () => {
      const formatted = formatLabelForDisplay('dragons-lair-tavern');
      expect(formatted).toBe('Dragons Lair Tavern');
    });

    it('should replace hyphens with spaces', () => {
      const formatted = formatLabelForDisplay('ancient-temple-ruins');
      expect(formatted).toBe('Ancient Temple Ruins');
    });

    it('should handle single word', () => {
      const formatted = formatLabelForDisplay('dragon');
      expect(formatted).toBe('Dragon');
    });

    it('should handle empty string', () => {
      const formatted = formatLabelForDisplay('');
      expect(formatted).toBe('');
    });

    it('should handle multiple hyphens', () => {
      const formatted = formatLabelForDisplay('the--ancient---temple');
      expect(formatted).toBe('The  Ancient   Temple');
    });

    it('should be inverse of filename sanitization', () => {
      const original = 'Dragons Lair Tavern Innkeeper';
      const label = generateImageLabel(null, original.toLowerCase());
      const formatted = formatLabelForDisplay(label);
      // Should produce title-case version
      expect(formatted.split(' ').every((word) => word[0] === word[0].toUpperCase())).toBe(
        true,
      );
    });
  });
});
