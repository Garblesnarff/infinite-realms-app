/**
 * Splits an overly-long narrative paragraph into shorter ones at sentence
 * boundaries, split out of formatNarrative.tsx.
 * Quote-aware: never breaks inside an open single or double quote.
 */

const SINGLE_QUOTE_OPEN_PREV = /[\s([{—–]/;
const SINGLE_QUOTE_CLOSE_NEXT = /[\s.,;:!?…)\]}]/;

export const isSingleQuoteOpen = (source: string, index: number): boolean => {
  const char = source[index];
  if (char !== "'" && char !== '‘') return false;
  if (char === '‘') return true;
  if (index === 0) return true;
  return SINGLE_QUOTE_OPEN_PREV.test(source[index - 1] ?? '');
};

export const isSingleQuoteClose = (source: string, index: number): boolean => {
  const char = source[index];
  if (char !== "'" && char !== '’') return false;
  if (index === source.length - 1) return true;
  return SINGLE_QUOTE_CLOSE_NEXT.test(source[index + 1] ?? '');
};

type QuoteType = '"' | '“' | "'" | '‘';

export const computeQuoteStateMap = (text: string): boolean[] => {
  const isOpenMap = new Array<boolean>(text.length + 1).fill(false);
  const stack: QuoteType[] = [];

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const currentQuote = stack[stack.length - 1];

    if (!currentQuote) {
      if (char === '"' || char === '“') {
        stack.push(char);
      } else if (char === '‘') {
        stack.push('‘');
      } else if (char === "'" && isSingleQuoteOpen(text, i)) {
        stack.push("'");
      }
    } else {
      if (currentQuote === '"' || currentQuote === '“') {
        if (char === '"' || char === '”') {
          stack.pop();
        } else if (char === '‘') {
          stack.push('‘');
        } else if (char === "'" && isSingleQuoteOpen(text, i)) {
          stack.push("'");
        }
      } else if (currentQuote === "'" || currentQuote === '‘') {
        if (currentQuote === '‘' && char === '’') {
          stack.pop();
        } else if (char === "'" && isSingleQuoteClose(text, i)) {
          stack.pop();
        } else if (currentQuote === "'" && char === '’') {
          stack.pop();
        } else if (char === '"' || char === '“') {
          stack.push(char);
        }
      }
    }

    isOpenMap[i + 1] = stack.length > 0;
  }

  return isOpenMap;
};

const splitIntoSentences = (block: string): string[] => {
  const isOpenMap = computeQuoteStateMap(block);
  const sentences: string[] = [];
  const regex = /[^.!?]+[.!?]+["“”'’]?\s*/g;
  let match: RegExpExecArray | null;
  let currentSentenceStart = 0;

  while ((match = regex.exec(block)) !== null) {
    const matchEnd = regex.lastIndex;
    const trimEndPos = match.index + match[0].trimEnd().length;

    if (!isOpenMap[matchEnd] && !isOpenMap[trimEndPos]) {
      const sentenceText = block.slice(currentSentenceStart, matchEnd).trim();
      if (sentenceText) {
        sentences.push(sentenceText);
      }
      currentSentenceStart = matchEnd;
    }
  }

  const remainder = block.slice(currentSentenceStart).trim();
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
