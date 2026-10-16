import { describe, expect, it } from 'vitest';

import { parseScript } from './script';

describe('parseScript', () => {
  it('keeps one input per line, in order', () => {
    expect(parseScript('Check the altar.\nPray for guidance.')).toEqual([
      'Check the altar.',
      'Pray for guidance.',
    ]);
  });

  it('ignores blank lines and comments', () => {
    expect(parseScript('# opening\n\n  \nCheck the altar.\n# a note\nroll\n')).toEqual([
      'Check the altar.',
      'roll',
    ]);
  });

  it('trims surrounding whitespace and handles CRLF', () => {
    expect(parseScript('  move\r\n move goblin 3 4 \r\n')).toEqual(['move', 'move goblin 3 4']);
  });

  it('returns an empty list for an empty or comment-only script', () => {
    expect(parseScript('')).toEqual([]);
    expect(parseScript('# nothing here\n')).toEqual([]);
  });
});
