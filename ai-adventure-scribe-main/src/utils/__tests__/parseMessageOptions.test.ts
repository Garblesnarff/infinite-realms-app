/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  parseMessageOptions,
  extractNarrativeContent,
  createPlayerMessageFromOption,
} from '../parseMessageOptions';

// Mock logger
vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('parseMessageOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parseMessageOptions', () => {
    it('should parse numbered bold options correctly', () => {
      const content =
        "The door is locked. What do you do?\n\n1. **Try to pick the lock**, using your thieves' tools.\n2. **Kick the door down**, using your strength.";
      const result = parseMessageOptions(content);

      expect(result.hasOptions).toBe(true);
      expect(result.content).toBe('The door is locked. What do you do?');
      expect(result.options).toHaveLength(2);

      expect(result.options[0]).toEqual({
        id: 'option-1',
        number: 1,
        text: "Try to pick the lock, using your thieves' tools.",
        fullText: "**Try to pick the lock**, using your thieves' tools.",
        title: 'Try to pick the lock',
        description: "using your thieves' tools.",
      });

      expect(result.options[1]).toEqual({
        id: 'option-2',
        number: 2,
        text: 'Kick the door down, using your strength.',
        fullText: '**Kick the door down**, using your strength.',
        title: 'Kick the door down',
        description: 'using your strength.',
      });
    });

    it('splits the bold action name from its description (#2281)', () => {
      const result = parseMessageOptions(
        [
          'The hall is quiet.',
          '',
          '1. **Follow the scorched-sugar smell**, down the corridor toward the kitchens.',
          '2. **Question the Manager** — he is wringing his hands by the doors.',
          '3. **Wait**',
        ].join('\n'),
      );

      expect(result.options.map(({ title, description }) => ({ title, description }))).toEqual([
        {
          title: 'Follow the scorched-sugar smell',
          description: 'down the corridor toward the kitchens.',
        },
        { title: 'Question the Manager', description: 'he is wringing his hands by the doors.' },
        { title: 'Wait', description: undefined },
      ]);
    });

    it('should parse lettered bold options correctly', () => {
      const content =
        'A mysterious stranger approaches.\n\nA. **Greet them friendly**, with a smile.\nB. **Draw your sword**, ready for a fight.';
      const result = parseMessageOptions(content);

      expect(result.hasOptions).toBe(true);
      expect(result.options).toHaveLength(2);

      expect(result.options[0].letter).toBe('A');
      expect(result.options[0].number).toBe(1);
      expect(result.options[1].letter).toBe('B');
      expect(result.options[1].number).toBe(2);
    });

    it('should fallback to numbered options without bolding', () => {
      const content =
        'Choose your path:\n1. Go left into the forest\n2. Go right towards the mountains';
      const result = parseMessageOptions(content);

      expect(result.hasOptions).toBe(true);
      expect(result.options).toHaveLength(2);
      expect(result.options[0].text).toBe('Go left into the forest');
    });

    it('accepts bounded option numbers in bold and fallback formats', () => {
      const bold = parseMessageOptions('Choose:\n100. **Take the final path**');
      const fallback = parseMessageOptions('Choose:\n100. Take the final path');

      expect(bold.options[0]).toMatchObject({ id: 'option-100', number: 100 });
      expect(fallback.options[0]).toMatchObject({ id: 'option-100', number: 100 });
    });

    it.each([
      '0. **Zero is not an option**',
      '101. **Too many options**',
      '9007199254740992. **Unsafe integer**',
      '0. Zero is not an option',
      '101. Too many options',
      '9007199254740992. Unsafe integer',
    ])('rejects an out-of-range numbered option: %s', (option) => {
      const result = parseMessageOptions(`Choose:\n${option}`);

      expect(result.hasOptions).toBe(false);
      expect(result.options).toEqual([]);
    });

    it('should fallback to lettered options without bolding', () => {
      const content = 'Choose your path:\nA. Go left\nB. Go right';
      const result = parseMessageOptions(content);

      expect(result.hasOptions).toBe(true);
      expect(result.options).toHaveLength(2);
      expect(result.options[0].letter).toBe('A');
    });

    it('should handle empty or null content', () => {
      expect(parseMessageOptions('').hasOptions).toBe(false);
      expect(parseMessageOptions(null as any).hasOptions).toBe(false);
    });

    it('should handle content with no options', () => {
      const content = 'Just some narrative text with no numbered choices.';
      const result = parseMessageOptions(content);
      expect(result.hasOptions).toBe(false);
      expect(result.content).toBe(content);
    });

    it('should clean up narrative content by removing incomplete sentences', () => {
      const content = 'This is a complete sentence. This is an incomplete\n\n1. **Option 1**';
      const result = parseMessageOptions(content);
      expect(result.content).toBe('This is a complete sentence.');
    });

    it('should clean asset-tagged item options with malformed nested bolding', () => {
      const content = [
        'Narrative here.',
        '',
        'E. **Steal a **Knife Of Toasting [ASSET:item:knife-of-toasting]** from the utensil rack**, because if you’re going to survive this shift, you’ll need a weapon.',
      ].join('\n');
      const result = parseMessageOptions(content);

      expect(result.hasOptions).toBe(true);
      expect(result.options).toHaveLength(1);
      expect(result.options[0].text).toBe(
        'Steal a Knife Of Toasting from the utensil rack, because if you’re going to survive this shift, you’ll need a weapon.',
      );
    });
  });

  describe('extractNarrativeContent', () => {
    it('should return only narrative and strip options', () => {
      const content = 'Narrative here.\n\n1. **Option 1**';
      expect(extractNarrativeContent(content)).toBe('Narrative here.');
    });
  });

  describe('createPlayerMessageFromOption', () => {
    it('should convert second person to first person', () => {
      const option = {
        id: 'opt1',
        number: 1,
        text: 'You draw your sword and attack yourself.',
        fullText: '**You draw your sword** and attack yourself.',
      };

      const result = createPlayerMessageFromOption(option);
      expect(result).toBe('I draw my sword and attack myself.');
    });

    it('should handle "you are" and "you\'re"', () => {
      const option = {
        id: 'opt1',
        number: 1,
        text: "You are ready and you're fast.",
        fullText: '...',
      };
      expect(createPlayerMessageFromOption(option)).toBe("I am ready and I'm fast.");
    });

    it('should handle "you have" and "you\'ve"', () => {
      const option = {
        id: 'opt1',
        number: 1,
        text: "You have your gear and you've prepared.",
        fullText: '...',
      };
      expect(createPlayerMessageFromOption(option)).toBe("I have my gear and I've prepared.");
    });

    it('should keep "you have" as "I have" after "something" (#1132)', () => {
      const option = {
        id: 'opt1',
        number: 1,
        text: 'Tell Jubal and Osric about something you have truly lost.',
        fullText: '...',
      };
      expect(createPlayerMessageFromOption(option)).toBe(
        'Tell Jubal and Osric about something I have truly lost.',
      );
    });

    it('should keep "you have" as "I have" after "nothing" and "anything" (#1132)', () => {
      const nothingOption = {
        id: 'opt1',
        number: 1,
        text: 'Tell them about nothing you have truly lost.',
        fullText: '...',
      };
      const anythingOption = {
        id: 'opt2',
        number: 2,
        text: 'Tell them about anything you have truly lost.',
        fullText: '...',
      };
      expect(createPlayerMessageFromOption(nothingOption)).toBe(
        'Tell them about nothing I have truly lost.',
      );
      expect(createPlayerMessageFromOption(anythingOption)).toBe(
        'Tell them about anything I have truly lost.',
      );
    });

    it('should handle "you will" and "you\'ll" in both cases', () => {
      const option = {
        id: 'opt1',
        number: 1,
        text: "You will survive and you'll win. If you will fight, you will succeed.",
        fullText: '...',
      };
      expect(createPlayerMessageFromOption(option)).toBe(
        "I will survive and I'll win. If I will fight, I will succeed.",
      );
    });

    it('should preserve case for "Your" at start of sentence', () => {
      const option = {
        id: 'opt1',
        number: 1,
        text: 'Your skill is great.',
        fullText: '...',
      };
      expect(createPlayerMessageFromOption(option)).toBe('My skill is great.');
    });

    it('should handle "yourself" conversion', () => {
      const option = {
        id: 'opt1',
        number: 1,
        text: 'Defend yourself!',
        fullText: '...',
      };
      expect(createPlayerMessageFromOption(option)).toBe('Defend myself!');
    });

    it('should handle "you" in both cases', () => {
      const option = {
        id: 'opt1',
        number: 1,
        text: 'You know that if you try, you can.',
        fullText: '...',
      };
      expect(createPlayerMessageFromOption(option)).toBe('I know that if I try, I can.');
    });

    it('should handle various "you" patterns combined', () => {
      const option = {
        id: 'opt1',
        number: 1,
        text: "You have your gear. You'll need it. You've prepared yourself.",
        fullText: '...',
      };
      expect(createPlayerMessageFromOption(option)).toBe(
        "I have my gear. I'll need it. I've prepared myself.",
      );
    });

    it('should use objective case for object-position "you"', () => {
      const option = {
        id: 'opt-objective-case',
        number: 5,
        text: 'You raise your shield to prevent him from knocking you off the pedestal; the victory is yours.',
        fullText:
          '**Raise your shield** to prevent him from knocking you off the pedestal; the victory is yours.',
      };

      expect(createPlayerMessageFromOption(option)).toBe(
        'I raise my shield to prevent him from knocking me off the pedestal; the victory is mine.',
      );
    });

    // Regression: the generic "you" -> "I" rule used to fire on "you were",
    // producing "I were". Caught in a live playtest of The Eternal Feast, where
    // an option read "demand to know why you were chosen".
    it('should conjugate "you were" as "I was"', () => {
      const option = {
        id: 'opt-were',
        number: 2,
        text: 'Interrogate the Manager, demand to know why you were chosen for this duty.',
        fullText: '**Interrogate the Manager**, demand to know why you were chosen for this duty.',
      };

      expect(createPlayerMessageFromOption(option)).toBe(
        'Interrogate the Manager, demand to know why I was chosen for this duty.',
      );
    });

    it('should conjugate negated contractions of "to be"', () => {
      const option = {
        id: 'opt-negated',
        number: 3,
        text: "You weren't invited, and you aren't welcome.",
        fullText: "**You weren't invited**, and you aren't welcome.",
      };

      expect(createPlayerMessageFromOption(option)).toBe("I wasn't invited, and I'm not welcome.");
    });

    it('should convert the possessive pronoun "yours" to "mine"', () => {
      const option = {
        id: 'opt-yours',
        number: 4,
        text: 'Claim the blade, insisting it is yours.',
        fullText: '**Claim the blade**, insisting it is yours.',
      };

      expect(createPlayerMessageFromOption(option)).toBe('Claim the blade, insisting it is mine.');
    });
  });
});

