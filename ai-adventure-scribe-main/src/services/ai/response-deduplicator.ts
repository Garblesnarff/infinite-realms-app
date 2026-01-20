import logger from '@/lib/logger';

/**
 * Remove duplicate/accumulated paragraphs from AI output
 * Pattern: AI outputs Para1, Para2, Para3, then "Para1 Para2 Para3" collapsed
 */
export function deduplicateParagraphs(text: string): string {
  const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

  // Split on double newlines (paragraph breaks)
  let paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (paragraphs.length <= 1) return text;

  const result: string[] = [];

  for (let i = 0; i < paragraphs.length; i++) {
    const currentNorm = normalize(paragraphs[i]);
    let isDuplicate = false;

    // Check if this paragraph contains 2+ previous paragraphs in sequence
    if (i >= 2) {
      for (let startIdx = 0; startIdx <= i - 2 && !isDuplicate; startIdx++) {
        let consecutiveFound = 0;
        let searchPos = 0;

        for (let j = startIdx; j < i; j++) {
          const prevStart = normalize(paragraphs[j]).slice(0, 50);
          const foundAt = currentNorm.indexOf(prevStart, searchPos);

          if (foundAt !== -1 && foundAt >= searchPos) {
            consecutiveFound++;
            searchPos = foundAt + prevStart.length;
          } else {
            break;
          }
        }

        if (consecutiveFound >= 2) {
          isDuplicate = true;
          logger.debug(`[Dedup] Removed accumulated paragraph at index ${i} (contained ${consecutiveFound} previous paragraphs)`);
        }
      }
    }

    if (!isDuplicate) {
      result.push(paragraphs[i]);
    }
  }

  return result.join('\n\n');
}
