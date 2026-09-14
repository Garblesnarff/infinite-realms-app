/* eslint-disable max-lines */
export type ModelNarrationHint = {
  type?: string;
  text?: string | null;
  character?: string | null;
  voice_category?: string | null;
};

export type DerivedNarrationSegment = {
  type: 'dm' | 'character' | 'transition';
  text: string;
  character: string | null;
  voice_category: string | null;
};

const ENGINE_LINE = /^[ \t]*⚙(?:️)?[ \t]*Engine:[^\r\n]*(?:\r?\n|$)/gim;
const ASSET_PREFIX = '[ASSET:';
const SINGLE_QUOTE_OPEN_PREV = /[\s([{—–]/;
const SINGLE_QUOTE_CLOSE_NEXT = /[\s.,;:!?…)\]}]/;

export const normalizeNarrationWhitespace = (value: string): string =>
  value.replace(/\s+/g, ' ').trim();

export const stripEngineGeneratedLines = (content: string): string =>
  content.replace(new RegExp(ENGINE_LINE.source, ENGINE_LINE.flags), '').replace(/\n{3,}/g, '\n\n');

const humanizeAssetKey = (key: string): string =>
  key
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const isSubstringOf = (haystack: string, needle: string): boolean => {
  const trimmed = needle.trim();
  if (!trimmed) return false;
  if (haystack.includes(trimmed)) return true;
  const normalizedHaystack = normalizeNarrationWhitespace(haystack);
  const normalizedNeedle = normalizeNarrationWhitespace(trimmed);
  return normalizedNeedle.length > 0 && normalizedHaystack.includes(normalizedNeedle);
};

