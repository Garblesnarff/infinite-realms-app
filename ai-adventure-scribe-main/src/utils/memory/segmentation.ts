/**
 * Options for content segmentation
 */
interface SegmentationOptions {
  minLength: number;
  maxLength: number;
  preserveQuotes: boolean;
}

const DEFAULT_OPTIONS: SegmentationOptions = {
  minLength: 20,
  maxLength: 200,
  preserveQuotes: true,
};

// Import the enhanced sentence segmenter
import { SentenceSegmenter } from '@/utils/sentence-segmenter';

/**
 * Strip code blocks and JSON-like structures from content before segmentation.
 * This prevents technical content (like ROLL_REQUESTS_V1 JSON) from being
 * classified as memories.
 * @param content - The text content to clean
 * @returns Content with code blocks removed
 */
export const stripCodeBlocks = (content: string): string => {
  const withoutCode = content
    // Remove fenced code blocks with optional language identifier (```json, ```ROLL_REQUESTS_V1, etc.)
    // This catches ROLL_REQUESTS_V1 blocks since they're always in triple backticks
    .replace(/```[a-zA-Z0-9_]*[\s\S]*?```/g, '')
    // Remove inline code (`...`) - but not empty backticks
    .replace(/`[^`]+`/g, '')
    // Clean up any leftover ROLL_REQUESTS labels that might be outside code blocks
    .replace(/ROLL_REQUESTS_V1/g, '')
    // Remove multiple consecutive newlines (cleanup after removals)
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return stripRollScaffolding(withoutCode);
};

/**
 * Strip dice roll scaffolding text produced by formatDiceRoll() before segmentation.
 * These patterns are transient game mechanics output, not durable memories.
 *
 * Matches the output format of formatDiceRoll() in MessageListContainer.tsx:
 *   "Stealth Check: 15 (nat 13+2) vs DC 13 ✓"
 *   "Attack Roll: 22 (nat 18+4) [ADV] ✓ CRITICAL HIT!"
 *   "Perception Check: 8 (nat 6+2) ✗"
 */
export const stripRollScaffolding = (content: string): string => {
  return (
    content
      // Remove success/failure markers (used exclusively by formatDiceRoll)
      .replace(/[✓✗]/g, '')
      // Remove natural roll notation: (nat 13+2), (nat 18-1), (nat 20)
      .replace(/\(nat\s+\d+[+-]?\d*\)/g, '')
      // Remove advantage/disadvantage tags
      .replace(/\[(?:ADV|DIS)\]/g, '')
      // Remove vs DC/AC comparisons
      .replace(/\bvs\s+(?:DC|AC)\s+\d+/gi, '')
      // Remove critical hit/miss markers
      .replace(/\bCRITICAL\s+HIT!?/gi, '')
      .replace(/\bCritical\s+Miss\b/gi, '')
      // Normalize leftover whitespace
      .replace(/\s{2,}/g, ' ')
      .trim()
  );
};

/**
 * Splits content into coherent segments based on natural language boundaries
 * Now uses improved sentence boundary detection to prevent mid-word splits
 * @param content - The text content to split
 * @param options - Optional configuration for segmentation
 */
export const splitIntoSegments = (
  content: string,
  options: Partial<SegmentationOptions> = {},
): string[] => {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Strip code blocks and JSON before segmentation to prevent
  // technical content from being classified as memories
  const cleanedContent = stripCodeBlocks(content);

  // Use enhanced sentence splitting instead of basic regex
  const sentences = SentenceSegmenter.splitIntoSentences(cleanedContent);

  // Filter by minimum length
  const validSentences = sentences.filter((sentence) => sentence.trim().length >= opts.minLength);

  // Use the SentenceSegmenter's optimization for proper segment lengths
  const optimizedSegments = SentenceSegmenter.optimizeSegmentLengths(
    validSentences,
    opts.minLength,
    opts.maxLength,
  );

  return optimizedSegments.map((s) => s.trim()).filter((s) => s.length > 0);
};

/**
 * Checks if a segment contains quoted speech
 */
export const containsQuotedSpeech = (segment: string): boolean => {
  return /"[^"]+"/g.test(segment);
};

/**
 * Extracts named entities from a segment
 */
export const extractNamedEntities = (segment: string): string[] => {
  const matches = segment.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/g);
  return matches || [];
};
