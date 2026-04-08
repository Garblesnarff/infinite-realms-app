 
import { describe, it, expect } from 'vitest';

import {
  normalizeNarrativeSpacing,
  stripMarkdownEmphasis,
  cleanupPlainNarrativeText,
} from '../narrative-text-cleanup';

describe('narrative-text-cleanup', () => {
  describe('normalizeNarrativeSpacing', () => {
    it('should trim padding around line breaks', () => {
      const input = 'Line 1  \n  Line 2';
      expect(normalizeNarrativeSpacing(input)).toBe('Line 1\nLine 2');
    });

    it('should remove spaces before standard punctuation', () => {
      const input = 'Hello , world . How are you ? !';
      expect(normalizeNarrativeSpacing(input)).toBe('Hello, world. How are you?!');
    });

    it('should remove spaces before colon and semicolon', () => {
      const input = 'Items : bread ; milk';
      expect(normalizeNarrativeSpacing(input)).toBe('Items: bread; milk');
    });

    it('should remove spaces before curly closing quotes', () => {
      const input = '“He said ” and then ‘she thought ’';
      // Note: normalizeNarrativeSpacing handles ” and ’
      expect(normalizeNarrativeSpacing(input)).toBe('“He said” and then ‘she thought’');
    });

    it('should remove spaces after curly opening quotes and parentheses', ( ) => {
      const input = '“ Hello ” , ( parenthesis )';
      expect(normalizeNarrativeSpacing(input)).toBe('“Hello”, (parenthesis)');
    });

    it('should handle em-dash and appositive phrases', () => {
      // .replace(/([—–-])\s+(\*{1,2})/g, '$1$2')
      // .replace(/([—–-])\s+([A-Z“'(])/g, '$1$2')
      const dashInput = 'word —  **bold**';
      expect(normalizeNarrativeSpacing(dashInput)).toBe('word —**bold**');

      const appositiveInput = 'Wait — “Stop!”';
      expect(normalizeNarrativeSpacing(appositiveInput)).toBe('Wait —“Stop!”');

      const capitalizedInput = 'Next — Then we go.';
      expect(normalizeNarrativeSpacing(capitalizedInput)).toBe('Next —Then we go.');
    });

    it('should collapse repeated spaces and tabs', () => {
      const input = 'Many    spaces\tand\t\ttabs';
      expect(normalizeNarrativeSpacing(input)).toBe('Many spaces and tabs');
    });

    it('should collapse excessive newlines to exactly two', () => {
      const input = 'Line 1\n\n\n\nLine 2';
      expect(normalizeNarrativeSpacing(input)).toBe('Line 1\n\nLine 2');
    });

    it('should trim the entire string', () => {
      const input = '   Hello World   ';
      expect(normalizeNarrativeSpacing(input)).toBe('Hello World');
    });
  });

  describe('stripMarkdownEmphasis', () => {
    it('should remove bold asterisks', () => {
      const input = 'This is **bold** text';
      expect(stripMarkdownEmphasis(input)).toBe('This is bold text');
    });

    it('should remove italic asterisks', () => {
      const input = 'This is *italic* text';
      expect(stripMarkdownEmphasis(input)).toBe('This is italic text');
    });

    it('should remove stray asterisks', () => {
      const input = 'Stray * asterisk';
      expect(stripMarkdownEmphasis(input)).toBe('Stray  asterisk');
    });

    it('should handle nested or complex emphasis', () => {
      const input = '***Strong italic*** and **bold**';
      // stripMarkdownEmphasis replaces **...** then *...* then *
      // ***Strong italic*** -> ** followed by *Strong italic* followed by **?
      // Actually it's simpler:
      // .replace(/\*\*([^*\n]+?)\*\*/g, '$1') -> *Strong italic* and bold
      // .replace(/\*([^*\n]+?)\*/g, '$1')     -> Strong italic and bold
      // .replace(/\*/g, '')                   -> Strong italic and bold
      expect(stripMarkdownEmphasis(input)).toBe('Strong italic and bold');
    });
  });

  describe('cleanupPlainNarrativeText', () => {
    it('should perform both markdown stripping and spacing normalization', () => {
      const input = '  **He said** , “ Hello *world* ! ”  \n\n\n  ';
      // 1. stripMarkdownEmphasis: '  He said , “ Hello world ! ”  \n\n\n  '
      // 2. normalizeNarrativeSpacing:
      // - trim Padding: 'He said , “ Hello world ! ”\n\n\n'
      // - spaces before punctuation: 'He said, “ Hello world! ”\n\n\n'
      // - spaces before closing quotes: 'He said, “ Hello world!”\n\n\n'
      // - spaces after opening quotes: 'He said, “Hello world!”\n\n\n'
      // - collapse spaces: 'He said, “Hello world!”\n\n\n'
      // - collapse newlines: 'He said, “Hello world!”\n\n'
      // - trim: 'He said, “Hello world!”'
      expect(cleanupPlainNarrativeText(input)).toBe('He said, “Hello world!”');
    });
  });
});
