export type ResultSealTone = 'gold' | 'red' | 'slate';

/** Longer engine tokens first, so FAILED is not read as FAIL and CRITICAL HIT is not read as HIT. */
const VERDICT =
  /\b(CRITICAL HIT|AUTO-HIT|TARGET FAILED|TARGET SAVED|SUCCESS|FAILED|PASSED|PASS|FAIL|HIT|MISS)\b/;

/** The verdict token already written on an engine line. Absent when the line has none. */
export function engineVerdictWord(line: string): string | undefined {
  return line.match(VERDICT)?.[1];
}

/**
 * Red for a miss, a fail, or a refusal. Gold for a hit, crit, or success.
 * Slate when the line has no pass/fail, such as initiative or damage.
 * An engine badge tone of gold or red wins, except a miss or a refusal:
 * those stay red when the badge is grey.
 */
export function resultSealTone(
  word: string,
  engineTone?: 'gold' | 'red' | 'grey' | null,
): ResultSealTone {
  const upper = word.toUpperCase();
  if (/\bMISS\b/.test(upper)) return 'red';
  if (/\bREFUSED\b/.test(upper)) return 'red';
  if (engineTone === 'gold') return 'gold';
  if (engineTone === 'red') return 'red';
  if (/\bFAIL/.test(upper)) return 'red';
  if (/\b(HIT|CRIT|SUCCESS|PASSED|PASS)\b/.test(upper)) return 'gold';
  return 'slate';
}

/** White on these fills is at least 7:1. Shared wax tokens stay as they are. */
export function resultSealFill(tone: ResultSealTone): string {
  if (tone === 'gold') return '#6e4a16';
  if (tone === 'red') return 'var(--ir-wax-red-2)';
  return 'var(--ir-wax-slate)';
}
