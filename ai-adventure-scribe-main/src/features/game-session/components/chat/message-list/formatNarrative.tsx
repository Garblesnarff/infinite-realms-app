/* eslint-disable max-lines */
import React from 'react';

import { sanitizeEmphasisDelimiters } from './sanitize-emphasis';

export { sanitizeEmphasisDelimiters };

const DIALOGUE_PATTERN = /^"[\s\S]*"$/;
const BULLET_PATTERN = /^[-•]/;

/**
 * Remove leaked verbalized sampling brainstorming patterns from AI response.
 * Safety filter to catch any internal reasoning that slips through.
 */
const cleanBrainstorming = (text: string): string => {
  let cleaned = text;

  // Remove numbered scenario lists with probabilities
  // Pattern: "1. Scenario description (prob: 0.XX)"
  cleaned = cleaned.replace(/^\d+\.\s+[^(]+\(prob:\s*0\.\d+\)[^\n]*\n?/gm, '');

  // Remove "Selected:" or "Chosen:" lines
  cleaned = cleaned.replace(
    /^(?:Selected|Chosen|Final selection|I'll go with|Internal brainstorming):[^\n]*\n?/gim,
    '',
  );

  // Remove any remaining XML-like tags from verbalized sampling
  cleaned = cleaned.replace(/<\/?(?:brainstorming|narrative|options)>/gi, '');

  return cleaned.trim();
};

const splitIntoSentences = (block: string): string[] => {
  const sentences: string[] = [];
  const regex = /[^.!?]+[.!?]+[""']?\s*/g;
  let match: RegExpExecArray | null;
  let lastMatchEnd = 0;

  while ((match = regex.exec(block)) !== null) {
    sentences.push(match[0].trim());
    lastMatchEnd = regex.lastIndex; // Track position BEFORE lastIndex resets to 0
  }

  // Use our tracked position, not regex.lastIndex (which resets to 0 after loop)
  const remainder = block.slice(lastMatchEnd).trim();
  if (remainder) {
    sentences.push(remainder);
  }

  return sentences.length ? sentences : [block];
};

const smartSplitParagraph = (block: string): string[] => {
  const sentences = splitIntoSentences(block);
  const paragraphs: string[] = [];
  let current = '';

  sentences.forEach((sentence) => {
    const next = current ? `${current} ${sentence}` : sentence;
    if (next.length > 320 && current) {
      paragraphs.push(current.trim());
      current = sentence;
    } else {
      current = next;
    }
  });

  if (current) {
    paragraphs.push(current.trim());
  }

  return paragraphs.length ? paragraphs : [block];
};

const formatInline = (line: string): React.ReactNode[] => {
  const nodes: React.ReactNode[] = [];
  const regex = /\*(.+?)\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(line)) !== null) {
    const [fullMatch, inner] = match;
    if (match.index > lastIndex) {
      nodes.push(line.slice(lastIndex, match.index));
    }
    nodes.push(
      <em
        key={`em-${match.index}-${inner}`}
        className="font-medium italic text-infinite-purple-light"
      >
        {inner}
      </em>,
    );
    lastIndex = match.index + fullMatch.length;
  }

  if (lastIndex < line.length) {
    nodes.push(line.slice(lastIndex));
  }

  return nodes.length ? nodes : [line];
};

const renderBlock = (block: string, index: number): React.ReactNode => {
  const lines = block
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) {
    return null;
  }

  const allBullets = lines.every((line) => BULLET_PATTERN.test(line));
  if (allBullets) {
    return (
      <ul key={`ul-${index}`} className="dm-list space-y-2 pl-5 list-disc">
        {lines.map((line, liIndex) => (
          <li key={`li-${index}-${liIndex}`}>
            {formatInline(line.replace(BULLET_PATTERN, '').trim())}
          </li>
        ))}
      </ul>
    );
  }

  const isDialogue = lines.length === 1 && DIALOGUE_PATTERN.test(lines[0]);
  const className = isDialogue ? 'italic text-infinite-teal-light font-serif text-[16px]' : '';

  if (lines.length === 1) {
    return (
      <p key={`p-${index}`} className={className}>
        {formatInline(lines[0])}
      </p>
    );
  }

  return (
    <div key={`block-${index}`} className={className}>
      {lines.map((line, lineIndex) => (
        <p key={`p-${index}-${lineIndex}`} className="mb-3 last:mb-0">
          {formatInline(line)}
        </p>
      ))}
    </div>
  );
};

