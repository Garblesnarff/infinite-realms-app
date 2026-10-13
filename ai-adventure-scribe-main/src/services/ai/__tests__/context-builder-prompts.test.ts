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
