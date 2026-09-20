import React from 'react';

/**
 * Styled presentation of a persisted `⚙️ Engine:` transcript line (#1808 part 2).
 * The raw line stays in the message record; this is display only. Default-open
 * because it is the trust layer — players can collapse it for pure fiction.
 */
export function summarizeEngineLine(line: string): { outcome: string; detail: string } {
  const detail = line.replace(/^[ \t]*⚙(?:️)?[ \t]*Engine:\s*/, '').trim();
  const outcomeMatch = detail.match(/\b(CRITICAL HIT|HIT|MISS)\b/);
  return { outcome: outcomeMatch?.[1] ?? 'Engine', detail };
}

export const EngineOutcomeChip: React.FC<{ line: string }> = ({ line }) => {
  const { outcome, detail } = summarizeEngineLine(line);
  const tone =
    outcome === 'MISS'
      ? 'border-white/15 text-white/80'
      : outcome.includes('HIT')
        ? 'border-infinite-gold/50 text-infinite-gold'
        : 'border-white/20 text-white/85';

  return (
    <details
      open
      className={`mb-3 rounded-lg border bg-black/35 px-3 py-2 text-sm backdrop-blur-sm ${tone}`}
    >
      <summary
        className="flex cursor-pointer list-none items-center gap-2 font-medium tracking-wide"
        aria-label={`Engine ${outcome}`}
      >
        <span className="uppercase text-[11px] tracking-[0.2em] opacity-80">Engine</span>
        <span className="rounded-sm border border-current px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide">
          {outcome}
        </span>
      </summary>
      <p className="mt-2 text-xs leading-relaxed text-white/80">{detail}</p>
    </details>
  );
};
