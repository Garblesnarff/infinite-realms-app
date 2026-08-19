const ENGINE_GENERATED_LINE = /^[ \t]*⚙(?:️)?[ \t]*Engine:[^\r\n]*(?:\r?\n|$)/gim;

const engineLinePattern = (): RegExp =>
  new RegExp(ENGINE_GENERATED_LINE.source, ENGINE_GENERATED_LINE.flags);

/** Remove player-visible engine transcript lines from downstream processor input. */
export const stripEngineGeneratedLines = (content: string): string =>
  content
    .replace(engineLinePattern(), '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** Split persisted engine facts from the fiction they were prepended to. Persistence keeps both. */
export const extractEngineGeneratedLines = (
  content: string,
): { lines: string[]; fiction: string } => {
  const lines: string[] = [];
  const fiction = content
    .replace(engineLinePattern(), (match) => {
      const line = match.trim();
      if (line) lines.push(line);
      return '';
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { lines, fiction };
};

/** Strip engine lines from a copy of voice segments without mutating the persisted response. */
export const stripEngineGeneratedLinesFromSegments = <T extends { text: string }>(
  segments: readonly T[],
): T[] =>
  segments.flatMap((segment) => {
    const text = stripEngineGeneratedLines(segment.text);
    return text ? [{ ...segment, text }] : [];
  });
