import React from 'react';

const DIALOGUE_PATTERN = /^"[\s\S]*"$/;
const BULLET_PATTERN = /^[-•]/;

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
  const trimmed = text?.trim?.() ?? '';

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

      // Check if current paragraph STARTS WITH the first previous paragraph
      // AND contains the start of subsequent paragraphs (indicates accumulated/expanded duplicate)
      if (i >= 2) {
        const firstPrevNorm = normalize(rawParagraphs[0]);
        const firstPrevStart = firstPrevNorm.slice(0, 50); // First 50 chars

        // If current starts with first paragraph's beginning
        if (currentNorm.startsWith(firstPrevStart)) {
          // Check if it also contains starts of other previous paragraphs
          let containsAllPrevious = true;
          for (let j = 1; j < i && containsAllPrevious; j++) {
            const prevNorm = normalize(rawParagraphs[j]);
            const prevStart = prevNorm.slice(0, 40); // First 40 chars
            if (!currentNorm.includes(prevStart)) {
              containsAllPrevious = false;
            }
          }
          if (containsAllPrevious) {
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
