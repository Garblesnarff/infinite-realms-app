/**
 * Utility functions for parsing DM message options
 *
 * This module handles the extraction of numbered action options from DM messages,
 * separating narrative content from interactive choices.
 */

export interface ActionOption {
  id: string;
  number: number;
  letter?: string; // For A, B, C format
  text: string;
  fullText: string; // Original text with formatting
}

export interface ParsedMessage {
  content: string; // Narrative content without options
  options: ActionOption[];
  hasOptions: boolean;
}

import logger from '@/lib/logger';
import { cleanupPlainNarrativeText } from '@/utils/narrative-text-cleanup';
import { normalizeAssetTagsInContent } from '@/utils/normalize-asset-tags';

const TRAILING_JOINER_PATTERN =
  /\b(?:a|an|the|to|of|for|with|into|onto|from|under|over|through|your|their|my)\s*$/i;
const MAX_ACTION_OPTION_NUMBER = 100;

function parseActionOptionNumber(value: string): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 1 && number <= MAX_ACTION_OPTION_NUMBER
    ? number
    : null;
}

function buildOptionSeparator(boldText: string, cleanDescription: string): string {
  if (!cleanDescription) {
    return '';
  }

  if (/^[—–(]/.test(cleanDescription)) {
    return '';
  }

  if (TRAILING_JOINER_PATTERN.test(boldText)) {
    return ' ';
  }

  return ', ';
}

function sanitizeOptionDisplayText(content: string): string {
  return cleanupPlainNarrativeText(
    normalizeAssetTagsInContent(content).replace(/\[ASSET:[^\]]+\]\s*/g, ' '),
  );
}

/**
 * Parses DM message content to extract numbered or lettered options
 * Supports formats like:
 * - "1. **Approach cautiously**, gathering information..."
 * - "A. **Attempt to charm**, using your bardic magic..."
 * - "B. **Unsheathe your rapier**, and prepare to defend..."
 */
