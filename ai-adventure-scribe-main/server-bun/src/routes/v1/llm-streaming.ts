import { stripOptionsAppendix } from '../../services/dm/narration-text.js';

/**
 * SSE streaming support for POST /v1/llm/generate (#633 PR2).
 *
 * When the client opts in (`stream: true` in the body), the route replies
 * `text/event-stream`: one `delta` event per narration chunk as OpenRouter
 * tokens arrive, then a single `done` event whose payload is identical in
 * shape to the non-streaming JSON response. A `type: 'error'` event carries a
 * thrown AppError (statusCode) when headers are already sent.
 */

/** Response headers for the SSE stream. */
export const SSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  // nginx (prod) buffers SSE bodies by default; opt out for the stream.
  'X-Accel-Buffering': 'no',
};

/**
 * Index just past the closing quote of the JSON string starting at `start`
 * (which must point at the opening quote), or -1 when the string runs past
 * the end of the input.
 */
const stringEnd = (s: string, start: number): number => {
  let i = start + 1;
  while (i < s.length) {
    if (s[i] === '\\') {
      i += 2;
      continue;
    }
    if (s[i] === '"') return i + 1;
    i += 1;
  }
  return -1;
};

/**
 * Decode a possibly-truncated JSON string literal starting at `start` (the
 * opening quote). A tail cut mid-escape is trimmed until the remainder
 * decodes; returns null when nothing decodes.
 */
const decodePartialString = (s: string, start: number): string | null => {
  let i = start + 1;
  while (i < s.length && s[i] !== '"') i += s[i] === '\\' ? 2 : 1;
  let raw = s.slice(start + 1, Math.min(i, s.length));
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return JSON.parse(`"${raw}"`) as string;
    } catch {
      if (raw.length === 0) return null;
      raw = raw.slice(0, -1);
    }
  }
  return null;
};

const isWhitespace = (ch: string): boolean =>
  ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';

/**
 * Best-effort incremental extraction of the top-level `"text"` narration
 * field from a partially-received JSON envelope.
 *
 * The structured DM completion streams as JSON (`{"text": "...", ...}`), so
 * raw token deltas are not displayable. This scans the accumulated text for
 * the first `"text"` key at object depth 1 and decodes as much of its string
 * value as has arrived. Returns null until the key and an opening quote are
 * present (or when the value cannot be decoded yet).
 *
 * The final authoritative text always comes from the full parse at the end
 * of the stream; this is a progress preview only.
 */
export function extractPartialNarration(accumulated: string): string | null {
  let depth = 0;
  let i = 0;
  const n = accumulated.length;
  while (i < n) {
    const ch = accumulated[i];
    if (ch === '{' || ch === '[') {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === '}' || ch === ']') {
      depth -= 1;
      i += 1;
      continue;
    }
    if (ch === '"') {
      const end = stringEnd(accumulated, i);
      // The key itself is cut off mid-token; wait for more input.
      if (end === -1) return null;
      if (depth === 1) {
        let key: string;
        try {
          key = JSON.parse(accumulated.slice(i, end)) as string;
        } catch {
          i = end;
          continue;
        }
        if (key === 'text') {
          let j = end;
          while (j < n && isWhitespace(accumulated[j])) j += 1;
          if (j >= n || accumulated[j] !== ':') return null;
          j += 1;
          while (j < n && isWhitespace(accumulated[j])) j += 1;
          if (j >= n || accumulated[j] !== '"') return null;
          const narration = decodePartialString(accumulated, j);
          if (narration === null) return null;
          const clean = stripOptionsAppendix(narration);
          const lastLine = clean.slice(clean.lastIndexOf('\n') + 1).trimStart();
          const key = lastLine.replace(/^["']/, '').toLowerCase();
          if (
            clean.includes('\n') &&
            ('options'.startsWith(key) || /^options["']?\s*:/.test(key))
          ) {
            return clean.slice(0, clean.lastIndexOf('\n')).trimEnd();
          }
          return clean;
        }
      }
      i = end;
      continue;
    }
    i += 1;
  }
  return null;
}
