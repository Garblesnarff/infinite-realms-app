import { describe, expect, it } from 'vitest';

import { smartSplitParagraph } from '../smart-split-paragraph';

describe('smartSplitParagraph', () => {
  it("does not split the Professor's quoted line across paragraphs (message fd70b2db)", () => {
    const text =
      "The stone corridor stretches into the ancient darkness as the air grows freezing cold and thick with centuries of undisturbed dust while torchlight flickers wildly against damp walls. He turns to the party with his eyes wide, his voice cracking as he shouts, 'What are you doing? We are all that stands between this descent and total oblivion!' He grips his torch firmly and steps back toward the shadowy archway.";

    const paragraphs = smartSplitParagraph(text);

    // Should NOT break inside the quote `'What are you doing? We are all that stands between this descent and total oblivion!'`
    expect(
      paragraphs.some(
        (p) => p.includes("shouts, 'What are you doing?") && !p.includes("total oblivion!'"),
      ),
    ).toBe(false);
    expect(paragraphs.some((p) => p.startsWith('We are all that stands'))).toBe(false);

    paragraphs.forEach((p) => {
      if (p.includes("'What are you doing?")) {
        expect(p).toContain("total oblivion!'");
      }
    });
  });

  it('handles straight double quotes without splitting inside open quote', () => {
    const text =
      'The ancient stone walls echo with distant footsteps as the party moves forward carefully into the damp hall while torchlight flickers nervously against the wet masonry. The old wizard turns to everyone and speaks loudly, "What are you doing? We are all that stands between this descent and total oblivion!" He holds his staff high above his head.';

    const paragraphs = smartSplitParagraph(text);

    paragraphs.forEach((p) => {
      if (p.includes('"What are you doing?')) {
        expect(p).toContain('total oblivion!"');
      }
    });
  });

  it('handles curly double quotes without splitting inside open quote', () => {
    const text =
      'The ancient stone walls echo with distant footsteps as the party moves forward carefully into the damp hall while torchlight flickers nervously against the wet masonry. The old wizard turns to everyone and speaks loudly, “What are you doing? We are all that stands between this descent and total oblivion!” He holds his staff high above his head.';

    const paragraphs = smartSplitParagraph(text);

    paragraphs.forEach((p) => {
      if (p.includes('“What are you doing?')) {
        expect(p).toContain('total oblivion!”');
      }
    });
  });

  it('handles curly single quotes without splitting inside open quote', () => {
    const text =
      'The ancient stone walls echo with distant footsteps as the party moves forward carefully into the damp hall while torchlight flickers nervously against the wet masonry. The old wizard turns to everyone and speaks loudly, ‘What are you doing? We are all that stands between this descent and total oblivion!’ He holds his staff high above his head.';

    const paragraphs = smartSplitParagraph(text);

    paragraphs.forEach((p) => {
      if (p.includes('‘What are you doing?')) {
        expect(p).toContain('total oblivion!’');
      }
    });
  });

  it('correctly ignores contractions and possessives as opening quote marks', () => {
    const text =
      "The Professor's lantern doesn't flicker and you've seen this before in the lower chambers. The team couldn't find the missing key in the players' chest. \"The readings aren't right, but it's safe enough,\" he says reassuringly to the others.";

    const paragraphs = smartSplitParagraph(text);
    const joined = paragraphs.join('\n\n');

    expect(joined).toContain("Professor's");
    expect(joined).toContain("doesn't");
    expect(joined).toContain("you've");
    expect(joined).toContain("couldn't");
    expect(joined).toContain("players'");
    expect(joined).toContain("aren't");
    expect(joined).toContain("it's");
  });

  it('does not emit a paragraph break inside an unclosed quote', () => {
    const text =
      'The party enters the dark hall as the cold wind blows through the shattered window frame while torches flicker in the gloom. He turns to the group and yells frantically, "What are you doing? We are all that stands between this descent and total oblivion! We cannot stop now under any circumstances!';

    const paragraphs = smartSplitParagraph(text);

    expect(
      paragraphs.some(
        (p) => p.includes('"What are you doing?') && !p.includes('descent and total oblivion!'),
      ),
    ).toBe(false);
  });

  it('still splits long unquoted text into multiple paragraphs near the 320 character threshold', () => {
    const sentence1 =
      'The adventurer stepped into the dark cavern with caution and drew a broadsword.';
    const sentence2 =
      'A cold wind blew through the narrow opening, carrying the smell of damp earth and sulfur.';
    const sentence3 =
      'Shadows danced across the damp granite walls as the torch flame flickered nervously.';
    const sentence4 =
      'In the far corner of the subterranean chamber, a strange luminescence caught his eye.';
    const sentence5 =
      'He advanced slowly, keeping his shield raised against whatever dangers might lurk in the gloom.';

    const longUnquotedText = `${sentence1} ${sentence2} ${sentence3} ${sentence4} ${sentence5}`;
    expect(longUnquotedText.length).toBeGreaterThan(400);

    const paragraphs = smartSplitParagraph(longUnquotedText);

    expect(paragraphs.length).toBeGreaterThan(1);
    paragraphs.forEach((p) => {
      expect(p.length).toBeLessThanOrEqual(400);
    });
  });
});