export function parseMessageOptions(rawContent: string): ParsedMessage {
  if (!rawContent) {
    return {
      content: '',
      options: [],
      hasOptions: false,
    };
  }

  // Normalize "**A. Bold text**" format (letter inside bold block) → "A. **Bold text**"
  // so the primary regex can extract boldText and description cleanly.
  const messageContent = rawContent.replace(/^\*\*([A-C])\.\s+([^*\n]+)\*\*/gm, '$1. **$2**');

  // Regular expression to match both numbered and lettered options with bold formatting
  // Matches: 1. **Bold text**, description... OR A. **Bold text**...
  // Also handles AI format where letter is bolded: **A.** **Bold text**...
  const numberedRegex = /^(\d+)\.\s+\*\*([^*]+)\*\*([^]*?)(?=^\d+\.\s+\*\*|\n\s*$|$)/gm;
  const letteredRegex =
    /^(?:\*\*)?([A-Z])\.(?:\*\*)?\s+\*\*([^*]+)\*\*([^]*?)(?=^(?:\*\*)?[A-Z]\.(?:\*\*)?\s+\*\*|\n\s*$|$)/gm;

  // Fallback patterns for non-bold options (backward compatibility)
  const numberedFallbackRegex = /^(\d+)\.\s+([^]*?)(?=^\d+\.|\n\s*$|$)/gm;
  const letteredFallbackRegex =
    /^(?:\*\*)?([A-Z])\.(?:\*\*)?\s+([^]*?)(?=^(?:\*\*)?[A-Z]\.(?:\*\*)?|\n\s*$|$)/gm;

  const options: ActionOption[] = [];
  let lastIndex = 0;

  // Try numbered format first (1., 2., 3.)
  let match;
  numberedRegex.lastIndex = 0; // Reset regex
  while ((match = numberedRegex.exec(messageContent)) !== null) {
    const [_fullMatch, numberStr, boldText, description] = match;
    const number = parseActionOptionNumber(numberStr);
    if (number === null) continue;

    // Clean up the description text; don't add ", " before em-dashes or parentheticals
    const cleanDescription = description.replace(/^\s*,\s*/, '').trim();
    const sep = buildOptionSeparator(boldText, cleanDescription);
    const displayText = sanitizeOptionDisplayText(`${boldText}${sep}${cleanDescription}`);
    const fullOptionText = `**${boldText}**${sep}${cleanDescription}`;

    options.push({
      id: `option-${number}`,
      number,
      text: displayText,
      fullText: fullOptionText,
    });

    // Track where options start in the content
    if (options.length === 1) {
      lastIndex = match.index;
    }
  }

  // If no numbered options found, try lettered format (A., B., C.)
  if (options.length === 0) {
    letteredRegex.lastIndex = 0; // Reset regex
    while ((match = letteredRegex.exec(messageContent)) !== null) {
      const [_fullMatch, letterStr, boldText, description] = match;
      const letterCode = letterStr.charCodeAt(0) - 64; // A=1, B=2, C=3, etc.

      // Clean up the description text; don't add ", " before em-dashes or parentheticals
      const cleanDescription = description.replace(/^\s*,\s*/, '').trim();
      const sep = buildOptionSeparator(boldText, cleanDescription);
      const displayText = sanitizeOptionDisplayText(`${boldText}${sep}${cleanDescription}`);
      const fullOptionText = `**${boldText}**${sep}${cleanDescription}`;

      options.push({
        id: `option-${letterStr}`,
        number: letterCode,
        letter: letterStr,
        text: displayText,
        fullText: fullOptionText,
      });

      // Track where options start in the content
      if (options.length === 1) {
        lastIndex = match.index;
      }
    }
  }

  // Fallback: Try numbered options without bold formatting
  if (options.length === 0) {
    numberedFallbackRegex.lastIndex = 0;
    while ((match = numberedFallbackRegex.exec(messageContent)) !== null) {
      const [_fullMatch, numberStr, fullText] = match;
      const number = parseActionOptionNumber(numberStr);
      if (number === null) continue;

      options.push({
        id: `option-${number}`,
        number,
        text: sanitizeOptionDisplayText(fullText.trim()),
        fullText: fullText.trim(),
      });

      if (options.length === 1) {
        lastIndex = match.index;
      }
    }
  }

  // Fallback: Try lettered options without bold formatting
  if (options.length === 0) {
    letteredFallbackRegex.lastIndex = 0;
    while ((match = letteredFallbackRegex.exec(messageContent)) !== null) {
      const [_fullMatch, letterStr, fullText] = match;
      const letterCode = letterStr.charCodeAt(0) - 64;

      options.push({
        id: `option-${letterStr}`,
        number: letterCode,
        letter: letterStr,
        text: sanitizeOptionDisplayText(fullText.trim()),
        fullText: fullText.trim(),
      });

      if (options.length === 1) {
        lastIndex = match.index;
      }
    }
  }

  // Extract content before options (narrative only)
  let narrativeContent = messageContent;
  if (options.length > 0 && lastIndex > 0) {
    narrativeContent = messageContent.substring(0, lastIndex).trim();

    // Strip trailing AI formatting artifacts that appear between narrative and options:
    // "---" horizontal separators and "**What do you do?**" prompt headers.
    narrativeContent = narrativeContent.replace(/\s*\n\s*---\s*[\s\S]*$/, '').trim();
  }

  // Clean up narrative content - remove trailing sentences that might be cut off
  if (options.length > 0) {
    // Find the last complete sentence before options
    const sentences = narrativeContent.split(/(?<=[.!?])\s+/);
    const lastSentence = sentences[sentences.length - 1];

    // If last sentence doesn't end with punctuation, remove it
    // Allow for quotes/asterisks after punctuation (e.g., `."` or `.*` or `."*`)
    if (lastSentence && !lastSentence.match(/[.!?]["'*]*\s*$/)) {
      sentences.pop();
      narrativeContent = sentences.join(' ');
    }
  }

  return {
    content: narrativeContent.trim(),
    options,
    hasOptions: options.length > 0,
  };
}

/**
 * Extracts only the narrative content from a DM message (for TTS)
 * This ensures options are not read aloud
 */
export function extractNarrativeContent(messageContent: string): string {
  const parsed = parseMessageOptions(messageContent);
  return parsed.content;
}

/**
 * Formats an option for display in a button
 */
export function formatOptionForButton(option: ActionOption): string {
  const prefix = option.letter ? `${option.letter}.` : `${option.number}.`;
  return `${prefix} ${option.text}`;
}

const OBJECT_PREPOSITIONS = new Set([
  'about',
  'against',
  'around',
  'at',
  'by',
  'for',
  'from',
  'in',
  'inside',
  'into',
  'near',
  'of',
  'off',
  'on',
  'onto',
  'over',
  'through',
  'to',
  'toward',
  'under',
  'upon',
  'with',
  'without',
]);

const OBJECT_VERBS = new Set([
  'allow',
  'allows',
  'allowed',
  'ask',
  'asks',
  'asked',
  'catch',
  'catches',
  'caught',
  'defend',
  'defends',
  'defended',
  'find',
  'finds',
  'found',
  'follow',
  'follows',
  'followed',
  'force',
  'forces',
  'forced',
  'give',
  'gives',
  'gave',
  'guide',
  'guides',
  'guided',
  'hear',
  'hears',
  'heard',
  'help',
  'helps',
  'helped',
  'hit',
  'hits',
  'keep',
  'keeps',
  'kept',
  'knock',
  'knocks',
  'knocked',
  'leave',
  'leaves',
  'left',
  'let',
  'lets',
  'make',
  'makes',
  'made',
  'meet',
  'meets',
  'met',
  'notice',
  'notices',
  'noticed',
  'prevent',
  'prevents',
  'prevented',
  'protect',
  'protects',
  'protected',
  'push',
  'pushes',
  'pushed',
  'save',
  'saves',
  'saved',
  'see',
  'sees',
  'saw',
  'send',
  'sends',
  'sent',
  'show',
  'shows',
  'showed',
  'stop',
  'stops',
  'stopped',
  'take',
  'takes',
  'took',
  'tell',
  'tells',
  'told',
  'throw',
  'throws',
  'threw',
  'trust',
  'trusts',
  'trusted',
  'watch',
  'watches',
  'watched',
  'welcome',
  'welcomes',
  'welcomed',
]);

function isObjectPosition(text: string, offset: number): boolean {
  const precedingWord = text
    .slice(0, offset)
    .match(/[A-Za-z]+(?=\s*$)/)?.[0]
    .toLowerCase();

  return Boolean(
    precedingWord &&
    (OBJECT_PREPOSITIONS.has(precedingWord) ||
      precedingWord.endsWith('ing') ||
      OBJECT_VERBS.has(precedingWord)),
  );
}

function replaceYouPronoun(match: string, offset: number, source: string): string {
  if (isObjectPosition(source, offset)) {
    return match === 'You' ? 'Me' : 'me';
  }

  return 'I';
}

/**
 * Converts text from second person to first person perspective
 */
function convertToFirstPerson(text: string): string {
  let converted = text;

  // Convert common second-person phrases to first-person
  // Handle "your" -> "my" with case preservation
  converted = converted.replace(/\byour\b/gi, (match) => {
    return match === 'Your' ? 'My' : match === 'your' ? 'my' : match;
  });

  // Handle "you were" -> "I was" before the generic rule, so the verb agrees.
  converted = converted.replace(/\byou\s+were\b/gi, 'I was');
  converted = converted.replace(/\byou\s+weren't\b/gi, "I wasn't");
  converted = converted.replace(/\byou\s+aren't\b/gi, "I'm not");

  // Handle "you" -> "I" with case preservation and context awareness
  converted = converted.replace(/\byou\b(?!\s+are|\s+were|\s+aren't|'\w)/gi, replaceYouPronoun);

  // Handle "you are" -> "I am"
  converted = converted.replace(/\byou\s+are\b/gi, (match) => {
    return match.startsWith('You') ? 'I am' : 'I am';
  });

  // Handle "you're" -> "I'm"
  converted = converted.replace(/\byou're\b/gi, (match) => {
    return match === "You're" ? "I'm" : "I'm";
  });

  // Handle "you have" -> "I have"
  converted = converted.replace(/\byou\s+have\b/gi, (match) => {
    return match.startsWith('You') ? 'I have' : 'I have';
  });

  // Handle "you've" -> "I've"
  converted = converted.replace(/\byou've\b/gi, (match) => {
    return match === "You've" ? "I've" : "I've";
  });

  // Handle "you will" -> "I will"
  converted = converted.replace(/\byou\s+will\b/gi, (match) => {
    return match.startsWith('You') ? 'I will' : 'I will';
  });

  // Handle "you'll" -> "I'll"
  converted = converted.replace(/\byou'll\b/gi, (match) => {
    return match === "You'll" ? "I'll" : "I'll";
  });

  // Handle "yours" -> "mine". The \byour\b rule above cannot match this:
  // the trailing "s" is a word character, so the word boundary never lands.
  converted = converted.replace(/\byours\b/gi, (match) => {
    return match === 'Yours' ? 'Mine' : 'mine';
  });

  // Handle "yourself" -> "myself"
  converted = converted.replace(/\byourself\b/gi, (match) => {
    return match === 'Yourself' ? 'Myself' : 'myself';
  });

  // Handle remaining "you" patterns that weren't caught above
  converted = converted.replace(/\bdefend yourself\b/gi, 'defend myself');
  converted = converted.replace(/\byou\b/gi, replaceYouPronoun);

  return converted;
}

/**
 * Creates a player message from a selected option
 */
export function createPlayerMessageFromOption(option: ActionOption): string {
  // Remove numbering and formatting for the player's choice
  let cleaned = option.text.replace(/^\d+\.\s*/, '').trim();
  logger.debug('[parseMessageOptions] Original option text:', cleaned);

  // Convert from second person to first person
  cleaned = convertToFirstPerson(cleaned);
  logger.debug('[parseMessageOptions] Converted to first person:', cleaned);

  return cleaned;
}
