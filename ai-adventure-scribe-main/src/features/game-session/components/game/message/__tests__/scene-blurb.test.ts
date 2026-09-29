import { describe, expect, it } from 'vitest';

import { toHeaderExcerpt } from '../scene-blurb';

const ENGINE_LINE =
  '⚙️ Engine: The Veteran rolled 14 + 5 = 19 vs AC 12 against Goblin with Longsword — HIT. 8 slashing damage.';

describe('toHeaderExcerpt (scene subtitle, #2256)', () => {
  it('strips an engine line that leads the DM reply', () => {
    const out = toHeaderExcerpt(
      `${ENGINE_LINE}\n\nThe goblin staggers back. Smoke curls from the torch.`,
    );

    expect(out).toBe('The goblin staggers back. Smoke curls from the torch.');
    expect(out).not.toContain('Engine');
  });

  it('strips every engine line, including ones between paragraphs', () => {
    const out = toHeaderExcerpt(
      `${ENGINE_LINE}\n${ENGINE_LINE.replace('HIT', 'MISS')}\nThe hall falls silent.`,
    );

    expect(out).toBe('The hall falls silent.');
  });

  it('returns an empty string when only engine lines are left, so callers keep the old subtitle', () => {
    expect(toHeaderExcerpt(ENGINE_LINE)).toBe('');
    expect(toHeaderExcerpt(`${ENGINE_LINE}\n${ENGINE_LINE}`)).toBe('');
  });

  it('still trims scene text to two sentences and drops visual-prompt lines', () => {
    const out = toHeaderExcerpt('VISUAL PROMPT: a dark cave\nOne. Two. Three.');

    expect(out).toBe('One. Two.');
  });
});
