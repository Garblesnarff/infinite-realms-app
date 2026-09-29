import React from 'react';

/**
 * Styled presentation of a persisted `⚙️ Engine:` transcript line (#1808 part 2).
 * The raw line stays in the message record; this is display only. Default-open
 * because it is the trust layer — players can collapse it for pure fiction.
 */
export function summarizeEngineLine(line: string): { outcome: string; detail: string } {
  const detail = line.replace(/^[ \t]*⚙(?:️)?[ \t]*Engine:\s*/, '').trim();
  const outcomeMatch = detail.match(/\b(CRITICAL HIT|AUTO-HIT|HIT|MISS|PASS|FAIL)\b/);
  if (outcomeMatch) return { outcome: outcomeMatch[1], detail };
  if (/\bwas refused\b/i.test(detail)) return { outcome: 'REFUSED', detail };
  return { outcome: 'Engine', detail };
}

/**
 * `showLabel` is false for every chip after the first in one engine block, so the word
 * "Engine" prints once per block (#2256). A line with no HIT/MISS-style outcome has nothing
 * to badge: its outcome is the label itself, so it is never printed a second time.
 */
export const EngineOutcomeChip: React.FC<{ line: string; showLabel?: boolean }> = ({
  line,
  showLabel = true,
}) => {
  const { outcome, detail } = summarizeEngineLine(line);
  const tone =
    outcome === 'MISS' || outcome === 'REFUSED' || outcome === 'FAIL'
      ? 'border-white/15 text-white/80'
      : outcome.includes('HIT') || outcome === 'PASS'
        ? 'border-infinite-gold/50 text-infinite-gold'
        : 'border-white/20 text-white/85';
  const showBadge = outcome !== 'Engine';

  if (!showLabel && !showBadge) {
    return (
      <p
        className={`mb-3 rounded-lg border bg-black/35 px-3 py-2 text-xs leading-relaxed backdrop-blur-sm ${tone}`}
      >
        {detail}
      </p>
    );
  }

  return (
    <details
      open
      className={`mb-3 rounded-lg border bg-black/35 px-3 py-2 text-sm backdrop-blur-sm ${tone}`}
    >
      <summary
        className="flex cursor-pointer list-none items-center gap-2 font-medium tracking-wide"
        aria-label={[showLabel && 'Engine', showBadge && outcome].filter(Boolean).join(' ')}
      >
        {showLabel && (
          <span className="uppercase text-[11px] tracking-[0.2em] opacity-80">Engine</span>
        )}
        {showBadge && (
          <span className="rounded-sm border border-current px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide">
            {outcome}
          </span>
        )}
      </summary>
      <p className="mt-2 text-xs leading-relaxed text-white/80">{detail}</p>
    </details>
  );
};
