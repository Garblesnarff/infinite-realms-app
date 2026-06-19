import { describe, it, expect } from 'vitest';

import {
  npcPatterns,
  locationPatterns,
  atmospherePatterns,
  itemPatterns,
  eventPatterns,
  questPatterns,
  storyBeatPatterns,
  characterMomentPatterns,
  dialogueGemPatterns,
  plotPointPatterns,
  foreshadowingPatterns,
  worldDetailPatterns
} from '../index';

describe('Memory Classification Patterns', () => {
  describe('npcPatterns', () => {
    it('should match common NPC titles and roles', () => {
      const patterns = npcPatterns.patterns;
      const testCases = ['king', 'queen', 'wizard', 'merchant', 'guard', 'dragon'];
      testCases.forEach(word => {
        expect(patterns).toContain(word);
      });
    });

    it('should match character names with titles using context patterns', () => {
      const regex = npcPatterns.contextPatterns.find(p => p.source.includes('[A-Z][a-z]+ the'));
      expect(regex).toBeDefined();
      if (regex) {
        expect(regex.test('Drizzt the Bold')).toBe(true);
        expect(regex.test('Elminster the Wise')).toBe(true);
        expect(regex.test('drizzt the bold')).toBe(true);
      }
    });

    it('should match "the X" patterns', () => {
      const regex = npcPatterns.contextPatterns.find(p => p.source.includes('the\\s+'));
      expect(regex).toBeDefined();
      if (regex) {
        expect(regex.test('the elder wizard')).toBe(true);
        expect(regex.test('the mysterious innkeeper')).toBe(true);
      }
    });
  });

  describe('locationPatterns', () => {
    it('should match natural and artificial locations', () => {
      const patterns = locationPatterns.patterns;
      expect(patterns).toContain('castle');
      expect(patterns).toContain('forest');
      expect(patterns).toContain('mountain');
      expect(patterns).toContain('tavern');
    });

    it('should match "X of Y" location patterns', () => {
      const regex = locationPatterns.contextPatterns.find(p => p.source.includes('of [A-Z]'));
      expect(regex).toBeDefined();
      if (regex) {
        expect(regex.test('village of Oakhaven')).toBe(true);
        expect(regex.test('city of Neverwinter')).toBe(true);
        expect(regex.test('realm of Gondor')).toBe(true);
      }
    });

    it('should match named natural locations', () => {
      const regex = locationPatterns.contextPatterns.find(p => p.source.includes('Woods|Mountains'));
      expect(regex).toBeDefined();
      if (regex) {
        expect(regex.test('Shadow Woods')).toBe(true);
        expect(regex.test('Cloudy Mountains')).toBe(true);
        expect(regex.test('Hidden Valley')).toBe(true);
      }
    });
  });

  describe('atmospherePatterns', () => {
    it('should match mood and sensory keywords', () => {
      const patterns = atmospherePatterns.patterns;
      expect(patterns).toContain('tension');
      expect(patterns).toContain('dread');
      expect(patterns).toContain('wonder');
      expect(patterns).toContain('smell');
    });

    it('should match air/atmosphere descriptions', () => {
      const regex = atmospherePatterns.contextPatterns.find(p => p.source.includes('thick with|heavy with'));
      expect(regex).toBeDefined();
      if (regex) {
        expect(regex.test('air thick with tension')).toBe(true);
        expect(regex.test('atmosphere heavy with dread')).toBe(true);
      }
    });
  });

  describe('itemPatterns', () => {
    it('should match common item types', () => {
      const patterns = itemPatterns.patterns;
      expect(patterns).toContain('sword');
      expect(patterns).toContain('amulet');
      expect(patterns).toContain('potion');
      expect(patterns).toContain('scroll');
    });

    it('should match important items using context patterns', () => {
      const regex = itemPatterns.contextPatterns.find(p => p.source.includes('legendary|mythical'));
      expect(regex).toBeDefined();
      if (regex) {
        expect(regex.test('a legendary artifact')).toBe(true);
        expect(regex.test('the mythical weapon')).toBe(true);
      }
    });
  });

  describe('eventPatterns', () => {
    it('should match event-related keywords', () => {
      const patterns = eventPatterns.patterns;
      expect(patterns).toContain('battle');
      expect(patterns).toContain('war');
      expect(patterns).toContain('ceremony');
      expect(patterns).toContain('discovery');
    });

    it('should match significant moments', () => {
      const regex = eventPatterns.contextPatterns.find(p => p.source.includes('ancient|great|terrible'));
      expect(regex).toBeDefined();
      if (regex) {
        expect(regex.test('The Great War began')).toBe(true);
        expect(regex.test('An ancient prophecy')).toBe(true);
      }
    });
  });

  describe('questPatterns', () => {
    it('should match quest-related keywords', () => {
      const patterns = questPatterns.patterns;
      expect(patterns).toContain('quest');
      expect(patterns).toContain('mission');
      expect(patterns).toContain('task');
      expect(patterns).toContain('objective');
    });
  });

  describe('storyBeatPatterns', () => {
    it('should match story beat keywords', () => {
      const patterns = storyBeatPatterns.patterns;
      expect(patterns).toContain('climax');
      expect(patterns).toContain('scene');
      expect(patterns).toContain('revelation');
      expect(patterns).toContain('turning point');
    });
  });

  describe('characterMomentPatterns', () => {
    it('should match character growth keywords', () => {
      const patterns = characterMomentPatterns.patterns;
      expect(patterns).toContain('realization');
      expect(patterns).toContain('growth');
      expect(patterns).toContain('change');
    });
  });

  describe('dialogueGemPatterns', () => {
    it('should match dialogue-related keywords', () => {
      const patterns = dialogueGemPatterns.patterns;
      expect(patterns).toContain('quote');
      expect(patterns).toContain('saying');
      expect(patterns).toContain('declaration');
    });
  });

  describe('plotPointPatterns', () => {
    it('should match plot point keywords', () => {
      const patterns = plotPointPatterns.patterns;
      expect(patterns).toContain('discovery');
      expect(patterns).toContain('escalation');
      expect(patterns).toContain('resolution');
    });
  });

  describe('foreshadowingPatterns', () => {
    it('should match foreshadowing keywords', () => {
      const patterns = foreshadowingPatterns.patterns;
      expect(patterns).toContain('omen');
      expect(patterns).toContain('prophecy');
      expect(patterns).toContain('vision');
      expect(patterns).toContain('premonition');
    });
  });

  describe('worldDetailPatterns', () => {
    it('should match world detail keywords', () => {
      const patterns = worldDetailPatterns.patterns;
      expect(patterns).toContain('lore');
      expect(patterns).toContain('history');
      expect(patterns).toContain('custom');
      expect(patterns).toContain('tradition');
    });
  });
});
