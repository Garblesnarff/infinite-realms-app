/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  parseMessageOptions,
  extractNarrativeContent,
  createPlayerMessageFromOption
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
      const content = "The door is locked. What do you do?\n\n1. **Try to pick the lock**, using your thieves' tools.\n2. **Kick the door down**, using your strength.";
      const result = parseMessageOptions(content);

      expect(result.hasOptions).toBe(true);
      expect(result.content).toBe("The door is locked. What do you do?");
      expect(result.options).toHaveLength(2);

      expect(result.options[0]).toEqual({
        id: 'option-1',
        number: 1,
        text: "Try to pick the lock, using your thieves' tools.",
        fullText: "**Try to pick the lock**, using your thieves' tools.",
      });

      expect(result.options[1]).toEqual({
        id: 'option-2',
        number: 2,
        text: "Kick the door down, using your strength.",
        fullText: "**Kick the door down**, using your strength.",
      });
    });

    it('should parse lettered bold options correctly', () => {
      const content = "A mysterious stranger approaches.\n\nA. **Greet them friendly**, with a smile.\nB. **Draw your sword**, ready for a fight.";
      const result = parseMessageOptions(content);

      expect(result.hasOptions).toBe(true);
      expect(result.options).toHaveLength(2);

      expect(result.options[0].letter).toBe('A');
      expect(result.options[0].number).toBe(1);
      expect(result.options[1].letter).toBe('B');
      expect(result.options[1].number).toBe(2);
    });

    it('should fallback to numbered options without bolding', () => {
      const content = "Choose your path:\n1. Go left into the forest\n2. Go right towards the mountains";
      const result = parseMessageOptions(content);

      expect(result.hasOptions).toBe(true);
      expect(result.options).toHaveLength(2);
      expect(result.options[0].text).toBe("Go left into the forest");
    });

    it('should fallback to lettered options without bolding', () => {
      const content = "Choose your path:\nA. Go left\nB. Go right";
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
      const content = "Just some narrative text with no numbered choices.";
      const result = parseMessageOptions(content);
      expect(result.hasOptions).toBe(false);
      expect(result.content).toBe(content);
    });

    it('should clean up narrative content by removing incomplete sentences', () => {
      const content = "This is a complete sentence. This is an incomplete\n\n1. **Option 1**";
      const result = parseMessageOptions(content);
      expect(result.content).toBe("This is a complete sentence.");
    });
  });

  describe('extractNarrativeContent', () => {
    it('should return only narrative and strip options', () => {
      const content = "Narrative here.\n\n1. **Option 1**";
      expect(extractNarrativeContent(content)).toBe("Narrative here.");
    });
  });

  describe('createPlayerMessageFromOption', () => {
    it('should convert second person to first person', () => {
      const option = {
        id: 'opt1',
        number: 1,
        text: "You draw your sword and attack yourself.",
        fullText: "**You draw your sword** and attack yourself.",
      };

      const result = createPlayerMessageFromOption(option);
      expect(result).toBe("I draw my sword and attack myself.");
    });

    it('should handle "you are" and "you\'re"', () => {
      const option = {
        id: 'opt1',
        number: 1,
        text: "You are ready and you're fast.",
        fullText: "...",
      };
      expect(createPlayerMessageFromOption(option)).toBe("I am ready and I'm fast.");
    });

    it('should handle "you have" and "you\'ve"', () => {
      const option = {
        id: 'opt1',
        number: 1,
        text: "You have your gear and you've prepared.",
        fullText: "...",
      };
      expect(createPlayerMessageFromOption(option)).toBe("I have my gear and I've prepared.");
    });

    it('should handle "you will" and "you\'ll" in both cases', () => {
      const option = {
        id: 'opt1',
        number: 1,
        text: "You will survive and you'll win. If you will fight, you will succeed.",
        fullText: "...",
      };
      expect(createPlayerMessageFromOption(option)).toBe("I will survive and I'll win. If I will fight, I will succeed.");
    });

    it('should preserve case for "Your" at start of sentence', () => {
       const option = {
        id: 'opt1',
        number: 1,
        text: "Your skill is great.",
        fullText: "...",
      };
      expect(createPlayerMessageFromOption(option)).toBe("My skill is great.");
    });

    it('should handle "yourself" conversion', () => {
       const option = {
        id: 'opt1',
        number: 1,
        text: "Defend yourself!",
        fullText: "...",
      };
      expect(createPlayerMessageFromOption(option)).toBe("Defend myself!");
    });

    it('should handle "you" in both cases', () => {
       const option = {
        id: 'opt1',
        number: 1,
        text: "You know that if you try, you can.",
        fullText: "...",
      };
      expect(createPlayerMessageFromOption(option)).toBe("I know that if I try, I can.");
    });

    it('should handle various "you" patterns combined', () => {
       const option = {
        id: 'opt1',
        number: 1,
        text: "You have your gear. You'll need it. You've prepared yourself.",
        fullText: "...",
      };
      expect(createPlayerMessageFromOption(option)).toBe("I have my gear. I'll need it. I've prepared myself.");
    });
  });
});
