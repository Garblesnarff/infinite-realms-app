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
const TOOL_PARAMETER_BLOCK =
  /<parameter\s+name\s*=\s*["']options["']\s*>[\s\S]*?<\/parameter\s*>/gi;
const TOOL_PARAMETER_OPEN = /<parameter\s+name\s*=\s*["']options["']\s*>/i;
const TOOL_PARAMETER_CLOSE = /<\/parameter\s*>/gi;
const TOOL_ARGUMENT_TAIL = /^\s*(\[[\s\S]*\]|\{[\s\S]*\}|"[^"]*"(?:\s*,\s*"[^"]*")*)\s*$/;

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
const TRAILER = '(?:\\.{3}|[.!?…]+)?';
const TRAILING_BRACKET_RUN = new RegExp(`((?:\\[[^[\\]\\n]{1,96}\\]\\s*){2,})${TRAILER}\\s*$`);
// #1289: a lone trailing [HP n/n] is still a footer. A run needs two groups,
// so this one was surviving and showing a number the engine does not hold.
const LONE_FOOTER_HP = new RegExp(
  `\\[HP\\s*:?\\s*\\d+(?:\\s*\\/\\s*(?:\\d+|\\?))?\\s*\\]${TRAILER}\\s*$`,
  'i',
);
// HP groups sitting in a trailing tracker (other brackets may follow). Used
// when stripping the whole run would empty the reply: drop the HP, keep the rest.
const TRAILING_HP_GROUPS = new RegExp(
  `(?:\\[HP\\s*:?\\s*\\d+(?:\\s*\\/\\s*(?:\\d+|\\?))?\\s*\\]\\s*)+(?=(?:\\[[^[\\]\\n]{1,96}\\]\\s*)*${TRAILER}\\s*$)`,
  'gi',
);
const TRACKER_GROUP =
  /^[A-Za-z0-9][A-Za-z0-9'’\- ]{0,30}(?:: [^[\].]{1,80}| \d+(?:\/\?|\/\d+)?| \d+)?$/;
const TRACKER_ANCHOR = /^(HP|Clock|Scene)\b|: /;
const TRACKER_ANCHOR_KEY = /^(HP|Clock|Scene)\b/;

function withoutTrailingHp(text: string): string {
  TRAILING_HP_GROUPS.lastIndex = 0;
  const stripped = text.replace(TRAILING_HP_GROUPS, '');
  return stripped === text ? text : stripped.replace(/[ \t]{2,}/g, ' ').trimEnd();
}

export function stripTrackerLine(text: string): string {
  const match = TRAILING_BRACKET_RUN.exec(text);
  if (match) {
    const groups = match[1].match(/\[[^[\]\n]{1,96}\]/g);
    if (groups && groups.length >= 2) {
      const inners = groups.map((group) => group.slice(1, -1));
      if (
        inners.every((inner) => TRACKER_GROUP.test(inner)) &&
        inners.some((inner) => TRACKER_ANCHOR.test(inner))
      ) {
        return text.slice(0, match.index).trimEnd();
      }
    }
  }
  // #1067 follow-up: a trailing UNTERMINATED bracket group whose inner text
  // starts with a tracker anchor (HP/Clock/Scene) is a cut-off tracker line
  // and goes too. Walk back over closed tracker-shaped groups directly in
  // front of it so a cut-off tracker run is removed as a whole, while a prose
  // aside (e.g. [old]) sitting right before the run is kept.
  const lastBracket = text.lastIndexOf('[');
  if (lastBracket !== -1 && !text.slice(lastBracket).includes(']')) {
    const inner = text.slice(lastBracket + 1);
    if (inner.length <= 96 && !inner.includes('\n') && TRACKER_ANCHOR_KEY.test(inner)) {
      const walked: Array<{ start: number; inner: string }> = [];
      let cut = lastBracket;
      for (;;) {
        const prefix = text.slice(0, cut);
        const m = prefix.match(/\[([^[\]\n]{1,96})\]\s*$/);
        if (!m) break;
        const gInner = m[1];
        if (!TRACKER_GROUP.test(gInner)) break;
        walked.push({ start: m.index as number, inner: gInner });
        cut = m.index as number;
      }
      walked.reverse();
      const firstAnchored = walked.findIndex((g) => TRACKER_ANCHOR.test(g.inner));
      const cutAt = firstAnchored === -1 ? lastBracket : walked[firstAnchored].start;
      return text.slice(0, cutAt).trimEnd();
    }
  }
  const loneHp = LONE_FOOTER_HP.exec(text);
  if (loneHp) return text.slice(0, loneHp.index).trimEnd();
  return text;
}

/**
 * #1067 follow-up: a lettered options list the model wrote inline in the
 * article ('A. Race for the hollow. B. Hide among the roots. C. ...'),
 * not trailing and not labelled `options:`. Same fail-open discipline as
 * the trailing strip: the run must start at A, ascend consecutively, hold
 * at least two items, and each item must be one sentence (no terminator or
 * newline inside). A lone `A.` item, a non-sequential run, a multi-sentence
 * item, or an `A.` that is not at a sentence boundary ('Plan A.') all fail
 * the shape and survive — leaked, not deleted. Deliberately NOT extended
 * to `options:`-labelled runs mid-text: #1081 pins those as leaked (a
 * labelled list followed by resumed narration stays), and only the
 * trailing strip owns the labelled shape. A dangling partial item at the
 * very end of the text ('C.' with nothing after it) rides along with an
 * otherwise complete run, so stripping the run does not leave a stray
 * letter behind.
 */
const LETTERED_ITEM_END = /[.!?]/;

interface LetteredItem {
  letter: string;
  end: number;
}

function parseLetteredItem(text: string, pos: number, expected: string): LetteredItem | null {
  if (text[pos] !== expected || text[pos + 1] !== '.') return null;
  let i = pos + 2;
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i += 1;
  const contentStart = i;
  while (i < text.length && !LETTERED_ITEM_END.test(text[i]) && text[i] !== '\n') i += 1;
  if (i === contentStart || i >= text.length) return null;
  return { letter: expected, end: i + 1 };
}

function letteredRunStart(text: string, aPos: number): number | null {
  const before = text.slice(0, aPos);
  if (/^\s*$/.test(before)) return aPos;
  if (/[.!?]\s+$/.test(before)) return aPos;
  if (/\n\s*$/.test(before)) return aPos;
  if (/[—–]\s+$/.test(before)) return aPos;
  return null;
}

/** Drop the span, plus the whitespace on one side, so the join stays clean. */
function spliceSpan(text: string, start: number, end: number): string {
  let s = start;
  let e = end;
  if (e < text.length && /\s/.test(text[e])) {
    while (e < text.length && /\s/.test(text[e])) e += 1;
  } else {
    while (s > 0 && /\s/.test(text[s - 1])) s -= 1;
  }
  return text.slice(0, s) + text.slice(e);
}

export function stripInlineLetteredList(text: string): string {
  const ranges: Array<[number, number]> = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== 'A' || text[i + 1] !== '.') {
      i += 1;
      continue;
    }
    const runStart = letteredRunStart(text, i);
    if (runStart === null) {
      i += 1;
      continue;
    }
    const items: LetteredItem[] = [];
    let expected = 'A';
    let pos = i;
    for (;;) {
      const item = parseLetteredItem(text, pos, expected);
      if (!item) break;
      items.push(item);
      expected = String.fromCharCode(expected.charCodeAt(0) + 1);
      pos = item.end;
      while (pos < text.length && /\s/.test(text[pos])) pos += 1;
    }
    if (items.length < 2) {
      i += 1;
      continue;
    }
    let runEnd = items[items.length - 1].end;
    const tail = text.slice(pos);
    if (/^[A-Z]\.\s*[^.!?\n]*$/.test(tail)) runEnd = text.length;
    // A bare next-item letter rides along too: without this, the preview
    // strips the completed A/B prefix but leaves the orphan "C", which is
    // emitted and then stalls the stream when the run completes and
    // strips (Required 2 in the pre-push self-review). The final text
    // gains the same rule, so a turn cut off mid-list does not leave a
    // stray letter behind either.
    else if (tail.trimEnd() === expected) runEnd = text.length;
    ranges.push([runStart, runEnd]);
    i = runEnd;
  }
  if (ranges.length === 0) return text;
  let out = text;
  for (let k = ranges.length - 1; k >= 0; k -= 1) {
    out = spliceSpan(out, ranges[k][0], ranges[k][1]);
  }
  return out;
}

