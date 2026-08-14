const ENGINE_GENERATED_LINE = /^[ \t]*⚙(?:️)?[ \t]*Engine:[^\r\n]*(?:\r?\n|$)/gim;

/** Remove player-visible engine transcript lines from downstream processor input. */
export const stripEngineGeneratedLines = (content: string): string =>
  content
    .replace(ENGINE_GENERATED_LINE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** Strip engine lines from a copy of voice segments without mutating the persisted response. */
export const stripEngineGeneratedLinesFromSegments = <T extends { text: string }>(
  segments: readonly T[],
): T[] =>
  segments.flatMap((segment) => {
    const text = stripEngineGeneratedLines(segment.text);
    return text ? [{ ...segment, text }] : [];
  });
