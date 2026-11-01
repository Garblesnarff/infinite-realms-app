/**
 * Paragraph-level deduplication for AI-generated narrative text, split out
 * of formatNarrative.tsx. The AI occasionally re-emits a paragraph it just
 * wrote (verbatim, extended, or joined with an adjacent one) - these checks
 * catch the common shapes of that repetition.
 */

// Normalize for comparison - handles quotes, dashes, and whitespace
export const normalizeNarrativeText = (value: string): string =>
  value
    .replace(/[\u2018\u2019\u201C\u201D]/g, "'") // Smart quotes to straight
    .replace(/[\u2013\u2014]/g, '-') // En/em dashes to hyphen
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

export function deduplicateNarrativeParagraphs(rawParagraphs: string[]): string[] {
  if (rawParagraphs.length <= 1) {
    return rawParagraphs;
  }

  const result: string[] = [];
  const seenNorms: string[] = [];

  for (let i = 0; i < rawParagraphs.length; i++) {
    const currentNorm = normalizeNarrativeText(rawParagraphs[i]);
    let isDuplicate = false;

    // Check 1: This paragraph is an earlier one verbatim, or a cut-off copy of it that ends at a
    // word boundary. A longer paragraph that merely shares an earlier one's opening is kept.
    if (
      seenNorms.some(
        (s) =>
          s === currentNorm ||
          (currentNorm !== '' &&
            s.startsWith(currentNorm) &&
            /^[\s\p{P}]/u.test(s.slice(currentNorm.length))),
      )
    ) {
      isDuplicate = true;
    }

    // Check 2: This paragraph contains a previous paragraph's substantial content
    if (!isDuplicate && result.length >= 1) {
      for (const prev of result) {
        const prevNorm = normalizeNarrativeText(prev);
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
        const joinedNorm = normalizeNarrativeText(subsequence.join(' '));
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
        const prevStart = normalizeNarrativeText(rawParagraphs[j]).slice(0, 50);
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
      seenNorms.push(currentNorm);
      result.push(rawParagraphs[i]);
    }
  }

  return result;
}
