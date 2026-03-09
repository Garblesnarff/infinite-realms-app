/**
 * Shared cleanup helpers for player-visible narrative text and plain-text memory inputs.
 * These normalize punctuation/spacing artifacts left behind by markdown and asset-tag stripping.
 */

export const normalizeNarrativeSpacing = (content: string): string =>
  content
    // Trim padding around line breaks first
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    // Remove spaces before punctuation and curly closing quotes
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s+([”’])/g, '$1')
    // Remove spaces immediately after curly opening quotes/parens
    .replace(/([“‘(])\s+/g, '$1')
    // Keep em-dash/appositive phrases tight after tag stripping
    .replace(/([—–-])\s+(\*{1,2})/g, '$1$2')
    .replace(/([—–-])\s+([A-Z“'(])/g, '$1$2')
    // Collapse repeated spacing created by removals
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export const stripMarkdownEmphasis = (content: string): string =>
  content
    .replace(/\*\*([^*\n]+?)\*\*/g, '$1')
    .replace(/\*([^*\n]+?)\*/g, '$1')
    .replace(/\*/g, '');

export const cleanupPlainNarrativeText = (content: string): string =>
  normalizeNarrativeSpacing(stripMarkdownEmphasis(content));
