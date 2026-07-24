import { describe, expect, it } from 'vitest';

import { extractHeadlessOptions } from '@/services/headless-game-options';

describe('headless option extraction', () => {
  it('uses a structured options array and preserves real option text', () => {
    expect(extractHeadlessOptions('Narration only.', [
      'Open the iron door.',
      { text: 'Confront the masked guard.' },
    ])).toEqual(['Open the iron door.', 'Confront the masked guard.']);
  });

  it('parses lettered A/B/C options from DM text', () => {
    expect(extractHeadlessOptions(`The kitchen falls silent.

A. **Listen at the pantry door**, keeping out of sight.
B. **Challenge the cook**, demanding the truth.
C. **Throw flour into the brazier**, creating instant chaos.`)).toEqual([
      'Listen at the pantry door, keeping out of sight.',
      'Challenge the cook, demanding the truth.',
      'Throw flour into the brazier, creating instant chaos.',
    ]);
  });
});