const quoteFingerprint = (value: string): string =>
  normalizeNarrationWhitespace(value)
    .replace(/["“”]/g, '')
    .replace(/[.,;:!?…]+/g, '')
    .trim()
    .toLowerCase();

const textsAlign = (left: string, right: string): boolean => {
  if (isSubstringOf(left, right) || isSubstringOf(right, left)) return true;
  const leftPrint = quoteFingerprint(left);
  const rightPrint = quoteFingerprint(right);
  return (
    leftPrint.length > 0 &&
    rightPrint.length > 0 &&
    (leftPrint.includes(rightPrint) || rightPrint.includes(leftPrint))
  );
};

const matchingHint = (quote: string, hints: ModelNarrationHint[]): ModelNarrationHint | undefined =>
  hints.find((hint) => {
    if (hint.type === 'dm' || hint.type === 'transition') return false;
    const hintText = typeof hint.text === 'string' ? hint.text : '';
    return Boolean(hintText.trim()) && textsAlign(quote, hintText);
  });

const mentionedHint = (
  preceding: string,
  hints: ModelNarrationHint[],
): ModelNarrationHint | undefined => {
  const paragraph = preceding.split(/\n{2,}/).pop() ?? preceding;
  const lower = paragraph.toLowerCase();
  return [...hints].reverse().find((hint) => {
    const name = hint.character?.trim();
    return Boolean(name) && lower.includes((name ?? '').toLowerCase());
  });
};

const isSingleQuoteOpen = (source: string, index: number): boolean => {
  if (source[index] !== "'") return false;
  if (index === 0) return true;
  return SINGLE_QUOTE_OPEN_PREV.test(source[index - 1] ?? '');
};

const isSingleQuoteClose = (source: string, index: number): boolean => {
  if (source[index] !== "'") return false;
  if (index === source.length - 1) return true;
  return SINGLE_QUOTE_CLOSE_NEXT.test(source[index + 1] ?? '');
};

type SourceToken =
  | { kind: 'asset'; raw: string; inner: string }
  | { kind: 'quote'; raw: string }
  | { kind: 'prose'; raw: string };

const tokenizeSource = (source: string): SourceToken[] => {
  const tokens: SourceToken[] = [];
  let index = 0;
  let proseStart = 0;

  const flushProse = (end: number): void => {
    if (end > proseStart) {
      tokens.push({ kind: 'prose', raw: source.slice(proseStart, end) });
    }
  };

  while (index < source.length) {
    if (source.startsWith(ASSET_PREFIX, index)) {
      const close = source.indexOf(']', index);
      if (close !== -1) {
        flushProse(index);
        tokens.push({
          kind: 'asset',
          raw: source.slice(index, close + 1),
          inner: source.slice(index + ASSET_PREFIX.length, close),
        });
        index = close + 1;
        proseStart = index;
        continue;
      }
    }

    const char = source[index];
    if (char === '"' || char === '“') {
      let close = index + 1;
      while (close < source.length && source[close] !== '"' && source[close] !== '”') {
        close += 1;
      }
      if (close < source.length) {
        flushProse(index);
        tokens.push({ kind: 'quote', raw: source.slice(index, close + 1) });
        index = close + 1;
        proseStart = index;
        continue;
      }
    }

    if (isSingleQuoteOpen(source, index)) {
      let close = index + 1;
      while (close < source.length && !isSingleQuoteClose(source, close)) {
        close += 1;
      }
      if (close < source.length && isSingleQuoteClose(source, close)) {
        flushProse(index);
        tokens.push({ kind: 'quote', raw: source.slice(index, close + 1) });
        index = close + 1;
        proseStart = index;
        continue;
      }
    }

    index += 1;
  }

  flushProse(source.length);
  return tokens;
};

const coverageSource = (rawText: string): string =>
  normalizeNarrationWhitespace(
    stripEngineGeneratedLines(rawText).replace(/\[ASSET:[^\]]+\]/gi, ''),
  );

export function withCoverageFallback(
  rawText: string,
  segments: DerivedNarrationSegment[],
): DerivedNarrationSegment[] {
  const expected = coverageSource(rawText);
  const actual = normalizeNarrationWhitespace(segments.map((segment) => segment.text).join(''));
  if (actual === expected) {
    return segments;
  }

  console.warn('NARRATION_SEGMENTS_COVERAGE_MISMATCH', {
    expectedLength: expected.length,
    actualLength: actual.length,
  });
  return expected
    ? [{ type: 'dm', text: expected, character: null, voice_category: 'narrator' }]
    : [];
}

const pushSegment = (
  segments: DerivedNarrationSegment[],
  type: 'dm' | 'character',
  text: string,
  character: string | null,
  voiceCategory: string | null,
): void => {
  if (!text) return;
  segments.push({
    type,
    text,
    character,
    voice_category: voiceCategory,
  });
};

/**
 * Build authoritative TTS segments from the message text.
 * Model segments are attribution hints only.
 */
export function deriveNarrationSegments(
  rawText: string,
  modelHints: ModelNarrationHint[] = [],
  canonicalizeCategory?: (category: string) => string | undefined,
): DerivedNarrationSegment[] {
  const usableHints: ModelNarrationHint[] = [];
  for (const hint of modelHints) {
    const hintText = typeof hint.text === 'string' ? hint.text : '';
    if (!hintText.trim()) continue;
    if (!textsAlign(rawText, hintText)) {
      console.warn('NARRATION_SEGMENT_NOT_IN_TEXT', { text: hintText });
      continue;
    }
    const rawCategory = typeof hint.voice_category === 'string' ? hint.voice_category : null;
    usableHints.push({
      ...hint,
      voice_category: rawCategory ? (canonicalizeCategory?.(rawCategory) ?? null) : null,
    });
  }

  const source = stripEngineGeneratedLines(rawText);
  const segments: DerivedNarrationSegment[] = [];
  let lastNpc: { name: string; voiceCategory: string | null } | null = null;
  let preceding = '';

  for (const token of tokenizeSource(source)) {
    if (token.kind === 'prose') {
      pushSegment(segments, 'dm', token.raw, null, 'narrator');
      preceding += token.raw;
      continue;
    }

    if (token.kind === 'asset') {
      const [assetType, ...keyParts] = token.inner.split(':');
      const key = keyParts.join(':');
      if (assetType?.toLowerCase() === 'npc' && key) {
        lastNpc = { name: humanizeAssetKey(key), voiceCategory: null };
      }
      continue;
    }

    const quoted = token.raw;
    const hint = matchingHint(quoted, usableHints) || mentionedHint(preceding, usableHints);
    const speakerName = hint?.character?.trim() || lastNpc?.name || null;
    const voiceCategory =
      (typeof hint?.voice_category === 'string' && hint.voice_category) ||
      lastNpc?.voiceCategory ||
      null;
    if (speakerName) {
      pushSegment(segments, 'character', quoted, speakerName, voiceCategory);
    } else {
      pushSegment(segments, 'dm', quoted, null, 'narrator');
    }
    preceding += quoted;
  }

  const voiced = segments
    .map((segment) => ({
      ...segment,
      text: segment.text.replace(/\[ASSET:[^\]]+\]/gi, ''),
    }))
    .filter((segment) => segment.text.length > 0);

  if (voiced.length === 0) {
    const fallback = source.replace(/\[ASSET:[^\]]+\]/gi, '');
    return withCoverageFallback(
      rawText,
      fallback ? [{ type: 'dm', text: fallback, character: null, voice_category: 'narrator' }] : [],
    );
  }

  return withCoverageFallback(rawText, mergeAdjacentSpeakers(voiced));
}

const speakerIdentity = (segment: DerivedNarrationSegment): string => {
  if (segment.type === 'dm' || segment.type === 'transition' || !segment.character) {
    return 'narrator';
  }
  return segment.character.trim().toLowerCase();
};

const mergeAdjacentSpeakers = (segments: DerivedNarrationSegment[]): DerivedNarrationSegment[] => {
  const merged: DerivedNarrationSegment[] = [];
  for (const segment of segments) {
    const last = merged[merged.length - 1];
    if (last && speakerIdentity(last) === speakerIdentity(segment) && last.type === segment.type) {
      last.text += segment.text;
      continue;
    }
    merged.push({ ...segment });
  }
  return merged;
};
