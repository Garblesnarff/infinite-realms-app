import { describe, it, expect } from 'vitest';

import { slugify, ensureSlugFormat } from '../slug';

describe('slug utilities', () => {
  describe('slugify', () => {
    it('should convert simple strings to slugs', () => {
      expect(slugify('Hello World')).toBe('hello-world');
    });

    it('should handle special characters and accents', () => {
      expect(slugify('Héllö Wörld!')).toBe('hello-world');
    });

    it('should handle multiple spaces and dashes', () => {
      expect(slugify('hello   world---test')).toBe('hello-world-test');
    });

    it('should trim leading and trailing spaces/dashes', () => {
      expect(slugify('  -hello world-  ')).toBe('hello-world');
    });

    it('should handle non-alphanumeric characters', () => {
      expect(slugify('hello@world#2024')).toBe('helloworld2024');
      expect(slugify('hello world (test)')).toBe('hello-world-test');
    });

    it('should handle empty or whitespace-only strings', () => {
      expect(slugify('')).toBe('');
      expect(slugify('   ')).toBe('');
    });
  });

  describe('ensureSlugFormat', () => {
    it('should be an alias for slugify', () => {
      const input = 'Test String';
      expect(ensureSlugFormat(input)).toBe(slugify(input));
    });
  });
});
