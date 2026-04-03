import { describe, it, expect } from 'vitest';

import { sanitizeDMText } from '../chatSanitizer';

describe('chatSanitizer', () => {
  describe('sanitizeDMText', () => {
    it('should pass through normal text unchanged', () => {
      const input = 'The goblin charges at you with a rusted scimitar.';
      expect(sanitizeDMText(input)).toBe(input);
    });

    it('should remove "Combat has begun! Initiative order established."', () => {
      const input = 'The air grows cold.\nCombat has begun! Initiative order established.\nRoll for initiative!';
      const expected = 'The air grows cold.\nRoll for initiative!';
      expect(sanitizeDMText(input)).toBe(expected);
    });

    it('should remove "Unknown deals damage"', () => {
      const input = 'A trap is sprung!\nUnknown deals damage\nYou take 5 piercing damage.';
      const expected = 'A trap is sprung!\nYou take 5 piercing damage.';
      expect(sanitizeDMText(input)).toBe(expected);
    });

    it('should be case-insensitive when removing system lines', () => {
      const input = 'COMBAT HAS BEGUN! INITIATIVE ORDER ESTABLISHED.\nUNKNOWN DEALS DAMAGE';
      expect(sanitizeDMText(input)).toBe('');
    });

    it('should handle inline repeated sequences', () => {
      const input = 'Combat has begun! Initiative order established. Combat has begun! Initiative order established. Get ready!';
      const expected = 'Get ready!';
      expect(sanitizeDMText(input)).toBe(expected);
    });

    it('should collapse consecutive blank lines to at most one blank line', () => {
      const input = 'Line 1\n\n\nLine 2';
      const expected = 'Line 1\n\nLine 2';
      expect(sanitizeDMText(input)).toBe(expected);
    });

    it('should trim the final result', () => {
      const input = '\n   Text with spaces   \n\n';
      const expected = 'Text with spaces';
      expect(sanitizeDMText(input)).toBe(expected);
    });

    it('should return empty string for null/undefined/empty input', () => {
      expect(sanitizeDMText(null)).toBe('');
      expect(sanitizeDMText(undefined)).toBe('');
      expect(sanitizeDMText('')).toBe('');
    });

    it('should remove complex mixed system lines and preserve non-system whitespace', () => {
      const input = `
        The encounter begins.

        Combat has begun! Initiative order established.
        Unknown deals damage

        The dragon breathes fire!

        Unknown deals damage
      `;
      // The current implementation preserves indentation and collapses blank lines
      const result = sanitizeDMText(input);
      expect(result).toContain('The encounter begins.');
      expect(result).toContain('The dragon breathes fire!');
      expect(result).not.toContain('Combat has begun!');
      expect(result).not.toContain('Unknown deals damage');
    });
  });
});