describe('parseMessageOptions duplicate options (#864)', () => {
  // Fixture follows the real producer: use-ai-response.ts appends the reply's
  // options field to the narration text, so when the model also wrote the
  // lettered list into the narration, the rendered text carries both copies
  // (Hark S-006: 1-3 shown again as 4-6).
  const OPT_A = 'A. **Take the map**, and read it by the fire.';
  const OPT_B = 'B. **Ask about the heir**, pressing gently.';
  const OPT_C = 'C. **Leave quietly**, into the garden.';
  const NARRATION = 'The gardener watches you, saying nothing.';

  it('renders each offered choice once when the list appears twice (S-006)', () => {
    const result = parseMessageOptions(
      [NARRATION, '', OPT_A, OPT_B, OPT_C, '', OPT_A, OPT_B, OPT_C].join('\n'),
    );
    expect(result.hasOptions).toBe(true);
    expect(result.options).toHaveLength(3);
    expect(result.options.map((o) => o.text)).toEqual([
      'Take the map, and read it by the fire.',
      'Ask about the heir, pressing gently.',
      'Leave quietly, into the garden.',
    ]);
    // Dedupe removes the second copy, not the narration before the first.
    expect(result.content).toBe(NARRATION);
  });

  it('drops a duplicated field list even with clean narration', () => {
    const result = parseMessageOptions(
      [NARRATION, '', OPT_A, OPT_B, OPT_C, OPT_A, OPT_B, OPT_C].join('\n'),
    );
    expect(result.options).toHaveLength(3);
  });

  it('keeps genuinely distinct options, including near-identical wording', () => {
    const result = parseMessageOptions(
      [
        NARRATION,
        '',
        'A. **Attack the goblin**, with your sword.',
        'B. **Attack the goblin chief**, with your sword.',
        'C. **Leave quietly**, into the garden.',
      ].join('\n'),
    );
    expect(result.options).toHaveLength(3);
  });

  it('treats case, markdown and punctuation variants of one choice as the same', () => {
    const result = parseMessageOptions(
      [
        NARRATION,
        '',
        'A. **Take the map**, and read it by the fire.',
        'B. **take the map**, and read it by the fire.',
      ].join('\n'),
    );
    expect(result.options).toHaveLength(1);
    // First occurrence is kept: the A option, not the B variant.
    expect(result.options[0].id).toBe('option-A');
  });

  it('keeps options that differ only in a non-ASCII letter', () => {
    const result = parseMessageOptions(
      [
        NARRATION,
        '',
        'A. **Speak to Zoë**, by the fire.',
        'B. **Speak to Zo**, by the fire.',
      ].join('\n'),
    );
    expect(result.options).toHaveLength(2);
    expect(result.options.map((o) => o.text)).toEqual([
      'Speak to Zoë, by the fire.',
      'Speak to Zo, by the fire.',
    ]);
  });

  it('still dedupes a non-ASCII choice against its own case variant', () => {
    const result = parseMessageOptions(
      [
        NARRATION,
        '',
        'A. **Speak to Zoë**, by the fire.',
        'B. **speak to zoë**, by the fire!',
      ].join('\n'),
    );
    expect(result.options).toHaveLength(1);
    expect(result.options[0].id).toBe('option-A');
  });

  it('drops duplicated numbered options too', () => {
    const result = parseMessageOptions(
      [
        NARRATION,
        '',
        '1. **Take the map**, and read it by the fire.',
        '2. **Leave quietly**, into the garden.',
        '1. **Take the map**, and read it by the fire.',
      ].join('\n'),
    );
    expect(result.options).toHaveLength(2);
  });
});
