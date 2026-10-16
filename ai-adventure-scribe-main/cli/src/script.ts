/**
 * Parse a `--script` file: one player input per line. Blank lines and lines
 * beginning with `#` are ignored, and surrounding whitespace is trimmed so a
 * `move`/`roll` line matches the same handling as a typed line.
 */
export function parseScript(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}
