/** Keep a model-authored options appendix out of story text, including partial previews. */
export function stripOptionsAppendix(text: string): string {
  return text.replace(/\s*\n\s*["']?options["']?\s*:\s*\[[\s\S]*$/i, '').trimEnd();
}

/**
 * Top-level keys a DM reply carries besides `text`. A payload nested inside
 * `text` counts as a reply only when at least two of them are present —
 * a quoted JSON object that merely has a `text` member (an inscription, a
 * terminal readout) is narration, not an envelope (#875 self-review).
 */
const REPLY_KEYS = [
  'options',
  'narration_segments',
  'roll_requests',
  'combat_transition',
  'combat_exits',
  'combat_entry_pending',
  'combatants',
  'combat_actions',
  'map_actions',
  'handout_actions',
  'damage',
  'xp_award',
  'scene_spec',
] as const;

/** How many envelopes-inside-`text` one reply may nest before we stop unwrapping. */
const MAX_NESTING = 3;

/**
 * #875: the parsed inner envelope when a reply's `text` is itself a serialized
 * DM reply — the model nested the whole payload in the narration field, so the
 * raw JSON would render as the story (Hark D20-020). Code fences are stripped
 * first, like every other reply parser in the codebase. Null for plain prose
 * and for JSON that is not reply-shaped.
 */
export function nestedReplyEnvelope(text: string): Record<string, unknown> | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/, '')
    .replace(/\s*```$/, '');
  if (!cleaned.startsWith('{')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const envelope = parsed as Record<string, unknown>;
  if (typeof envelope.text !== 'string') return null;
  const replyKeys = REPLY_KEYS.filter((key) => key in envelope).length;
  return replyKeys >= 2 ? envelope : null;
}

const isEmptyValue = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0) ||
  (typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).length === 0);

export type NarrationNormalization = 'unwrapped' | 'stripped' | 'unwrapped+stripped';

/**
 * #875: normalize a parsed DM reply in place, so the story text carries only
 * narration on every schema path:
 *
 * - Unwrap envelope nesting (up to MAX_NESTING levels): the inner reply's
 *   `text` becomes the narration, and the inner reply's other fields are
 *   adopted wherever the outer reply carries only the empty/default value —
 *   a nested combat turn keeps its roll_requests, combat_transition,
 *   combat_actions and combatants instead of silently losing the fight it
 *   existed to start. A field the outer reply actually set always wins;
 *   `combat_transition: 'none'` counts as unset when the inner reply names
 *   a real transition. `options` follows the same rule (adopted only when
 *   the outer offered none), and adopted options are string-filtered.
 * - Strip a model-authored options appendix from the resulting narration
 *   (the structured `options` field is untouched).
 *
 * Fails open like the neighboring narration rewrites: if the result would
 * empty a narration that arrived non-empty, the reply is left exactly as it
 * was — normalization never empties the narration it was handed.
 *
 * Invariants the validators rely on after this runs: `text` is still a
 * string, non-empty whenever it arrived non-empty, and `options` (when set)
 * holds only strings.
 *
 * Returns what changed ('unwrapped', 'stripped', 'unwrapped+stripped'), or
 * null when the reply was already clean.
 */
export function normalizeReplyNarration(
  envelope: Record<string, unknown>,
): NarrationNormalization | null {
  if (typeof envelope.text !== 'string') return null;
  const originalText = envelope.text;
  const staged: Record<string, unknown> = { ...envelope };
  let text = originalText;
  let unwrapped = false;

  let inner = nestedReplyEnvelope(text);
  for (let level = 0; inner !== null && level < MAX_NESTING; level += 1) {
    unwrapped = true;
    for (const [key, value] of Object.entries(inner)) {
      if (key === 'text' || isEmptyValue(value)) continue;
      if (key === 'combat_transition') {
        if (staged.combat_transition === 'none' || isEmptyValue(staged.combat_transition)) {
          staged.combat_transition = value;
        }
        continue;
      }
      if (key === 'options') {
        if (isEmptyValue(staged.options) && Array.isArray(value)) {
          staged.options = value.filter(
            (option): option is string => typeof option === 'string',
          );
        }
        continue;
      }
      if (isEmptyValue(staged[key])) staged[key] = value;
    }
    text = inner.text as string;
    inner = nestedReplyEnvelope(text);
  }

  const strippedText = stripOptionsAppendix(text);
  const stripped = strippedText !== text;
  text = strippedText;

  // Fail open: an ugly reply beats an empty one (a dead-end by the playtest
  // criteria) — and a reply whose narration vanished must not keep rescued
  // options or mechanics either.
  if (text.trim() === '' && originalText.trim() !== '') return null;
  if (!unwrapped && !stripped) return null;

  staged.text = text;
  Object.assign(envelope, staged);
  return unwrapped && stripped ? 'unwrapped+stripped' : unwrapped ? 'unwrapped' : 'stripped';
}
