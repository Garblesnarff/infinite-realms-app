/**
 * Sanitize markdown emphasis delimiters to prevent orphan * artifacts in rendered text.
 *
 * Fixes three AI output patterns that break rendering:
 * 1. **bold** → normalized to *bold* (formatInline only handles single-*)
 * 2. * spaced emphasis * → trimmed to *emphasis*
 * 3. Orphan * with no closing pair → stripped entirely
 *
 * Exported for unit testing.
 */
export const sanitizeEmphasisDelimiters = (text: string): string => {
  // Step 0: Strip emphasis markers that wrap quoted dialogue. The renderer already
  // styles dialogue by its quotes, and nested *"..."* / ** *"..."*** patterns from
  // the model break our simple emphasis parser.
  const dequoted = text.replace(/\*+\s*(["“])/g, '$1').replace(/(["”])\s*\*+/g, '$1');

  // Step 1: Normalize **bold** → *bold*
  const s = dequoted.replace(/\*\*([^*\n]+?)\*\*/g, '*$1*');

  // Step 2: Process line by line — cross-line emphasis creates orphan markers.
  // For each line: collect valid *...* spans (trimming inner spaces), strip orphan *,
  // then rebuild the line from the collected segments.
  return s
    .split('\n')
    .map((line) => {
      const parts: string[] = [];
      let lastEnd = 0;
      const re = /\*([^*\n]+)\*/g;
      let m: RegExpExecArray | null;

      while ((m = re.exec(line)) !== null) {
        // Text before this match — strip orphan * characters
        parts.push(line.slice(lastEnd, m.index).replace(/\*/g, ''));
        // Valid emphasis span with internal spaces trimmed ("* text*" → "*text*")
        parts.push(`*${m[1].trim()}*`);
        lastEnd = m.index + m[0].length;
      }

      // Remaining text after last match — strip orphan *
      parts.push(line.slice(lastEnd).replace(/\*/g, ''));
      return parts.join('');
    })
    .join('\n');
};
