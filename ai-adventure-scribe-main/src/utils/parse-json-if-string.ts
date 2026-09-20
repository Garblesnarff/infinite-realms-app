/**
 * Parse JSON only when the value is a string.
 *
 * `JSON.parse` of a non-string coerces via ToString, so an object becomes
 * the token `[object Object]` and throws `"[object Object]" is not valid JSON`.
 * Storage/API callers that already parsed the payload (or wrote an object
 * where a string was expected) must skip parse and use the value as-is.
 */
export function parseJsonIfString(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  return JSON.parse(value);
}
