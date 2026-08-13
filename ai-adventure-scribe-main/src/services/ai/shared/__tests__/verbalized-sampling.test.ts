import { describe, it, expect, vi, beforeEach } from 'vitest';

import { parseVerbalizedResponse, sampleFromVerbalizedResponse } from '../verbalized-sampling';

import logger from '@/lib/logger';

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

/* eslint-disable max-lines */
describe('Verbalized Sampling Parser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  describe('Strategy 1: Section delimiter format', () => {
    it('should parse ---SCENE (prob: 0.5)--- headers', () => {
      const raw = `
Preamble text
---SCENE (prob: 0.3)---
Content for scene 1. This needs to be long enough to be considered valid by the parser.
---SCENE (prob: 0.7)---
Content for scene 2. This also needs to be long enough to be considered valid by the parser.
`;
      const result = parseVerbalizedResponse(raw);
      expect(result.parseMethod).toBe('section');
      expect(result.text).toBe(
        'Content for scene 2. This also needs to be long enough to be considered valid by the parser.',
      );
      expect(result.probability).toBe(0.7);
    });

    it('should ignore short content in section format', () => {
      const raw = `
---SCENE (prob: 0.5)---
Too short
---SCENE (prob: 0.5)---
Valid content that is long enough to meet the 50 character requirement of the parser.
`;
      const result = parseVerbalizedResponse(raw);
      expect(result.parseMethod).toBe('section');
      expect(result.text).toContain('Valid content');
      expect(result.probability).toBe(1);
    });
  });

  describe('Strategy 2: XML format', () => {
    it('should parse strict XML format', () => {
      const raw = `
<response>
  <probability>0.4</probability>
  <text>Content for XML scene 1. This needs to be long enough to be considered valid by the parser.</text>
</response>
<response>
  <probability>0.6</probability>
  <text>Content for XML scene 2. This needs to be long enough to be considered valid by the parser.</text>
</response>
`;
      const result = parseVerbalizedResponse(raw);
      expect(result.parseMethod).toBe('xml');
      expect(result.text).toBe(
        'Content for XML scene 2. This needs to be long enough to be considered valid by the parser.',
      );
    });
  });

  describe('Strategy 3: Markdown numbered list', () => {
    it('should parse "1. (0.5) Content" format', () => {
      const raw = `
1. (0.5) First markdown option. This needs to be long enough to be considered valid by the parser.
2. (0.5) Second markdown option. This needs to be long enough to be considered valid by the parser.
`;
      const result = parseVerbalizedResponse(raw);
      expect(result.parseMethod).toBe('markdown');
      expect(result.text).toBe(
        'First markdown option. This needs to be long enough to be considered valid by the parser.',
      );
    });

    it('should parse "1. **Title** (prob: 0.5): Content" format', () => {
      const raw = `
1. **Option A** (prob: 0.3): Content for option A. This needs to be long enough to be considered valid by the parser.
2. **Option B** (prob: 0.7): Content for option B. This needs to be long enough to be considered valid by the parser.
`;
      const result = parseVerbalizedResponse(raw);
      expect(result.parseMethod).toBe('markdown');
      expect(result.text).toBe(
        'Content for option B. This needs to be long enough to be considered valid by the parser.',
      );
    });
  });

  describe('Strategy 4: Loose format', () => {
    it('should parse probability markers anywhere', () => {
      const raw = `
Probability: 0.2
This is the first loose section. This needs to be long enough to be considered valid by the parser.
Prob: 0.8
This is the second loose section. This needs to be long enough to be considered valid by the parser.
`;
      const result = parseVerbalizedResponse(raw);
      expect(result.parseMethod).toBe('loose');
      expect(result.text).toBe(
        'This is the second loose section. This needs to be long enough to be considered valid by the parser.',
      );
    });
  });

  describe('Fallback Mechanism: extractFirstSection', () => {
    it('should fallback to first section and append options if separate', () => {
      const raw = `
You are in a dark forest. The trees loom over you like ancient giants, and the wind whispers through the leaves. You feel a sense of unease as you press forward, your hand resting on the hilt of your sword.

A. **Attack the shadows**
B. **Search for tracks**
C. **Listen intently**
`;
      const result = parseVerbalizedResponse(raw);
      expect(result.parseMethod).toBe('fallback-first-section');
      expect(result.text).toContain('dark forest');
      expect(result.text).toContain('A. **Attack the shadows**');
    });

    it('should detect and extract first scene from multi-scene duplication', () => {
      const scene = `The dragon roars at you! It is massive and terrifying. Its scales glint like obsidian in the dim light of the cavern.
A. **Fight**
B. **Flee**
C. **Negotiate**`;

      const duplicated = `${scene}\n\n${scene}\n\n${scene}`;

      const result = parseVerbalizedResponse(duplicated);
      expect(result.parseMethod).toBe('fallback-first-section');
      expect(result.text.match(/dragon roars/g)?.length).toBe(1);
    });

    it('should split by double newlines and find section with options', () => {
      const raw = `Preamble.

You see a tavern. It is very cozy.
A. **Enter**
B. **Pass by**

The sky is dark. It looks like rain.`;

      const result = parseVerbalizedResponse(raw);
      // Sections: ["Preamble.", "You see a tavern...\nA. **Enter**\nB. **Pass by**", "The sky is dark..."]
      expect(result.text).toContain('You see a tavern');
      expect(result.text).toContain('A. **Enter**');
      expect(result.text).not.toContain('Preamble');
      expect(result.text).not.toContain('The sky is dark');
    });

    it('should handle section without options but > 200 chars', () => {
      const longNarrative =
        'As you step into the room, you are struck by the sheer scale of the architecture. The vaulted ceilings reach high into the darkness, supported by massive pillars of white marble that seem to glow with a faint, inner light. The air is cool and still, carrying the scent of ancient dust and stale incense. It has been many centuries since anyone last walked these halls, yet the grandeur of the place remains undiminished by the passage of time.';
      const raw = `Preamble.\n\n${longNarrative}`;
      const result = parseVerbalizedResponse(raw);
      expect(result.text).toBe(longNarrative);
    });

    it('should truncate extremely long responses at paragraph boundary', () => {
      const longText = 'A'.repeat(2000) + '\n\n' + 'B'.repeat(1000);
      const result = parseVerbalizedResponse(longText);
      expect(result.text.length).toBe(2000);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Truncated at paragraph boundary'),
      );
    });

    it('should truncate at max length if no paragraph boundary found', () => {
      const longText = 'A'.repeat(3000);
      const result = parseVerbalizedResponse(longText);
      expect(result.text.length).toBe(2500);
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Truncated at max length'));
    });

    it('should return entire cleaned text if less than max length and no other rules match', () => {
      const shortText =
        'Short text that is long enough to be kept but doesnt match any fancy rules.';
      const result = parseVerbalizedResponse(shortText);
      expect(result.text).toBe(shortText);
    });
  });

  describe('Deduplication: validateAndCleanResponse', () => {
    it('should remove exact duplicate paragraphs', () => {
      const raw = `
---SCENE (prob: 1.0)---
Paragraph one. This is a unique paragraph and it is long.

Paragraph two. This is another unique paragraph and it is also long.

Paragraph one. This is a unique paragraph and it is long.
`;
      const result = parseVerbalizedResponse(raw);
      // validateAndCleanResponse joins with \n\n
      const paragraphs = result.text.split('\n\n');
      // Actually, my test setup was failing because Paragraph one was too short for includes check?
      // No, check 1 is exact signature match.
      expect(paragraphs.length).toBe(2);
    });

    it('should remove paragraphs that are supersets of previous ones', () => {
      const raw = `
---SCENE (prob: 1.0)---
The knight draws his sword and prepares for battle. This is a fairly long paragraph to pass the length check.

The knight draws his sword and prepares for battle. This is a fairly long paragraph to pass the length check. "Have at thee!" he cries.
`;
      const result = parseVerbalizedResponse(raw);
      // If the second paragraph includes the first, it is removed.
      expect(result.text).toBe(
        'The knight draws his sword and prepares for battle. This is a fairly long paragraph to pass the length check.',
      );
    });

    it('should remove paragraphs with overlapping middle content', () => {
      const raw = `
---SCENE (prob: 1.0)---
This is a very long paragraph that will have its middle portion checked for duplicates in subsequent paragraphs of the response.

Some prefix. This is a very long paragraph that will have its middle portion checked for duplicates in subsequent paragraphs of the response. Some suffix.
`;
      const result = parseVerbalizedResponse(raw);
      expect(result.text.split('\n\n').length).toBe(1);
    });

    it('should remove paragraphs containing multiple previous starts (accumulation)', () => {
      const raw = `
---SCENE (prob: 1.0)---
The first paragraph starts with this unique sentence. It is long enough.

The second paragraph starts with another unique sentence. It is long enough.

The third paragraph starts with yet another unique sentence. It is long enough.

the first paragraph starts with this unique sentence. the second paragraph starts with another unique sentence. And more content.
`;
      const result = parseVerbalizedResponse(raw);
      expect(result.text).not.toContain('And more content');
    });
  });

  describe('sampleFromVerbalizedResponse', () => {
    it('should return just the text string', () => {
      const raw = `---SCENE (prob: 1.0)---\nNarrative content that is definitely more than fifty characters long.`;
      const result = sampleFromVerbalizedResponse(raw);
      expect(typeof result).toBe('string');
      expect(result).toContain('Narrative content');
    });

    it('should log warning on fallback-first-section', () => {
      const raw =
        'Simple text that is long enough to be a section but matches no patterns. This needs to be long enough.';
      sampleFromVerbalizedResponse(raw);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('parsing failed'),
        expect.any(Object),
      );
    });
  });
});
