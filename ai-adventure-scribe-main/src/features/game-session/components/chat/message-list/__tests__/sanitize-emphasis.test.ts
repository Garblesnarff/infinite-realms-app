import { type ReactElement } from 'react';
import { describe, it, expect } from 'vitest';

import { formatNarrative } from '../formatNarrative';
import { sanitizeEmphasisDelimiters } from '../sanitize-emphasis';

import type React from 'react';

describe('sanitizeEmphasisDelimiters', () => {
  it('leaves valid *emphasis* unchanged', () => {
    expect(sanitizeEmphasisDelimiters('The *dragon* roars.')).toBe('The *dragon* roars.');
  });

  it('strips orphan opening * with no closing pair — playtest case 1', () => {
    // "* Whisper's form flickers violently..." — no closing *
    const result = sanitizeEmphasisDelimiters("* Whisper's form flickers violently.");
    expect(result).not.toContain('*');
    expect(result).toContain("Whisper's form flickers violently.");
  });

  it('fixes space-padded emphasis — playtest case 2', () => {
    // "* Lord Diabolo*" — space after opening *
    const result = sanitizeEmphasisDelimiters('Then you see him. * Lord Diabolo* approaches.');
    expect(result).not.toMatch(/\* Lord Diabolo\*/);
    // Valid emphasis pair should survive (spaces trimmed)
    expect(result).toMatch(/\*Lord Diabolo\*/);
    expect(result).toContain('approaches.');
  });

  it('normalizes **bold** to *bold*', () => {
    const result = sanitizeEmphasisDelimiters('The **ancient tome** glows.');
    expect(result).toBe('The *ancient tome* glows.');
  });

  it('strips orphan * at the start of a line', () => {
    const result = sanitizeEmphasisDelimiters('* Lord Diabolo raises his sword.');
    expect(result).not.toContain('*');
    expect(result).toContain('Lord Diabolo raises his sword.');
  });

  it('handles cross-line emphasis by stripping both orphan markers', () => {
    // Opening * on line 1, closing * on line 2 — must strip both
    const result = sanitizeEmphasisDelimiters(
      '*Lord Diabolo looms over you.\nHis shadow falls across the ground.*',
    );
    // Neither line should retain a * (cross-line not supported)
    const lines = result.split('\n');
    expect(lines[0]).not.toContain('*');
    expect(lines[1]).not.toContain('*');
  });

  it('preserves multiple valid emphasis spans on same line', () => {
    const result = sanitizeEmphasisDelimiters('The *first* and *second* glowed.');
    expect(result).toBe('The *first* and *second* glowed.');
  });

  it('strips trailing space inside emphasis', () => {
    const result = sanitizeEmphasisDelimiters('The *relic * shines.');
    expect(result).toBe('The *relic* shines.');
  });

  it('does not corrupt plain text with no asterisks', () => {
    const plain = 'The dungeon was dark and silent.';
    expect(sanitizeEmphasisDelimiters(plain)).toBe(plain);
  });
});

describe('formatNarrative — JSON escape artifact handling (issue #340)', () => {
  const extractText = (node: React.ReactNode): string => {
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(extractText).join('');
    if (node && typeof node === 'object' && 'props' in node) {
      return extractText((node as ReactElement).props.children as React.ReactNode);
    }
    return '';
  };

  it('unescapes backslash-quote sequences in AI narrative', () => {
    const input = '\\"Now, which station do you want?\\"';
    const { content } = formatNarrative(input);
    const text = extractText(content);
    expect(text).not.toContain('\\"');
    expect(text).toContain('"Now, which station do you want?"');
  });

  it('unescapes backslash-single-quote sequences', () => {
    const input = "It\\'s a trap!";
    const { content } = formatNarrative(input);
    const text = extractText(content);
    expect(text).not.toContain("\\'");
    expect(text).toContain("It's a trap!");
  });

  it('handles combined backslash-quote + emphasis artifacts', () => {
    const input = '* Lord \\"Diabolo\\"* steps forward.';
    const { content } = formatNarrative(input);
    const text = extractText(content);
    expect(text).not.toContain('\\"');
    expect(text).toContain('"Diabolo"');
  });

  it('keeps curly closing quotes attached to the preceding sentence', () => {
    const input =
      '“We’ve been expecting you. Though I’ll admit, we weren’t sure when you’d arrive.” He glances at the door. “The restaurant has a way of finding the right people.”';
    const { content } = formatNarrative(input);
    const text = extractText(content);

    expect(text).toContain('when you’d arrive.” He glances at the door.');
    expect(text).toContain('“The restaurant has a way of finding the right people.”');
    expect(text).not.toContain('arrive. ”');
  });

  it('strips broken emphasis markers wrapped around quoted dialogue', () => {
    const input =
      'Whisper leans in:** *"You’re late. The Manager doesn’t like late."*** Dishwasher Prime grins.** *"Oh! New staff! I *love* leftovers."*';
    const { content } = formatNarrative(input);
    const text = extractText(content);

    expect(text).toContain('Whisper leans in:"You’re late. The Manager doesn’t like late."');
    expect(text).toContain('Dishwasher Prime grins.');
    expect(text).toContain('"Oh! New staff! I love leftovers."');
    expect(text).not.toContain('**');
  });
});
