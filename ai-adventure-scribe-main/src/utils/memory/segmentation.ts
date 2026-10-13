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
import { stripAssetTags } from '@/lib/utils';
import { stripEngineGeneratedLines } from '@/utils/engine-lines';
import { cleanupPlainNarrativeText } from '@/utils/narrative-text-cleanup';
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
 * Matches the output grammar of formatDiceRoll() in
 * features/game-session/components/chat/message-list/utils/dice-roll-formatter.ts:
 *   "Stealth Check: 15 (nat 13+2) success"
 *   "Longsword attack: 22 (nat 20+2) [ADV] hit CRITICAL HIT!"
 *   "Perception check: 8 (nat 6+2) fail"
 *   "Perception check: 14 (nat 12+2) (no DC)"
 *   "Shortbow attack: 1 miss Critical Miss"
 *   "Stealth check: pending"
 * (Legacy rows may also carry "vs DC 13"/"vs AC 10" and ✓/✗ glyphs.)
 *
 * Only fragments the producer actually emits are removed, and only in the
 * structural position the producer puts them (a "<description>: <total>" roll
 * row, inline or on its own line). Bare outcome words in ordinary prose
 * ("fail", "success", "hit", "miss", "critical hit") are never touched (#30).
 */
// Fragments only the producer emits — never ordinary prose.
const PRODUCER_FRAG =
  /(?:\s*\(nat\s+\d+[+-]?\d*\)|\s*\[(?:ADV|DIS)\]|\s+vs\s+(?:DC|AC)\s+\d+|\s*[✓✗]|\s+\(no\s+DC\))/;
// The producer's critical trailer, case-sensitive (prose "critical hit" survives).
const CRIT_FRAG = /(?:\s+CRITICAL\s+HIT!?|\s+Critical\s+Miss)/;
// The producer's outcome word, case-sensitive (the producer emits lowercase).
// Stripped non-terminally only after a distinctive producer fragment proves the
// row is a roll; a bare outcome word is stripped only in the producer's
// terminal position (end of row, sentence punctuation, or before the trailer).
const OUTCOME_ANY = /\s+(?:success|fail|hit|miss)\b/;
const OUTCOME_TERM =
  /\s+(?:success|fail|hit|miss)\b(?=\s*(?:[.!?;:]|$|\n)|\s+(?:CRITICAL\s+HIT!?|Critical\s+Miss))/;

// A "<description>: <total>" roll row followed by the producer's fragments.
// The (?<!\d) guard keeps "12:30"-style times from matching as roll rows.
const ROLL_ROW_RE = new RegExp(
  `([^:\\n]{1,200}?)(?<!\\d):\\s*(-?\\d+)` +
    `((?:${PRODUCER_FRAG.source}+(?:${OUTCOME_ANY.source})?(?:${CRIT_FRAG.source})?` +
    `|${OUTCOME_TERM.source}(?:${CRIT_FRAG.source})?))`,
  'g',
);

// The producer's pending row: "<description>: pending".
const PENDING_ROW_RE = /([^:\n]{1,200}?)(?<!\d):\s*pending(?=\s*(?:[.!?;:]|$|\n))/g;

export const stripRollScaffolding = (content: string): string => {
  if (!content) return content;

  return content.replace(ROLL_ROW_RE, '$1: $2').replace(PENDING_ROW_RE, '$1');
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

  // Strip all scaffolding before segmentation to prevent transient content
  // (code blocks, ROLL_REQUESTS_V1, option menus, VISUAL PROMPT, separators, asset tags)
  // from being classified as memories
  const cleanedContent = sanitizeForMemoryExtraction(content);

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

  // SentenceSegmenter.splitLongSegmentAtClauses() (invoked internally by
  // optimizeSegmentLengths for long sentences) splits at clause boundaries like
  // ", and " / ", which " for audio-pacing purposes - that's fine for voice
  // playback, but for memory extraction it can leave the tail of a sentence as
  // its own "segment" (e.g. "and the way the Reservation Book changes when
  // unobserved."), which then gets classified and saved as a standalone,
  // out-of-context memory fragment. A segment starting with a lowercase letter
  // is never a genuine new sentence, so merge it back into the previous one.
  const mergedSegments: string[] = [];
  for (const segment of optimizedSegments) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    if (mergedSegments.length > 0 && /^[a-z]/.test(trimmed)) {
      mergedSegments[mergedSegments.length - 1] =
        `${mergedSegments[mergedSegments.length - 1]} ${trimmed}`;
    } else {
      mergedSegments.push(trimmed);
    }
  }

  return mergedSegments.map((s) => s.trim()).filter((s) => s.length > 0);
};

