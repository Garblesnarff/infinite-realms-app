import { describe, it, expect } from 'vitest';

import { ContextBuilder } from '../context-builder';
import { CharacterDescriptionPrompts } from '../prompts/character-description-prompts';

import type { CharacterData, DescriptionOptions } from '../prompts/character-description-prompts';
import type { GameContext } from '../shared/types';
import type { CombatDetectionResult } from '@/utils/combatDetection';

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
      const prompt = CharacterDescriptionPrompts.buildDescriptionPrompt(
        mockCharacterData,
        mockOptions,
      );
      expect(prompt).toContain('Thrain');
      expect(prompt).toContain('Dwarf');
      expect(prompt).toContain('Fighter');
    });

    it('should include enhancement instructions when existing description is provided', () => {
      const prompt = CharacterDescriptionPrompts.buildDescriptionPrompt(
        mockCharacterData,
        mockOptions,
      );
      expect(prompt).toContain('Enhance and expand');
      expect(prompt).toContain('A stout dwarf.');
    });

    it('should include verbalized sampling technique', () => {
      const prompt = CharacterDescriptionPrompts.buildDescriptionPrompt(
        mockCharacterData,
        mockOptions,
      );
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

describe('ContextBuilder opening prompt isolation', () => {
  const minimalContext: GameContext = {
    campaignId: 'campaign-1',
    characterId: 'character-1',
  };

  const noCombat: CombatDetectionResult = {
    isCombat: false,
    combatType: 'none',
    confidence: 0,
    shouldStartCombat: false,
    shouldEndCombat: false,
  };

  it('uses an opening-only prompt contract for the first message', async () => {
    const prompt = await ContextBuilder.build({
      context: minimalContext,
      message: '',
      conversationHistory: [],
      relevantMemories: [],
      combatDetection: noCombat,
      voiceContext: null,
      isFirstMessage: true,
    });

    expect(prompt).toContain('CAMPAIGN OPENING - FIRST MESSAGE');
    expect(prompt).toContain('OPENING RESPONSE CONTRACT');
    expect(prompt).toContain('Do NOT request a roll');
    expect(prompt).not.toContain('CRITICAL: WHEN TO REQUEST DICE ROLLS');
    expect(prompt).not.toContain('MANDATORY: DICE ROLL FORMAT');
    expect(prompt).not.toContain('<memory_extraction>');
    expect(prompt).not.toContain('REMEMBER: Always respond in the JSON format');
  });

  it('keeps normal roll and memory rules for non-opening responses', async () => {
    const prompt = await ContextBuilder.build({
      context: minimalContext,
      message: 'I search the room.',
      conversationHistory: [],
      relevantMemories: [],
      combatDetection: noCombat,
      voiceContext: null,
      isFirstMessage: false,
    });

    expect(prompt).toContain('CRITICAL: WHEN TO REQUEST DICE ROLLS');
    expect(prompt).toContain('MANDATORY: DICE ROLL FORMAT');
    expect(prompt).toContain('<memory_extraction>');
    expect(prompt).not.toContain('OPENING RESPONSE CONTRACT');
  });
});
