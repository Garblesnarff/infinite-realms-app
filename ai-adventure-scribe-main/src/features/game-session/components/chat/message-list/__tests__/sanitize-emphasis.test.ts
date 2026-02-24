import { describe, it, expect } from 'vitest';

import { sanitizeEmphasisDelimiters } from '../sanitize-emphasis';

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
