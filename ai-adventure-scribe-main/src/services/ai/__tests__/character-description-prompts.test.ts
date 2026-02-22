import { describe, it, expect } from 'vitest';
import { CharacterDescriptionPrompts } from '../prompts/character-description-prompts';
import type { CharacterData, DescriptionOptions } from '../prompts/character-description-prompts';

describe('CharacterDescriptionPrompts', () => {
  const mockCharacterData: CharacterData = {
    name: 'Thrain',
    race: 'Dwarf',
    class: 'Fighter',
    description: 'A stout dwarf.',
  };

  const mockOptions: DescriptionOptions = {
    enhanceExisting: true,
    tone: 'heroic',
  };

  describe('buildDescriptionPrompt', () => {
    it('should include character basics', () => {
      const prompt = CharacterDescriptionPrompts.buildDescriptionPrompt(mockCharacterData, mockOptions);
      expect(prompt).toContain('Thrain');
      expect(prompt).toContain('Dwarf');
      expect(prompt).toContain('Fighter');
    });

    it('should include enhancement instructions when existing description is provided', () => {
      const prompt = CharacterDescriptionPrompts.buildDescriptionPrompt(mockCharacterData, mockOptions);
      expect(prompt).toContain('Enhance and expand');
      expect(prompt).toContain('A stout dwarf.');
    });

    it('should include verbalized sampling technique', () => {
      const prompt = CharacterDescriptionPrompts.buildDescriptionPrompt(mockCharacterData, mockOptions);
      expect(prompt).toContain('<verbalized_sampling_technique>');
    });

    it('should use default options when none are provided', () => {
      const prompt = CharacterDescriptionPrompts.buildDescriptionPrompt(mockCharacterData, {});
      expect(prompt).toContain('APPEARANCE');
      expect(prompt).toContain('PERSONALITY');
      expect(prompt).toContain('BACKSTORY');
      expect(prompt).toContain('heroic');
    });
  });

  describe('buildQuickDescriptionPrompt', () => {
    it('should build a simple prompt', () => {
      const prompt = CharacterDescriptionPrompts.buildQuickDescriptionPrompt(mockCharacterData);
      expect(prompt).toContain('Create a brief, engaging description');
      expect(prompt).toContain('Thrain');
    });
  });
});