export const formatNarrative = (
  text: string,
): { content: React.ReactNode; charCount: number; paragraphCount: number } => {
  const rawText = text?.trim?.() ?? '';

  if (!rawText) {
    return { content: null, charCount: 0, paragraphCount: 0 };
  }

  // Clean brainstorming artifacts and sanitize markdown delimiters before processing
  const trimmed = sanitizeEmphasisDelimiters(cleanBrainstorming(rawText));

  if (!trimmed) {
    return { content: null, charCount: 0, paragraphCount: 0 };
  }

  // Normalize for comparison - handles quotes, dashes, and whitespace
  const normalize = (value: string): string =>
    value
      .replace(/[\u2018\u2019\u201C\u201D]/g, "'") // Smart quotes to straight
      .replace(/[\u2013\u2014]/g, '-') // En/em dashes to hyphen
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

  let rawParagraphs = trimmed
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (rawParagraphs.length > 1) {
    const result: string[] = [];
    const seenStarts: string[] = [];

    for (let i = 0; i < rawParagraphs.length; i++) {
      const currentNorm = normalize(rawParagraphs[i]);
      const currentStart = currentNorm.slice(0, 60);
      let isDuplicate = false;

      // Check 1: This paragraph starts the same as a previous one (simple dup)
      if (seenStarts.some((s) => s === currentStart)) {
        isDuplicate = true;
      }

      // Check 2: This paragraph contains a previous paragraph's substantial content
      if (!isDuplicate && result.length >= 1) {
        for (const prev of result) {
          const prevNorm = normalize(prev);
          // If current contains the first 80 chars of a previous paragraph
          if (prevNorm.length > 60 && currentNorm.includes(prevNorm.slice(0, 80))) {
            // And current is significantly longer (it's an accumulated version)
            if (currentNorm.length > prevNorm.length * 1.3) {
              isDuplicate = true;
              break;
            }
          }
          // Or if current contains the middle portion of a previous paragraph
          if (prevNorm.length > 100) {
            const prevMiddle = prevNorm.slice(30, 90);
            if (currentNorm.includes(prevMiddle) && currentNorm !== prevNorm) {
              isDuplicate = true;
              break;
            }
          }
        }
      }

      // Check 3: This paragraph is two+ previous paragraphs joined together
      if (!isDuplicate && i >= 2) {
        for (let j = 0; j < i - 1 && !isDuplicate; j++) {
          const subsequence = rawParagraphs.slice(j, j + 2);
          const joinedNorm = normalize(subsequence.join(' '));
          // Check if current equals or contains the joined content
          if (currentNorm === joinedNorm || currentNorm.includes(joinedNorm)) {
            isDuplicate = true;
          }
        }
      }

      // Check 4: Multiple previous paragraph starts appear in order in this paragraph
      if (!isDuplicate && i >= 2) {
        let foundCount = 0;
        let lastPos = -1;
        for (let j = Math.max(0, i - 4); j < i; j++) {
          const prevStart = normalize(rawParagraphs[j]).slice(0, 50);
          const pos = currentNorm.indexOf(prevStart);
          if (pos !== -1 && pos > lastPos) {
            foundCount++;
            lastPos = pos;
          }
        }
        if (foundCount >= 2) {
          isDuplicate = true;
        }
      }

      if (!isDuplicate) {
        seenStarts.push(currentStart);
        result.push(rawParagraphs[i]);
      }
    }

    rawParagraphs = result;
  }

  if (rawParagraphs.length > 1) {
    const last = rawParagraphs[rawParagraphs.length - 1];
    if (normalize(last) === normalize(trimmed)) {
      rawParagraphs.pop();
    }
  }

  const normalizedParagraphs = rawParagraphs.length
    ? rawParagraphs.flatMap((block) => {
        const needsSmartSplit =
          (!block.includes('\n') && block.length > 400) ||
          (rawParagraphs.length === 1 && block.length > 350);

        if (needsSmartSplit) {
          return smartSplitParagraph(block);
        }
        return [block];
      })
    : [];

  if (normalizedParagraphs.length > 1) {
    const joinedOthers = normalize(normalizedParagraphs.slice(0, -1).join(' '));
    const finalBlock = normalize(normalizedParagraphs[normalizedParagraphs.length - 1]);
    if (joinedOthers && joinedOthers === finalBlock) {
      normalizedParagraphs.pop();
    }
  }

  const nodes = (
    <div className="space-y-4">
      {normalizedParagraphs.map((block, index) => renderBlock(block, index))}
    </div>
  );

  return {
    content: nodes,
    charCount: trimmed.length,
    paragraphCount: normalizedParagraphs.length,
  };
};
