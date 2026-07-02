/**
 * Splits an overly-long narrative paragraph into shorter ones at sentence
 * boundaries, split out of formatNarrative.tsx.
 */

const splitIntoSentences = (block: string): string[] => {
  const sentences: string[] = [];
  const regex = /[^.!?]+[.!?]+["“”'’]?\s*/g;
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

export const smartSplitParagraph = (block: string): string[] => {
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
