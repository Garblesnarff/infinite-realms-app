import { describe, expect, it } from 'vitest';

import { extractEngineGeneratedLines, stripEngineGeneratedLines } from '../engine-lines';

const SAMPLE =
  '⚙️ Engine: The Storyteller rolled 16 + 4 = 20 vs AC 12 against Dishwasher Prime with Rapier — HIT. 8 piercing damage.\n\n' +
  'Steel rings off enamel.';

describe('extractEngineGeneratedLines', () => {
  it('keeps the engine fact for a chip and leaves the fiction for the bubble', () => {
    const { lines, fiction } = extractEngineGeneratedLines(SAMPLE);
    expect(lines).toEqual([
      '⚙️ Engine: The Storyteller rolled 16 + 4 = 20 vs AC 12 against Dishwasher Prime with Rapier — HIT. 8 piercing damage.',
    ]);
    expect(fiction).toBe('Steel rings off enamel.');
  });

  it('does not invent a chip when the transcript has no engine line', () => {
    expect(extractEngineGeneratedLines('Just a room.')).toEqual({
      lines: [],
      fiction: 'Just a room.',
    });
  });
});

describe('stripEngineGeneratedLines', () => {
  it('still drops engine lines from downstream processor input', () => {
    expect(stripEngineGeneratedLines(SAMPLE)).toBe('Steel rings off enamel.');
  });
});
