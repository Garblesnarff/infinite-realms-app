import React from 'react';

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
  const regex = /[^.!?]+[.!?]+["”']?\s*/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(block)) !== null) {
    sentences.push(match[0].trim());
  }

  const remainder = block.slice(regex.lastIndex).trim();
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
      <em key={`em-${match.index}-${inner}`} className="font-medium italic">
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
  const className = isDialogue ? 'dm-dialogue' : 'dm-paragraph';

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

  // Clean any leaked brainstorming patterns before processing
  const trimmed = cleanBrainstorming(rawText);

  if (!trimmed) {
    return { content: null, charCount: 0, paragraphCount: 0 };
  }

  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();

  let rawParagraphs = trimmed
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);

  // Deduplicate accumulated paragraphs
  // Pattern: AI streams paragraphs individually, then repeats them combined with expansions
  // E.g., Para1, Para2, then "Para1 [extra text]. Para2 [extra text]."
  // The combined/expanded paragraph should be removed since it duplicates content
  if (rawParagraphs.length > 1) {
    const result: string[] = [];

    for (let i = 0; i < rawParagraphs.length; i++) {
      const currentNorm = normalize(rawParagraphs[i]);
      let isDuplicate = false;

      // FIXED ALGORITHM: Check if paragraph N contains 2+ CONSECUTIVE previous paragraphs IN ORDER
      // This catches accumulated duplicates at ANY position, not just from paragraph 0
      // Example: [Para1, Para2, Para3, Combined(1-3), Para5, Para6, Combined(5-6)]
      // Old algorithm missed Combined(5-6) because it doesn't contain Para1
      if (i >= 2) {
        // Try each possible starting position for a consecutive sequence
        for (let startIdx = 0; startIdx <= i - 2 && !isDuplicate; startIdx++) {
          let lastFoundIndex = -1;
          let consecutiveCount = 0;

          for (let j = startIdx; j < i; j++) {
            const prevNorm = normalize(rawParagraphs[j]);
            const prevStart = prevNorm.slice(0, 40);
            const foundIndex = currentNorm.indexOf(prevStart);

            // Must be found AND appear after previous match (ensures correct order)
            if (foundIndex !== -1 && foundIndex > lastFoundIndex) {
              consecutiveCount++;
              lastFoundIndex = foundIndex;
            } else {
              break; // Sequence broken
            }
          }

          // If 2+ consecutive paragraph starts found in order, it's a duplicate
          if (consecutiveCount >= 2) {
            isDuplicate = true;
          }
        }
      }

      // Also check exact match of joined previous paragraphs (original algorithm)
      if (!isDuplicate) {
        for (let j = 0; j < i && !isDuplicate; j++) {
          const subsequence = rawParagraphs.slice(j, i);
          if (subsequence.length >= 2) {
            const joinedNorm = normalize(subsequence.join(' '));
            if (currentNorm === joinedNorm) {
              isDuplicate = true;
            }
          }
        }
      }

      if (!isDuplicate) {
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
