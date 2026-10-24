/** Keep a model-authored options appendix out of story text, including partial previews. Trims only when the appendix actually matched, so a clean reply keeps its exact bytes (and `normalizeReplyNarration` does not report it as stripped). */
export function stripOptionsAppendix(text: string): string {
  const stripped = text.replace(/\s*\n\s*["']?options["']?\s*:\s*\[[\s\S]*$/i, '');
  return stripped === text ? text : stripped.trimEnd();
}

/**
 * #1067: tool-call markup the model wrote into `text` (Hark D23-006, the
 * forced-tool path) — a `<parameter name="options">` block, or a dangling
 * opening tag whose tail is the tool argument itself. The tag is never
 * prose, so it always goes; a dangling tag's tail goes only when the tail
 * is purely the argument (a JSON array/object, or a run of quoted strings),
 * and prose after a dangling tag survives.
 */
const TOOL_PARAMETER_BLOCK = /<parameter\s+name\s*=\s*["']options["']\s*>[\s\S]*?<\/parameter\s*>/gi;
const TOOL_PARAMETER_OPEN = /<parameter\s+name\s*=\s*["']options["']\s*>/i;
const TOOL_PARAMETER_CLOSE = /<\/parameter\s*>/gi;
const TOOL_ARGUMENT_TAIL =
  /^\s*(\[[\s\S]*\]|\{[\s\S]*\}|"[^"]*"(?:\s*,\s*"[^"]*")*)\s*$/;

export function stripToolParameterBlocks(text: string): string {
  let out = text.replace(TOOL_PARAMETER_BLOCK, '').replace(TOOL_PARAMETER_CLOSE, '');
  const open = TOOL_PARAMETER_OPEN.exec(out);
  if (open) {
    const tail = out.slice(open.index + open[0].length);
    out = TOOL_ARGUMENT_TAIL.test(tail)
      ? out.slice(0, open.index)
      : out.slice(0, open.index) + tail;
  }
  return out;
}

/**
 * #1067: a lettered options list the model wrote into prose at the end of
 * the narration (`options: A. … B. …`). Trailing only, and it must show at
 * least two lettered items — a lone `options:` mention mid-prose is not
 * this shape and is left alone. Each item is one sentence: the list must
 * run to the end of the text with nothing but further lettered items after
 * it, so a list followed by resumed narration is left alone (leaked, not
 * deleted — deleting story to remove an artifact would be worse than the
 * leak). Item separators may be a period or a newline, so a list broken
 * across lines still strips.
 */
const PROSE_OPTIONS_LIST =
  /\s*["']?options["']?\s*:\s*A\.\s*[^.\n]+(?:[.\n]\s*[B-Z]\.\s*[^.\n]+)+\.?\s*$/i;

export function stripProseOptionsList(text: string): string {
  const stripped = text.replace(PROSE_OPTIONS_LIST, '');
  return stripped === text ? text : stripped.trimEnd();
}

/**
 * #1067: the bracket tracker line the prompt asks the DM to render
 * (`[HP 18/?] [Clock 0/6] …`), stripped only as a trailing run of at least
 * two short label-like groups with a tracker anchor (HP/Clock/Scene, or a
 * `Key: value` group). A single bracket aside, a sentence-like group, and
 * an asset tag (`[ASSET:…]`, whose colon has no space after it) all fail
 * the shape and survive. #1062 removes this line for good via server-state
 * rendering; this strip is the safety net until then.
 */
const TRAILING_BRACKET_RUN = /((?:\[[^[\]\n]{1,48}\]\s*){2,})\s*$/;
const TRACKER_GROUP =
  /^[A-Za-z0-9][A-Za-z0-9'’\- ]{0,30}(?:: [^[\].]{1,40}| \d+(?:\/\?|\/\d+)?| \d+)?$/;
const TRACKER_ANCHOR = /^(HP|Clock|Scene)\b|: /;

export function stripTrackerLine(text: string): string {
  const match = TRAILING_BRACKET_RUN.exec(text);
  if (!match) return text;
  const groups = match[1].match(/\[[^[\]\n]{1,48}\]/g);
  if (!groups || groups.length < 2) return text;
  const inners = groups.map((group) => group.slice(1, -1));
  if (!inners.every((inner) => TRACKER_GROUP.test(inner))) return text;
  if (!inners.some((inner) => TRACKER_ANCHOR.test(inner))) return text;
  return text.slice(0, match.index).trimEnd();
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
 * - #1067: strip the three raw-artifact shapes Hark D23-006 caught in
 *   story text — tool-call `<parameter name="options">` blocks anywhere
 *   in the narration, a trailing prose `options: A. … B. …` list, and a
 *   trailing bracket tracker line. The trailing strips loop until stable,
 *   so an artifact stacked behind another (appendix behind tracker line)
 *   still comes off; each strip only shortens, so the loop is bounded.
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

  let strippedText = stripToolParameterBlocks(text);
  for (let i = 0; i < 4; i += 1) {
    const previous = strippedText;
    strippedText = stripProseOptionsList(strippedText);
    strippedText = stripTrackerLine(strippedText);
    strippedText = stripOptionsAppendix(strippedText);
    if (strippedText === previous) break;
  }
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
