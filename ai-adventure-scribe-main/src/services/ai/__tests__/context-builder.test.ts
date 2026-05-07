/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ContextBuilder } from '../context-builder';
import { ContextBuilderPrompts } from '../context-builder-prompts';
import { CombatRulesPrompts } from '../prompts/combat-rules-prompts';
import { RulesPrompts } from '../prompts/rules-prompts';

vi.mock('../context-builder-prompts', () => ({
  ContextBuilderPrompts: {
    buildPersonaSection: vi.fn(() => '<persona_section>'),
    buildGameContextSection: vi.fn(async () => '<game_context_section>'),
    buildOpeningSceneSection: vi.fn(() => '<opening_scene_section>'),
    buildOpeningResponseStructureSection: vi.fn(() => '<opening_response_structure_section>'),
    buildOpeningFinalRemindersSection: vi.fn(() => '<opening_final_reminders_section>'),
    buildVoiceOptimizationSection: vi.fn(() => '<voice_optimization_section>'),
    buildResponseStructureSection: vi.fn(() => '<response_structure_section>'),
    buildFinalRemindersSection: vi.fn(() => '<final_reminders_section>'),
  },
}));

vi.mock('../prompts/combat-rules-prompts', () => ({
  CombatRulesPrompts: {
    formatCombatContext: vi.fn((cd: any) => `<combat_context_${cd.isCombat}>`),
    buildCombatRollRequirementsSection: vi.fn(() => '<combat_roll_requirements_section>'),
  },
}));

vi.mock('../prompts/rules-prompts', () => ({
  RulesPrompts: {
    buildRulesOfPlaySection: vi.fn(() => '<rules_of_play_section>'),
  },
}));

describe('ContextBuilder', () => {
  const mockContext = {
    campaignId: 'camp-123',
    characterId: 'char-456',
  } as any;

  const defaultParams = {
    context: mockContext,
    message: 'Hello',
    relevantMemories: [],
    combatDetection: null as any,
    voiceContext: null,
    isFirstMessage: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should build a basic context for a regular message', async () => {
    const result = await ContextBuilder.build(defaultParams);

    expect(ContextBuilderPrompts.buildPersonaSection).toHaveBeenCalled();
    expect(ContextBuilderPrompts.buildGameContextSection).toHaveBeenCalledWith(mockContext, []);
    expect(RulesPrompts.buildRulesOfPlaySection).toHaveBeenCalled();
    expect(ContextBuilderPrompts.buildResponseStructureSection).toHaveBeenCalled();
    expect(ContextBuilderPrompts.buildFinalRemindersSection).toHaveBeenCalled();

    expect(result).toContain('<persona_section>');
    expect(result).toContain('<game_context_section>');
    expect(result).toContain('<rules_of_play_section>');
    expect(result).toContain('<response_structure_section>');
    expect(result).toContain('<final_reminders_section>');

    // Should NOT contain opening or special sections
    expect(result).not.toContain('<opening_scene_section>');
    expect(result).not.toContain('<voice_optimization_section>');
  });

  it('should build a specialized context for the first message', async () => {
    const result = await ContextBuilder.build({
      ...defaultParams,
      isFirstMessage: true,
    });

    expect(ContextBuilderPrompts.buildOpeningSceneSection).toHaveBeenCalled();
    expect(ContextBuilderPrompts.buildOpeningResponseStructureSection).toHaveBeenCalled();
    expect(ContextBuilderPrompts.buildOpeningFinalRemindersSection).toHaveBeenCalled();

    expect(result).toContain('<persona_section>');
    expect(result).toContain('<game_context_section>');
    expect(result).toContain('<opening_scene_section>');
    expect(result).toContain('<opening_response_structure_section>');
    expect(result).toContain('<opening_final_reminders_section>');

    // Should NOT contain regular sections
    expect(result).not.toContain('<rules_of_play_section>');
    expect(result).not.toContain('<response_structure_section>');
  });

  it('should include combat context when combat is detected', async () => {
    const combatDetection = { isCombat: true, confidence: 1 } as any;
    const result = await ContextBuilder.build({
      ...defaultParams,
      combatDetection,
    });

    expect(CombatRulesPrompts.formatCombatContext).toHaveBeenCalledWith(combatDetection);
    expect(CombatRulesPrompts.buildCombatRollRequirementsSection).toHaveBeenCalled();

    expect(result).toContain('<combat_context_true>');
    expect(result).toContain('<combat_roll_requirements_section>');
  });

  it('should include combat context but NOT roll requirements when combat detection is present but isCombat is false', async () => {
    const combatDetection = { isCombat: false, confidence: 0.1 } as any;
    const result = await ContextBuilder.build({
      ...defaultParams,
      combatDetection,
    });

    expect(CombatRulesPrompts.formatCombatContext).toHaveBeenCalledWith(combatDetection);
    expect(CombatRulesPrompts.buildCombatRollRequirementsSection).not.toHaveBeenCalled();

    expect(result).toContain('<combat_context_false>');
    expect(result).not.toContain('<combat_roll_requirements_section>');
  });

  it('should include voice optimization when voiceContext is present', async () => {
    const voiceContext = { sessionId: 'sess-1' } as any;
    const result = await ContextBuilder.build({
      ...defaultParams,
      voiceContext,
    });

    expect(ContextBuilderPrompts.buildVoiceOptimizationSection).toHaveBeenCalled();
    expect(result).toContain('<voice_optimization_section>');
    expect(result).toContain('Always respond in the JSON format with narration_segments');
  });

  it('should correctly combine combat and voice contexts', async () => {
    const combatDetection = { isCombat: true } as any;
    const voiceContext = { sessionId: 'sess-1' } as any;

    const result = await ContextBuilder.build({
      ...defaultParams,
      combatDetection,
      voiceContext,
    });

    expect(result).toContain('<combat_context_true>');
    expect(result).toContain('<voice_optimization_section>');
    expect(result).toContain('<response_structure_section>');
  });
});
