import { describe, it, expect } from 'vitest';

import {
  generateExcerpt,
  stripMarkdown,
  countWords,
  estimateReadingTime,
} from '../text-helpers';

describe('text-helpers', () => {
  describe('generateExcerpt', () => {
    it('should return an empty string for empty input', () => {
      expect(generateExcerpt('')).toBe('');
    });

    it('should return the original text if it is shorter than maxLength', () => {
      const text = 'Short text';
      expect(generateExcerpt(text)).toBe(text);
    });

    it('should truncate and add ellipsis for long text', () => {
      const text = 'This is a very long piece of text that definitely needs to be truncated for the excerpt.';
      const result = generateExcerpt(text, 20);
      expect(result).toBe('This is a very long...');
      expect(result.length).toBeLessThan(text.length);
    });

    it('should truncate at maxLength if no suitable space is found', () => {
      const text = 'Supercalifragilisticexpialidocious';
      const result = generateExcerpt(text, 10);
      expect(result).toBe('Supercalif...');
    });

    it('should clean markdown-like characters and extra whitespace', () => {
      const text = '# Title\n\nThis is **bold** and *italic*.\n\n[Link](url)';
      // generateExcerpt removes [ ] # * _ ` ~ >
      const result = generateExcerpt(text);
      expect(result).not.toContain('#');
      expect(result).not.toContain('*');
      expect(result).not.toContain('[');
      expect(result).toBe('Title This is bold and italic. Link(url)');
    });
  });

  describe('stripMarkdown', () => {
    it('should remove headers', () => {
      expect(stripMarkdown('# H1\n## H2\n### H3')).toBe('H1 H2 H3');
    });

    it('should remove bold and italic', () => {
      expect(stripMarkdown('**Bold** and *Italic* and _Underscore_')).toBe('Bold and Italic and Underscore');
    });

    it('should remove strikethrough', () => {
      expect(stripMarkdown('~~Strikethrough~~')).toBe('Strikethrough');
    });

    it('should remove inline code', () => {
      expect(stripMarkdown('`code`')).toBe('code');
    });

    it('should handle links', () => {
      expect(stripMarkdown('[Link Text](https://example.com)')).toBe('Link Text');
    });

    it('should remove images completely', () => {
      expect(stripMarkdown('![Alt Text](img.png)')).toBe('');
      expect(stripMarkdown('Text with ![Alt](img.png) image')).toBe('Text with image');
    });

    it('should remove blockquotes', () => {
      expect(stripMarkdown('> Quote')).toBe('Quote');
    });

    it('should remove list markers', () => {
      expect(stripMarkdown('- Item 1\n* Item 2\n+ Item 3')).toBe('Item 1 Item 2 Item 3');
      expect(stripMarkdown('1. First\n2. Second')).toBe('First Second');
    });

    it('should normalize whitespace', () => {
      expect(stripMarkdown('Multiple  spaces\nand\nnewlines')).toBe('Multiple spaces and newlines');
    });
  });

  describe('countWords', () => {
    it('should return 0 for empty string', () => {
      expect(countWords('')).toBe(0);
    });

    it('should count words correctly', () => {
      expect(countWords('One two three')).toBe(3);
    });

    it('should ignore extra whitespace', () => {
      expect(countWords('  One   two\nthree  ')).toBe(3);
    });
  });

  describe('estimateReadingTime', () => {
    it('should return 1 for short text', () => {
      expect(estimateReadingTime('Just a few words')).toBe(1);
    });

    it('should estimate correctly for long text', () => {
      const longText = Array(400).fill('word').join(' ');
      expect(estimateReadingTime(longText, 200)).toBe(2);
    });

    it('should strip markdown before counting words', () => {
      const markdownText = '# Title\n\n' + Array(200).fill('**word**').join(' ');
      // The words are "Title" + 200 "word"s = 201 words.
      // 201 / 200 = 1.005, ceil is 2.
      expect(estimateReadingTime(markdownText, 200)).toBe(2);
    });
  });
});
