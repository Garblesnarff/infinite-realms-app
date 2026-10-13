import { describe, expect, it } from 'vitest';

import { ContextBuilderPrompts } from '../context-builder-prompts';

describe('ContextBuilderPrompts.buildVoiceOptimizationSection', () => {
  it('requires one narration segment per speaker change', () => {
    const section = ContextBuilderPrompts.buildVoiceOptimizationSection();
    expect(section).toContain('<voice_optimization>');
    expect(section).toContain('one narration_segments entry per speaker change');
    expect(section).toContain('at least two segments with distinct speakers');
  });
});

describe('ContextBuilderPrompts.buildResponseStructureSection', () => {
  it('limits suggested attacks and spells to the character sheet (#400)', () => {
    const section = ContextBuilderPrompts.buildResponseStructureSection({ inCombat: false });
    expect(section).toContain('<options_field>');
    expect(section).toContain('spell or attack the character does not have');
  });
});