/**
 * Strip A./B./C. player option menu lines and parenthetical helper phrases.
 * Option menus are transient UX scaffolding, not durable narrative facts.
 *
 * Matches lines like:
 *   "A. **Approach cautiously**, move through the shadows."
 *   "B. **Charge forward**, yelling a battle cry."
 *   "(Request a Stealth check)"
 */
export const stripOptionMenus = (content: string): string =>
  content
    // Remove lines that begin with a single A/B/C letter-dot option prefix
    .replace(/^[A-Ca-c]\.\s+\**.*$/gm, '')
    // Remove lines that begin with a numbered option prefix (1., 2., 3.)
    .replace(/^\d+\.\s+\*\*[^*]+\*\*.*$/gm, '')
    // Remove parenthetical helper phrases like (Request a Stealth check) or (Request an Arcana check...)
    .replace(/\(Request\s+a[^)]*check[^)]*\)/gi, '')
    // Collapse excessive blank lines left behind
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/**
 * Strip VISUAL PROMPT directives (fenced blocks and inline markers).
 * Uses the same patterns as visualPrompt.ts to guarantee alignment.
 */
export const stripVisualPromptBlocks = (content: string): string =>
  content
    // Fenced: ```VISUAL PROMPT\n...\n``` (with flexible separators/spacing)
    .replace(/```\s*VISUAL[_\s-]*PROMPT\s*\n[\s\S]*?```/gi, '')
    // Inline: VISUAL PROMPT: ... (to end of line, with flexible separators)
    .replace(/^[ \t]*VISUAL[_ -]*PROMPT\s*:?[ \t]*.*$/gim, '')
    // Collapse excessive blank lines left behind
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/**
 * Strip standalone separator lines (--- or ****).
 * These are formatting-only artifacts with no narrative content.
 */
export const stripSeparatorLines = (content: string): string =>
  content
    .replace(/^[-*]{3,}\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

// Keep the memory pipeline and player-facing displays on the same one-pass
// de-tagger. Asset tags are directives, not prose, and must not add derived
// names or otherwise mutate the surrounding narration.
export { stripAssetTags };

const finalizePlainText = (content: string): string => cleanupPlainNarrativeText(content);

/**
 * Full sanitization pass for memory extraction inputs.
 * Chains all scaffolding-stripping passes so only durable narrative reaches
 * the classifier or the LLM extraction prompt.
 *
 * Strips: code blocks, ROLL_REQUESTS_V1, roll scaffolding,
 *         VISUAL PROMPT blocks, A/B/C option menus, separator lines,
 *         [ASSET:*] tags, and engine-generated transcript lines.
 */
/**
 * Strip verbalized AI brainstorming/sampling artifacts.
 * These are internal reasoning that sometimes leaks into output.
 */
export const stripBrainstorming = (content: string): string =>
  content
    // Remove numbered scenario lists with probabilities: "1. Scenario (prob: 0.85)"
    .replace(/^\d+\.\s+[^(]+\(prob:\s*0\.\d+\)[^\n]*\n?/gm, '')
    // Remove "Selected:" or "Chosen:" lines
    .replace(
      /^(?:Selected|Chosen|Final selection|I'll go with|Internal brainstorming):[^\n]*\n?/gim,
      '',
    )
    // Remove XML-like tags from verbalized sampling
    .replace(/<\/?(?:brainstorming|narrative|options)>/gi, '')
    .trim();

export const sanitizeForMemoryExtraction = (content: string): string => {
  let text = stripEngineGeneratedLines(content);
  text = stripCodeBlocks(text); // existing: ROLL_REQUESTS_V1, code blocks, roll markers
  text = stripVisualPromptBlocks(text);
  text = stripOptionMenus(text);
  text = stripSeparatorLines(text);
  text = stripAssetTags(text);
  text = stripBrainstorming(text);
  return finalizePlainText(text);
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
