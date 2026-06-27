/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';

import { normalizeCharacterName, inferVoiceCategory, cleanSegmentText } from '../voice-utils';

describe('voice-utils', () => {
  describe('normalizeCharacterName', () => {
    it('should return empty string for null or undefined input', () => {
      expect(normalizeCharacterName(null as any)).toBe('');
      expect(normalizeCharacterName(undefined as any)).toBe('');
    });

    it('should normalize character names correctly', () => {
      expect(normalizeCharacterName('The Wizard')).toBe('wizard');
      expect(normalizeCharacterName('a dragon')).toBe('dragon');
      expect(normalizeCharacterName('An ancient beast')).toBe('ancient beast');
      expect(normalizeCharacterName('  Spacey   Name  ')).toBe('spacey name');
      expect(normalizeCharacterName("Drizzt Do'Urden")).toBe("drizzt do'urden");
      expect(normalizeCharacterName('Jean-Luc')).toBe('jean-luc');
      expect(normalizeCharacterName('Gimli!')).toBe('gimli');
    });

    it('should remove special characters but keep apostrophes and hyphens', () => {
      expect(normalizeCharacterName('Smaug (Dragon)')).toBe('smaug dragon');
      expect(normalizeCharacterName('O\'Brian-Smith!')).toBe("o'brian-smith");
    });
  });

  describe('inferVoiceCategory', () => {
    it('should infer elder category', () => {
      expect(inferVoiceCategory('Gandalf the Wizard')).toBe('elder');
      expect(inferVoiceCategory('Old Sage')).toBe('elder');
      expect(inferVoiceCategory('Master Thorne')).toBe('elder');
    });

    it('should infer villain_male category', () => {
      expect(inferVoiceCategory('Dark Lord')).toBe('villain_male');
      expect(inferVoiceCategory('Shadow Demon')).toBe('villain_male');
    });

    it('should infer villain_female category', () => {
      expect(inferVoiceCategory('Sorceress')).toBe('villain_female');
      expect(inferVoiceCategory('Witch')).toBe('villain_female');
    });

    it('should infer guard category', () => {
      expect(inferVoiceCategory('City Guard')).toBe('guard');
      expect(inferVoiceCategory('Knight Captain')).toBe('guard');
    });

    it('should infer merchant category', () => {
      expect(inferVoiceCategory('Potion Trader')).toBe('merchant');
      expect(inferVoiceCategory('Shopkeeper Bob')).toBe('merchant');
    });

    it('should infer child category', () => {
      expect(inferVoiceCategory('Young Boy')).toBe('child');
      expect(inferVoiceCategory('Small Girl')).toBe('child');
    });

    it('should infer monster category', () => {
      expect(inferVoiceCategory('Red Dragon')).toBe('monster');
      expect(inferVoiceCategory('Cave Beast')).toBe('monster');
    });

    it('should infer goblin category', () => {
      expect(inferVoiceCategory('Goblin Scout')).toBe('goblin');
      expect(inferVoiceCategory('Fire Sprite')).toBe('goblin');
    });

    it('should fallback to hero_female for gendered names', () => {
      expect(inferVoiceCategory('The Noble Lady')).toBe('hero_female');
      expect(inferVoiceCategory('Strong Woman')).toBe('hero_female');
    });

    it('should default to hero_male', () => {
      expect(inferVoiceCategory('Aragorn')).toBe('hero_male');
      expect(inferVoiceCategory('Legolas')).toBe('hero_male');
    });
  });

  describe('cleanSegmentText', () => {
    it('should return empty string for null or undefined input', () => {
      expect(cleanSegmentText(null as any)).toBe('');
      expect(cleanSegmentText(undefined as any)).toBe('');
    });

    it('should remove markdown and normalize spaces', () => {
      expect(cleanSegmentText('*Italic* and **Bold**')).toBe('Italic and Bold');
      expect(cleanSegmentText('`code` and # Header')).toBe('code and Header');
      expect(cleanSegmentText('__Underline__')).toBe('Underline');
      expect(cleanSegmentText('Multiple    Spaces    Normalized')).toBe('Multiple Spaces Normalized');
    });

    it('should trim whitespace', () => {
      expect(cleanSegmentText('   Surrounded by space   ')).toBe('Surrounded by space');
    });
  });
});
