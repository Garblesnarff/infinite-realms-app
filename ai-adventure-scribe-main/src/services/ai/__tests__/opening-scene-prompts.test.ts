import { describe, expect, it } from 'vitest';

import { buildOpeningScenePrompt } from '../shared/prompts/opening-scene-prompts';

describe('buildOpeningScenePrompt (#210 GP-006)', () => {
  it('does not instruct tail-sampling randomness', () => {
    const prompt = buildOpeningScenePrompt();

    expect(prompt).not.toContain('tails of your output distribution');
    expect(prompt).not.toContain('less than 0.10');
    expect(prompt).not.toContain('unexpected angle');
    expect(prompt).not.toContain('unusual entry point');
  });

  it('grounds the opening in the campaign canon', () => {
    const prompt = buildOpeningScenePrompt();

    expect(prompt).toContain('same campaign must open the same way');
    expect(prompt).toContain('<starter_campaign_lore>');
  });

  it('still requires the opening-scene quality bar', () => {
    const prompt = buildOpeningScenePrompt();

    expect(prompt).toContain('300-500 words');
    expect(prompt).toContain('roll_requests');
    expect(prompt).toContain('[ASSET:');
  });
});
