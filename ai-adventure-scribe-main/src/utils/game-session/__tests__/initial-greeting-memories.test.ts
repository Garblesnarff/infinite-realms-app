import { describe, it, expect, vi } from 'vitest';

import { createInitialMemories, extractAtmosphereFromGreeting } from '../initial-greeting-memories';

import type { Campaign } from '@/types/campaign';
import type { Character } from '@/types/character';


// Mock SentenceSegmenter
vi.mock('@/utils/sentence-segmenter', () => ({
  SentenceSegmenter: {
    splitIntoSentences: vi.fn((text) => text.split('. ')),
  },
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
  },
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('initial-greeting-memories', () => {
  const mockCharacter = {
    id: 'char-1',
    name: 'Balthazar',
    race: { name: 'Human' },
    class: { name: 'Wizard', hitDie: 6 },
    level: 1,
    background: { name: 'Sage' },
  } as unknown as Character;

  const mockCampaign = {
    id: 'camp-1',
    name: 'Test Adventure',
    description: 'A test campaign description.',
  } as unknown as Campaign;

  describe('createInitialMemories', () => {
    it('calls onMemoryCreated for foundational memories', async () => {
      const onMemoryCreated = vi.fn().mockResolvedValue(undefined);
      const greetingText = 'The air is cold and damp in the dungeon.';
      const sessionId = 'session-1';

      await createInitialMemories(sessionId, mockCharacter, mockCampaign, greetingText, onMemoryCreated);

      expect(onMemoryCreated).toHaveBeenCalledTimes(4); // Character, Campaign, Scene, Atmosphere

      // Verify character memory
      expect(onMemoryCreated).toHaveBeenCalledWith(expect.objectContaining({
        type: 'character_moment',
        session_id: sessionId,
      }));

      // Verify atmosphere memory
      expect(onMemoryCreated).toHaveBeenCalledWith(expect.objectContaining({
        type: 'atmosphere',
        content: expect.stringContaining('Initial atmosphere:'),
      }));
    });
  });

  describe('extractAtmosphereFromGreeting', () => {
    it('extracts atmospheric sentences', () => {
      const text = 'The air is thick with smoke. Balthazar enters the room. The stone floor is cold.';
      const result = extractAtmosphereFromGreeting(text);
      expect(result).toContain('Initial atmosphere:');
      expect(result).toContain('The air is thick with smoke');
      expect(result).toContain('The stone floor is cold');
      expect(result).not.toContain('Balthazar enters the room');
    });

    it('returns null if no atmospheric sentences found', () => {
      const text = 'Balthazar walks. He talks.';
      const result = extractAtmosphereFromGreeting(text);
      expect(result).toBeNull();
    });
  });
});
