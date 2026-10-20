/**
 * #633 PR2: unit tests for the incremental narration extractor used by the
 * SSE streaming path.
 */
import { describe, expect, it } from 'bun:test';

import { extractPartialNarration } from '../llm-streaming.js';

describe('extractPartialNarration', () => {
  it('returns null before the text key arrives', () => {
    expect(extractPartialNarration('')).toBeNull();
    expect(extractPartialNarration('{"combat_transition": "none", ')).toBeNull();
  });

  it('returns null when the key itself is cut mid-token', () => {
    expect(extractPartialNarration('{"tex')).toBeNull();
    expect(extractPartialNarration('{"text"')).toBeNull();
  });

  it('extracts the narration prefix as tokens arrive', () => {
    expect(extractPartialNarration('{"text": "The tavern')).toBe('The tavern');
    expect(extractPartialNarration('{"text": "The tavern door')).toBe('The tavern door');
  });

  it('decodes a complete envelope', () => {
    expect(extractPartialNarration('{"text": "Hi", "combat_transition": "none"}')).toBe('Hi');
  });

  it('finds the text key when it is not first', () => {
    expect(extractPartialNarration('{"combat_transition": "none", "text": "Late"}')).toBe('Late');
  });

  it('ignores a nested "text" key before the top-level one', () => {
    expect(extractPartialNarration('{"scene": {"text": "nested"}, "text": "top-level')).toBe(
      'top-level',
    );
  });

  it('tolerates whitespace around the colon', () => {
    expect(extractPartialNarration('{"text"  :  "spaced"}')).toBe('spaced');
  });

  it('handles a value cut mid-escape', () => {
    // Tail is a lone backslash: trimmed, the rest decodes.
    expect(extractPartialNarration('{"text": "abc\\')).toBe('abc');
    // Tail is a partial \u escape.
    expect(extractPartialNarration('{"text": "abc\\u00')).toBe('abc');
    // A complete escape decodes normally.
    expect(extractPartialNarration('{"text": "a\\"b')).toBe('a"b');
  });

  it('returns null for a value that never opens', () => {
    expect(extractPartialNarration('{"text": ')).toBeNull();
    expect(extractPartialNarration('{"text": 42')).toBeNull();
  });
});

describe('#875 options never enter the preview', () => {
  it('stops at text with reordered keys and escaped quotes at every chunk boundary', () => {
    const story = 'She says "Welcome" and waits.';
    const raw = JSON.stringify({ options: ['A. Sit'], text: story, scene: { text: 'nested' } });
    for (let i = 0; i <= raw.length; i++) {
      const preview = extractPartialNarration(raw.slice(0, i));
      if (preview !== null) expect(story.startsWith(preview)).toBe(true);
    }
    expect(extractPartialNarration(raw)).toBe(story);
  });
  it('removes an options appendix authored inside text, including a truncated array', () => {
    expect(
      extractPartialNarration(
        JSON.stringify({ text: 'The door opens.\noptions: ["A. Enter", "B.' }),
      ),
    ).toBe('The door opens.');
  });
});