/**
 * #1067 follow-up: the UI-meta sentence the model wrote into the story
 * ('Options are not shown here; choose your next move.', DM #126). The
 * sentence must START the sentence it sits in (optionally after 'The'):
 * prose that merely mentions options mid-sentence ('You wonder what your
 * options are') is story, not meta, and survives. The whole sentence goes,
 * so a trailing '; choose your next move' clause goes with it.
 */
const META_PHRASE =
  /(?:options\s+(?:are\s+not|aren't)\s+shown\s+here|player\s+input\s+is\s+required)\b[^.!?]*[.!?]?/gi;

export function stripMetaSentence(text: string): string {
  const matches = [...text.matchAll(META_PHRASE)];
  if (matches.length === 0) return text;
  let out = text;
  for (let k = matches.length - 1; k >= 0; k -= 1) {
    const m = matches[k];
    const start = m.index;
    const end = start + m[0].length;
    const before = text.slice(0, start);
    const boundaries = [...before.matchAll(/[.!?]\s+|\n\s*|[—–]\s+/g)];
    const sentStart =
      boundaries.length > 0
        ? boundaries[boundaries.length - 1].index + boundaries[boundaries.length - 1][0].length
        : 0;
    if (!/^\s*(the\s+)?$/i.test(text.slice(sentStart, start))) continue;
    out = spliceSpan(out, sentStart, end);
  }
  return out;
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
/** Every artifact strip in one place, looped until stable (a strip can expose another behind it). */
function stripArtifacts(text: string): string {
  let strippedText = stripToolParameterBlocks(text);
  for (let i = 0; i < 4; i += 1) {
    const previous = strippedText;
    strippedText = stripInlineLetteredList(strippedText);
    strippedText = stripMetaSentence(strippedText);
    strippedText = stripProseOptionsList(strippedText);
    strippedText = stripTrackerLine(strippedText);
    strippedText = stripOptionsAppendix(strippedText);
    if (strippedText === previous) break;
  }
  return strippedText;
}

const META_PHRASES = [
  'options are not shown here',
  "options aren't shown here",
  'player input is required',
];

/**
 * #1067 follow-up: normalize a PARTIAL narration for the streaming preview
 * (`extractPartialNarration` in `llm-streaming.ts`).
 *
 * The preview must stay prefix-monotonic: `llm.ts` only emits a delta when
 * the new preview starts with what was already emitted, so removing text
 * that was already shown would stall the stream for the rest of the turn.
 * Complete artifact shapes get the same strips as the final text, and a
 * trailing shape that is still arriving is HELD BACK (cut from the
 * preview, never emitted) instead of stripped — it is released if later
 * text proves it legitimate, and the final `done` payload always carries
 * the fully normalized text. Holding only ever delays text to `done`; it
 * never deletes story.
 *
 * Held-back tails: an unterminated bracket group or `<parameter` tag, a
 * trailing bracket run whose groups could still grow into a tracker line,
 * a trailing lettered run that is lone-A or mid-item (a `B.` may still
 * arrive), and a trailing sentence that is, or could still become, the
 * meta sentence.
 */
/** End index of a complete tool argument at the start of `tail` (after
 *  whitespace), or null if the argument is still arriving. Bracket/brace
 *  arguments are scanned with depth counting that skips quoted strings;
 *  a quoted-string argument is a run of quoted strings separated by
 *  commas (TOOL_ARGUMENT_TAIL's shape, with backslash escapes tolerated).
 *  Used by the streaming preview: a complete argument followed by prose
 *  is story the final text keeps (tag removed only), so it must not be
 *  cut — cutting it freezes the stream forever, because no closing tag
 *  ever arrives and prose growth never satisfies the pure-argument test
 *  (Required 3 in the pre-push self-review). */
function leadingArgumentEnd(tail: string): number | null {
  let i = 0;
  while (i < tail.length && /\s/.test(tail[i])) i += 1;
  if (i >= tail.length) return null;
  const open = tail[i];
  if (open === '[' || open === '{') {
    const close = open === '[' ? ']' : '}';
    let depth = 0;
    let j = i;
    while (j < tail.length) {
      const ch = tail[j];
      if (ch === '"') {
        j += 1;
        while (j < tail.length && tail[j] !== '"') {
          if (tail[j] === '\\') j += 1;
          j += 1;
        }
        if (j >= tail.length) return null;
        j += 1;
        continue;
      }
      if (ch === open) depth += 1;
      else if (ch === close) {
        depth -= 1;
        if (depth === 0) return j + 1;
      }
      j += 1;
    }
    return null;
  }
  if (open === '"') {
    let j = i;
    for (;;) {
      if (tail[j] !== '"') return null;
      j += 1;
      while (j < tail.length && tail[j] !== '"') {
        if (tail[j] === '\\') j += 1;
        j += 1;
      }
      if (j >= tail.length) return null;
      j += 1;
      while (j < tail.length && /\s/.test(tail[j])) j += 1;
      if (tail[j] === ',') {
        j += 1;
        while (j < tail.length && /\s/.test(tail[j])) j += 1;
        continue;
      }
      return j;
    }
  }
  return null;
}

export function normalizePartialNarration(text: string): string {
  let out = text;
  // A dangling open tag whose tail is a partial tool argument: the final
  // strip would keep the tail (it is not yet a complete argument), and
  // emitting it would stall the stream when the block later completes and
  // strips. Cut it now — but only while the block is genuinely still
  // arriving (no complete closing tag yet) AND the tail is not already a
  // complete argument followed by prose: that prose is story the final
  // text keeps (tag removed only), so cutting it would freeze the stream
  // at the tag forever. A prose tail is story and is left alone either way.
  const openTags = [...out.matchAll(/<parameter\s+name\s*=\s*["']options["']\s*>/gi)];
  if (openTags.length > 0) {
    const last = openTags[openTags.length - 1];
    const tagAt = last.index;
    const tail = out.slice(tagAt + last[0].length);
    const blockClosed = /<\/parameter\s*>/i.test(tail);
    const argEnd = leadingArgumentEnd(tail);
    // A complete argument counts as "plus prose" only when what follows
    // it is actually prose — not a closing tag still arriving char by
    // char ("</paramete"), which must keep the hold, or the complete
    // argument leaks into the stream and stalls it when the block
    // completes and strips (caught by re-running the trace after the
    // first version of this gate).
    const afterArg = argEnd !== null ? tail.slice(argEnd).trim() : '';
    const completeArgPlusProse =
      argEnd !== null && afterArg !== '' && !/^<\/?[A-Za-z]*$/.test(afterArg);
    if (
      /^\s*[[{"]/.test(tail) &&
      !TOOL_ARGUMENT_TAIL.test(tail) &&
      !blockClosed &&
      !completeArgPlusProse
    ) {
      out = out.slice(0, tagAt).trimEnd();
    }
  }
  out = stripArtifacts(out);
  const cutAt = (index: number): void => {
    out = out.slice(0, index).trimEnd();
  };
  // Unterminated bracket group — held only while its content could
  // still become a tracker group (at most 48 chars from the tracker
  // charset, no sentence terminator or newline). Once the content
  // breaks that shape (a comma, a period, a 49th char), it can never
  // join a strip, so it is released immediately — mirroring H2's
  // malformed-group release rule. Holding it unconditionally froze the
  // stream at the bracket forever for ordinary never-closing asides
  // (Required 4 in the pre-push self-review).
  const lastBracket = out.lastIndexOf('[');
  if (lastBracket !== -1 && !out.slice(lastBracket).includes(']')) {
    const inner = out.slice(lastBracket + 1);
    if (/^(?:[A-Za-z0-9][A-Za-z0-9'’\- :/?,]{0,95})?$/.test(inner)) {
      cutAt(lastBracket);
    }
  }
  // #1289: holding the open group above can leave a closed [HP n/n] at the
  // end of the preview. Do not emit it — the final strip drops it too.
  const trailingHp =
    /\[HP\s*:?\s*\d+(?:\s*\/\s*(?:\d+|\?))?\s*\](?:\s*\[[^\]\n]{0,96}\])*\s*$/i.exec(out);
  if (trailingHp) cutAt(trailingHp.index);
  // Unterminated <parameter tag — including a tag cut mid-word
  // ('<paramete'), which a literal '<parameter' match would miss and
  // which would otherwise be emitted and stall the stream.
  const danglingTag = /(?:<parameter[^>]*|<\/?[A-Za-z]*)$/i.exec(out);
  if (danglingTag) cutAt(danglingTag.index);
  // Trailing bracket run that could still grow into a tracker line: hold
  // every group that is tracker-shaped (a malformed group can never join
  // a strip, so it is released immediately).
  const run = /((?:\[[^[\]\n]{1,96}\]\s*)+)\s*$/.exec(out);
  if (run) {
    const groups = run[1].match(/\[[^[\]\n]{1,96}\]/g) ?? [];
    if (groups.length > 0 && groups.every((group) => TRACKER_GROUP.test(group.slice(1, -1)))) {
      cutAt(run.index);
    }
  }
  // Trailing lettered run that is still arriving: hold it (a `B.` may
  // still arrive). A scanner, not a regex, because the unresolved shapes
  // are partial: a bare next-item letter ('...hollow. B'), a partial next
  // item ('...hollow. B. Hid'), a lone `A.` item, or a partial first item
  // ('A. Ra'). A complete sequential run is already stripped above, and a
  // run followed by prose is resolved — both are released, never held, so
  // the preview converges to the final text.
  for (let pos = out.length - 2; pos >= 0; pos -= 1) {
    if (out[pos] !== 'A' || out[pos + 1] !== '.') continue;
    let runStart: number | null = letteredRunStart(out, pos);
    if (runStart === null) {
      const label = /(["']?options["']?\s*:\s*)$/i.exec(out.slice(0, pos));
      if (label) runStart = pos - label[1].length;
    }
    if (runStart === null) continue;
    const items: LetteredItem[] = [];
    let expected = 'A';
    let p = pos;
    for (;;) {
      const item = parseLetteredItem(out, p, expected);
      if (!item) break;
      items.push(item);
      expected = String.fromCharCode(expected.charCodeAt(0) + 1);
      p = item.end;
      while (p < out.length && /\s/.test(out[p])) p += 1;
    }
    if (items.length === 0) {
      // Partial first item running to the end of the text.
      if (/^A\.\s*[^.!?\n]*$/.test(out.slice(pos))) cutAt(runStart);
      break;
    }
    const rest = out.slice(p);
    if (rest === '') {
      if (items.length === 1) cutAt(runStart);
      break;
    }
    if (rest === expected) {
      cutAt(runStart);
      break;
    }
    if (new RegExp(`^${expected}\\.\\s*[^.!?\\n]*$`).test(rest)) {
      cutAt(runStart);
      break;
    }
    break;
  }
  // A bare trailing 'A' at a run start (boundary or options label) is a
  // list that has not spelled its period yet: hold the single letter, or
  // it is emitted and the stream stalls when 'A.' arrives and the run
  // holdback cuts it back out. A following letter releases it (a word,
  // not a list); a following period routes it into the scanner above.
  const bareA = /(?:^|[.!?]\s+|\n\s*|—\s+|–\s+|["']?options["']?\s*:\s*)A$/.exec(out);
  if (bareA) cutAt(bareA.index + bareA[0].length - 1);
  // Trailing sentence that is, or could still become, the meta sentence.
  // The meta sentence may start with an optional "The " (mirroring
  // stripMetaSentence's (the\s+)?), so the test must also hold a bare
  // "The" / "The " prefix: without it, "The " is emitted and the stream
  // stalls the moment the meta sentence completes and the final strip
  // first applies (Required 1 in the pre-push self-review).
  const sentenceBounds = [...out.matchAll(/[.!?][ \t]+|\n|—[ \t]+|–[ \t]+/g)];
  const sentStart =
    sentenceBounds.length > 0
      ? sentenceBounds[sentenceBounds.length - 1].index +
        sentenceBounds[sentenceBounds.length - 1][0].length
      : 0;
  const tail = out.slice(sentStart).trimStart().toLowerCase();
  const unthe = tail.replace(/^the\s+/, '');
  const isMetaPrefix = (s: string): boolean =>
    META_PHRASES.some(
      (phrase) => phrase.startsWith(s) || s.startsWith(phrase) || `the ${phrase}`.startsWith(s),
    );
  if (tail.length > 0 && (isMetaPrefix(tail) || isMetaPrefix(unthe))) {
    cutAt(sentStart);
  }
  return out;
}

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
          staged.options = value.filter((option): option is string => typeof option === 'string');
        }
        continue;
      }
      if (isEmptyValue(staged[key])) staged[key] = value;
    }
    text = inner.text as string;
    inner = nestedReplyEnvelope(text);
  }

  const narration = text;
  const strippedText = stripArtifacts(text);
  const stripped = strippedText !== text;
  text = strippedText;

  // Fail open: an ugly reply beats an empty one (a dead-end by the playtest
  // criteria) — and a reply whose narration vanished must not keep rescued
  // options or mechanics either. #1289: restoring a tracker-only reply put
  // the model's [HP n/n] back on screen. Drop those HP groups instead.
  if (text.trim() === '' && originalText.trim() !== '') {
    const kept = withoutTrailingHp(narration).trim();
    if (kept === narration.trim()) return null;
    text = kept || '…';
  }
  if (!unwrapped && !stripped) return null;

  staged.text = text;
  Object.assign(envelope, staged);
  return unwrapped && stripped ? 'unwrapped+stripped' : unwrapped ? 'unwrapped' : 'stripped';
}
