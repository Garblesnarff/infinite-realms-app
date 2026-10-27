/**
 * #1042: the campaign's story clocks live in the engine. Before this module,
 * a one-shot's Clock existed only in the DM's prose (Hetzner's audit of the
 * live `campaign_rules`: 14 of 18 campaigns carry one clock each, and the
 * limit is only ever the highest "reaches N" row). The DM could fill the
 * Clock and nothing in the engine moved — #1020 gave the ending a field
 * (`campaign_ending`), but the DM still had to notice the filled clock
 * itself, and #1034's ending fires only on that declaration.
 *
 * The DM now reports clock movement as `tracker_changes` on its reply
 * (`{name, delta}` or `{name, set}` — two of the four tick rules in the
 * audit set a value rather than adding). This module stores each clock per
 * session (`session_trackers`, migration 0030), renders the tracker line
 * the DM shows from that stored state, and enforces the limit:
 *
 * - `at_limit: 'climax'` (the default; 12 of the 14 audited clocks start
 *   their climax at the limit rather than ending the story): the session
 *   phase becomes climax, and the next prompt carries the climax directive.
 * - `at_limit: 'ending'`: the ending is forced through `applyStoryEnding`
 *   (#1034's path, with its own one-shot and claim guards).
 *
 * Safety net: a climax that runs 6 player turns with no declared ending
 * makes the next prompt require the ending — and the requirement is a
 * real request, not only a prompt line (strategist FIX, PR #1053): if
 * the reply to the ending-required turn still declares no ending, the
 * route makes one more generate call with the ending required
 * (`enforceRequiredEnding`), and if that reply also fails, the ending
 * is forced with an engine-written summary. A one-shot can never run on
 * forever.
 *
 * Final beat (Hark N23-003): the climax can resolve in prose while the
 * Clock sits at 1/6 — no clock ever fills, so no clock-driven net arms.
 * The DM therefore flags the turn that plays the campaign's final beat
 * (`final_beat_reached` on the reply); the tracker step arms the same
 * ending-required state for the next turn, and the same enforcement
 * chain ends the adventure if the ending is still not declared.
 *
 * A clock's definition comes from the campaign's rules: `campaign_rules`
 * rows (rule_type 'causality', on the session's starter campaign) whose
 * condition is exactly "the <Name> Clock reaches <N>" — the audit's
 * parseable shape. `limit` is the row metadata's `limit` when Campaign
 * Claude has written it, else the highest reaches-N for that name;
 * `at_limit` is the metadata's, else 'climax'. A change naming no defined
 * clock is logged and skipped: the engine enforces only clocks it can
 * define.
 *
 * Changes in one reply apply in order; two entries naming the same clock
 * stack (the reply's list is the DM's record of the turn's ticks). The
 * route calls this step on turns the directive load flagged (a phase in
 * progress, an ending owed); if that load itself fails, a change-less
 * turn is not counted — the applier would face the same failing database,
 * and /generate deliberately does no unconditional tracker read.
 *
 * Once per player message, like the other story appliers: Retry replays
 * the saved player message, and `session_state.tracker.lastMessageId`
 * records the message the step last processed, inside the same transaction
 * that locks the session row — a replay applies nothing twice, and the
 * climax turn count counts player messages, not requests. The `tracker`
 * key is engine-owned inside a client-written blob, so
 * `SessionService.updateSession` preserves it across whole-blob client
 * writes (`trackerPreservingState` below), exactly as #975/#913 preserve
 * the Action Surge mark and the pending combat entry.
 *
 * The database client stays inside the functions, as in story-ending.ts:
 * the pure tests run outside the real-DB suite, and /generate's route
 * contract tests load this module without an application database. The
 * schema table and `sql` below are definitions only (no connection),
 * imported at top level for the preservation expression, as in
 * pending-combat-entry.ts.
 */

import { sql, type SQL } from 'drizzle-orm';

import { gameSessions } from '../../../../db/schema/index';
import { logger } from '../../lib/logger.js';

export interface TrackerChange {
  name: string;
  delta?: number;
  set?: number;
}

export interface ClockDefinition {
  /** Display name as the rules write it, e.g. "Sunset" for the Sunset Clock. */
  name: string;
  limit: number;
  atLimit: 'climax' | 'ending';
}

/** The tracker phase state stored at `session_state.tracker`. */
export interface TrackerPhaseState {
  phase: 'climax';
  /** Display name of the clock that reached its limit. */
  clock: string;
  /** Player turns counted since the climax began (the limit turn is 0). */
  climaxTurns: number;
  /** Set once 6 climax turns pass with no declared ending. */
  endingRequired: boolean;
  /**
   * The ending was required by the final-beat trigger rather than the
   * climax turn count: the DM flagged the final beat, so the ending is
   * required from the next turn regardless of the clock's value.
   */
  finalBeat?: boolean;
  /**
   * The climax was entered by the one-shot pacing budget (#1083), not by
   * a clock reaching its limit: the phase's clock label names the first
   * defined clock (or 'Final beat'), but the limit was never reached, so
   * the directive and the engine-written ending say the budget forced it.
   */
  budgetForced?: boolean;
  /** The last player message this step processed (once-per-message guard). */
  lastMessageId: string | null;
}

/** Player turns a climax may run before the ending is required. */
export const CLIMAX_TURN_LIMIT = 6;

/**
 * #1083: the one-shot pacing budget, in player turns. A one-shot is meant
 * to take one session; Hark's S-003/S-004 run drifted to 159 DM turns with
 * the clock at 3/6 and no final beat flagged, so no #1053 net ever armed.
 * The budget is the issue's example number, fixed: `estimated_sessions`
 * is session-granularity free text ("8-10", "One-shot — 1 session") and
 * cannot yield a turn budget without inventing a turns-per-session
 * constant, so the number itself is the strategist's to calibrate.
 */
export const ONE_SHOT_TURN_BUDGET = 60;

/** Fraction of the budget at which the pacing directive fires (#1083). */
export const PACING_DIRECTIVE_FRACTION = 0.75;

/** The turn budget for a campaign length, or null when unbounded. */
export function pacingBudgetFor(campaignLength: string | null): number | null {
  return campaignLength === 'one-shot' ? ONE_SHOT_TURN_BUDGET : null;
}

/** First turn the pacing directive fires, from the budget. */
export function pacingDirectiveTurn(budget: number): number {
  return Math.ceil(budget * PACING_DIRECTIVE_FRACTION);
}

/**
 * A change is one clock, named, moving by a whole number of segments (or
 * set to one). The array is capped: a campaign carries a handful of clocks
 * at most (one each in the audit), and an unbounded model-supplied array
 * would hold the session-row lock through a SELECT+UPSERT per entry. The
 * values themselves are clamped to the clock's own range when applied —
 * bounds deliberately live here, not in the JSON schema, whose numeric
 * keywords are budget-gated (#782).
 */
export const MAX_TRACKER_CHANGES = 8;

export function validTrackerChanges(changes: unknown): changes is TrackerChange[] {
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > MAX_TRACKER_CHANGES) {
    return false;
  }
  return changes.every((change) => {
    if (!change || typeof change !== 'object') return false;
    const { name, delta, set } = change as TrackerChange;
    if (typeof name !== 'string' || name.trim().length === 0) return false;
    const hasDelta = delta !== undefined;
    const hasSet = set !== undefined;
    if (hasDelta === hasSet) return false; // exactly one of delta / set
    const value = hasDelta ? delta : set;
    return typeof value === 'number' && Number.isInteger(value);
  });
}

/** "Sunset", "sunset clock" and "the Sunset Clock" are the same clock to the engine. */
export function normalizeClockName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/^the\s+/, '')
    .replace(/\s+clock$/, '');
}

const CLOCK_CONDITION = /^\s*the\s+(.+?)\s+clock\s+reaches\s+(\d+)\s*$/i;

/**
 * Words that can precede "Clock" in prose without naming it ("at Clock 6",
 * "the Clock runs out"): a "name" captured from one of these is no name —
 * the reference is to the campaign's clock generically.
 */
const GENERIC_CLOCK_WORDS = new Set([
  'the',
  'a',
  'an',
  'at',
  'on',
  'in',
  'of',
  'to',
  'when',
  'until',
  'before',
  'after',
  'this',
  'that',
  'its',
]);

const NAMED_CLOCK_MENTION = /([A-Za-z][\w'-]*)\s+clock\b/i;
const NAMED_COUNTER_MENTION = /([A-Za-z][\w'-]*)\s+counter\b/i;
/**
 * Number words the veto scan recognizes (#1068): a limit written as a
 * word ("becomes full at six") states a value just as surely as a digit,
 * so it must trip the fail-closed rule the same way. One through twenty
 * covers the audit's clocks; larger forms stay unparsed (no veto from
 * this scan, as with any other unparseable row text). A hyphenated form
 * parses as its first component ("twenty-one" reads 20). A veto fired
 * on that reading is sound (the true value is larger still), but the
 * reading can MISS a veto when the first component equals the clean
 * limit exactly (clean limit 20 vs "twenty-one": parsed 20 is not above
 * 20, so no veto, though the true 21 is). Compounds stay unparsed by
 * design; this comment no longer claims otherwise.
 */
const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
};
// Longest-first, so a teen word never matches its unit prefix ("fourteen"
// must not read as "four"); the trailing \b is the second guard — after a
// unit match the teen's next letter is a word character, so the boundary
// fails and the engine backtracks to the full word. Digits first is fine:
// digits and letters are disjoint.
const NUMBER_WORD_PATTERN = Object.keys(NUMBER_WORDS)
  .sort((a, b) => b.length - a.length)
  .join('|');
/** A clock value stated in prose: "reaches 6", "jumps to 6", "set to 5", "Clock 6" — or any of those with the value as a word, plus "becomes full at six". */
const CLOCK_VALUE_REF = new RegExp(
  `(?:reaches|jumps to|sets? to|becomes full at)\\s+(\\d+|${NUMBER_WORD_PATTERN})\\b|\\bclock\\s+(\\d+|${NUMBER_WORD_PATTERN})\\b`,
  'gi',
);

/** A veto-scan value token as a number: digits parse directly, words look up. */
function parseClockValueToken(token: string): number | null {
  if (/^\d+$/.test(token)) return Number.parseInt(token, 10);
  return NUMBER_WORDS[token.toLowerCase()] ?? null;
}

/**
 * Does rules text (a non-clean condition, or any row's effect) tie a
 * clock value HIGHER than `candidate` to the clock `clockKey` (or to a
 * generic, unnamed clock)? The audit's two
 * unparseable campaigns are the shape: held-rest's Score has clean rows
 * only to 5, while 6 appears in a "jumps to 6" tick row and a compound
 * "reaches 6 and …" ending row; last-true-blue's Fade is the same with
 * clean rows to 5. Reading the limit as 5 would climax those campaigns
 * one segment early, so a higher value the row ties to this clock makes
 * the prose limit uncertain — fail closed (strategist FIX, PR #1053).
 *
 * Attribution is by clause: a row's clauses (split on commas, semicolons,
 * "and", "or") inherit the clock the previous clause named, so "the
 * Score Clock reaches 5 for the third time or reaches 6 and the hero
 * never offers a phrase" ties its 6 to Score, while the sown-field row's
 * "the Setback counter reaches 6 and the Dawn Clock is set to 5" ties
 * its 6 to the Setback counter — not to Dawn, whose own clean rows reach
 * 6 and whose limit therefore stands. A value no clause attributes to
 * any named clock or counter counts generically: fail closed.
 */
export function referencesHigherClockValue(
  text: string,
  clockKey: string,
  candidate: number,
): boolean {
  // A multi-word clock name ("True Blue") defeats the single-word mention
  // patterns below; a clause that names this clock in full is attributed
  // directly.
  const fullNameMention = new RegExp(
    `\\b${clockKey.replace(/[.*+?^${'{}'}()|[\]\\]/g, '\\$&')}\\s+clock\\b`,
    'i',
  );
  let subject: string | null = null;
  for (const clause of text.split(/[,;]|\band\b|\bor\b/)) {
    const clockMention = NAMED_CLOCK_MENTION.exec(clause);
    const counterMention = NAMED_COUNTER_MENTION.exec(clause);
    let clauseSubject: string | null = null;
    if (fullNameMention.test(clause)) {
      clauseSubject = clockKey;
    } else if (clockMention && (!counterMention || clockMention.index <= counterMention.index)) {
      const name = clockMention[1].toLowerCase();
      clauseSubject = GENERIC_CLOCK_WORDS.has(name) ? 'generic' : normalizeClockName(name);
    } else if (counterMention) {
      clauseSubject = `counter:${counterMention[1].toLowerCase()}`;
    } else if (/\bclock\b/i.test(clause)) {
      clauseSubject = 'generic';
    }
    if (clauseSubject !== null) subject = clauseSubject;
    for (const match of clause.matchAll(CLOCK_VALUE_REF)) {
      const value = parseClockValueToken(match[1] ?? match[2]);
      if (
        value !== null &&
        value > candidate &&
        (subject === null || subject === 'generic' || subject === clockKey)
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * The clock definitions in a campaign's rules rows: the audit's parseable
 * shape — a causality condition that is exactly "the <Name> Clock reaches
 * <N>". `limit`/`at_limit` come from row metadata when present (Campaign
 * Claude writes them per the revised spec); the limit falls back to the
 * highest reaches-N for the name, `at_limit` to 'climax'.
 *
 * The prose fallback fails closed: when no metadata states the limit and
 * other row text ties a HIGHER value to the clock — a non-parseable
 * condition, or ANY row's effect (a clean "reaches 5" row whose effect
 * says the clock reaches 6 when the wedge is pulled states the higher
 * value just as surely) — the limit is uncertain and the clock is not
 * defined at all: the engine enforces only a limit a rule states
 * clearly. A metadata limit is never vetoed: it is stated, not inferred.
 */
/** Clocks whose uncertain prose limit has already been logged this process. */
const uncertainLimitLogged = new Set<string>();

export function parseClockDefinitions(
  rows: Array<{ condition: string; metadata: unknown; effect?: string | null }>,
): ClockDefinition[] {
  // Order-independent on purpose: the rules load carries no ORDER BY, so
  // the same rows in any order must define the same clocks. Per clock, the
  // metadata limit stated on the row with the highest reaches-N wins (any
  // metadata limit beats the prose fallback, the highest reaches-N);
  // `at_limit: 'ending'` stated on any row wins over 'climax' — it is the
  // stronger behavior, and conflicting rows are a content error the engine
  // resolves toward ending the story rather than stalling it.
  interface Accumulator {
    name: string;
    highestReached: number;
    limitAtHighest: number | null;
    anyMetaLimit: number | null;
    ending: boolean;
  }
  const byKey = new Map<string, Accumulator>();
  const vetoScanTexts: string[] = [];
  for (const row of rows) {
    const match = CLOCK_CONDITION.exec(row.condition ?? '');
    if (!match) {
      vetoScanTexts.push(`${row.condition ?? ''} ${row.effect ?? ''}`);
      continue;
    }
    // A parseable condition states its own value exactly, so it cannot
    // hide a higher one; its EFFECT still can, and is scanned like any
    // other row text.
    if (row.effect) vetoScanTexts.push(row.effect);
    const name = match[1].trim();
    const reached = Number.parseInt(match[2], 10);
    const key = normalizeClockName(name);
    const metadata = (row.metadata ?? {}) as { limit?: unknown; at_limit?: unknown };
    const metaLimit =
      typeof metadata.limit === 'number' && Number.isInteger(metadata.limit) && metadata.limit > 0
        ? metadata.limit
        : null;
    let acc = byKey.get(key);
    if (!acc) {
      acc = {
        name,
        highestReached: reached,
        limitAtHighest: metaLimit,
        anyMetaLimit: metaLimit,
        ending: false,
      };
      byKey.set(key, acc);
    } else {
      if (reached > acc.highestReached) {
        acc.highestReached = reached;
        acc.limitAtHighest = metaLimit;
      }
      if (metaLimit !== null && acc.anyMetaLimit === null) acc.anyMetaLimit = metaLimit;
    }
    if (metadata.at_limit === 'ending') acc.ending = true;
  }
  const definitions: ClockDefinition[] = [];
  for (const [key, acc] of byKey) {
    const metaLimit = acc.limitAtHighest ?? acc.anyMetaLimit;
    if (
      metaLimit === null &&
      vetoScanTexts.some((text) => referencesHigherClockValue(text, key, acc.highestReached))
    ) {
      // The prose rows disagree about this clock's extent: the clean
      // rows stop at one value, other row text ties a higher one to the
      // same clock. No definition — the campaign keeps the pre-#1042
      // behavior (the DM's prose alone) until its rules state the limit
      // in metadata. Logged once per clock per process: this parser runs
      // on every DM turn (directive load and applier alike), and a warn
      // per turn would bury the signal it exists to carry.
      if (!uncertainLimitLogged.has(key)) {
        uncertainLimitLogged.add(key);
        logger.warn({
          msg: 'DM_STORY_TRACKER_LIMIT_UNCERTAIN',
          clock: acc.name,
          cleanLimit: acc.highestReached,
        });
      }
      continue;
    }
    definitions.push({
      name: acc.name,
      limit: metaLimit ?? acc.highestReached,
      atLimit: acc.ending ? 'ending' : 'climax',
    });
  }
  return definitions;
}

/**
 * The <story_clock> directive for one turn, from stored state: the tracker
 * lines the DM renders (server values, never the DM's own count), the
 * climax announcement on the first climax turn, and the ending-required
 * line once the safety net has tripped. Null when there is nothing to say.
 */
export function trackerDirectiveText(input: {
  trackers: Array<{ name: string; value: number; limit: number }>;
  phase: TrackerPhaseState | null;
  /**
   * The session campaign's length. The ending directive is one-shot-only
   * (#1068): the ending applier completes one-shots alone, so on any
   * other campaign every campaign_ending instruction — the MUST lines,
   * the countdown, and the soft "declare when the story completes"
   * sentence — is a claim the engine itself refuses (it nulls the
   * field, but the DM's ending narration is not dropped). Absent (or
   * anything but 'one-shot') the climax renders with no ending
   * instruction at all — the fail-safe default, never a claim that
   * does not hold. A flag-triggered (finalBeat) shape likewise never
   * claims a filled clock: the trigger was the DM's flag, not the limit.
   */
  campaignLength?: string | null;
  /**
   * #1083 pacing state, from the directive load's player-message count.
   * Renders only while no climax phase exists: once the budget forces the
   * climax, the climax lines below supersede it. The server decides WHEN
   * (turn count vs budget); the model still narrates the move.
   */
  pacing?: { turns: number; budget: number; clockName: string | null } | null;
  /** #1091: an encounter is active; the climax and pacing lines wait. */
  inCombat?: boolean;
}): string | null {
  const lines: string[] = [];
  const phase = input.phase;
  for (const tracker of input.trackers) {
    // #1170: the phase's own clock line shows "Climax" when the phase changes,
    // so the DM reads the phase off the line itself. A phase whose clock is
    // not among the trackers (a budget-forced 'Final beat' with no defined
    // clock) leaves the lines unchanged; the climax lines below carry it.
    const marker =
      phase?.phase === 'climax' &&
      normalizeClockName(tracker.name) === normalizeClockName(phase.clock)
        ? ' — Climax'
        : '';
    lines.push(`- ${tracker.name} Clock: ${tracker.value}/${tracker.limit}${marker}`);
  }
  const oneShot = input.campaignLength === 'one-shot';
  // #1091: mid-fight, the climax, ending and pacing lines wait for the
  // fight to end; the clock lines still render.
  const combatHold =
    input.inCombat === true &&
    (phase?.phase === 'climax' ||
      (!phase && !!input.pacing && input.pacing.turns >= pacingDirectiveTurn(input.pacing.budget)));
  if (combatHold) {
    lines.push(
      'Combat is under way: resolve the fight first; the story’s climax and ending wait until it is over.',
    );
  }
  if (!combatHold && phase?.phase === 'climax') {
    // Fail safe on the declared length, never on a stored phase flag:
    // the campaignLength doc says absent or non-'one-shot' lengths fail
    // safe, and a stored budget phase can outlive a campaign_length edit,
    // so budgetForced alone must not buy the final-beat MUST line (#1068
    // verdict round 6). #1083's budget-forced directive tests declare
    // their campaignLength: 'one-shot' explicitly instead. Round 7
    // extends the same gate to the budget lines below: under a
    // non-one-shot length a stored budget phase renders the non-required
    // wording, never a MUST/declare line (verdict round 7).
    if (phase.endingRequired && phase.finalBeat && oneShot) {
      lines.push(
        'The story has reached its final beat and the ending was not declared — ' +
          'the ending is required: you MUST set campaign_ending in this reply and ' +
          'narrate the ending.',
      );
    } else if (phase.endingRequired && phase.budgetForced && oneShot) {
      lines.push(
        `The one-shot's turn budget is reached and the climax has run ${CLIMAX_TURN_LIMIT} turns ` +
          'without the ending being declared — the ending is required: you MUST set ' +
          'campaign_ending in this reply and narrate the ending.',
      );
    } else if (phase.endingRequired && oneShot) {
      lines.push(
        `The ${phase.clock} Clock reached its limit and the climax has run ${CLIMAX_TURN_LIMIT} turns ` +
          'without the ending being declared — the ending is required: you MUST set ' +
          'campaign_ending in this reply and narrate the ending.',
      );
    } else if (phase.climaxTurns === 0 && phase.budgetForced && oneShot) {
      // #1170: the entry turn must SHOW the climax in the story, not only
      // name it — the Last Toll run's DM kept asking questions at 2/6
      // while the budget-forced climax sat invisible in the prompt.
      lines.push(
        'The one-shot’s turn budget is reached — the climax is now. Show it in this ' +
          'reply: move the clock, raise the stakes, put the final beat on the page — ' +
          'do not carry on asking questions as if nothing changed. Drive the story ' +
          'to its final beats and declare campaign_ending when the story completes.',
      );
    } else if (phase.climaxTurns === 0) {
      if (oneShot) {
        lines.push(
          `The ${phase.clock} Clock has reached its limit — the climax is now. Drive the story ` +
            'to its final beats and declare campaign_ending when the story completes.',
        );
      } else if (phase.finalBeat) {
        lines.push('The story has reached its final beat. Drive the story to its final beats.');
      } else {
        lines.push(
          `The ${phase.clock} Clock has reached its limit — the climax is now. Drive the story ` +
            'to its final beats.',
        );
      }
    } else if (phase.budgetForced && oneShot) {
      lines.push(
        `The story is in its budget-forced climax (turn ${phase.climaxTurns} of ` +
          `${CLIMAX_TURN_LIMIT} before the ending is required). Declare campaign_ending ` +
          'when the story completes.',
      );
    } else if (oneShot) {
      lines.push(
        `The story is in its climax (the ${phase.clock} Clock reached its limit, turn ` +
          `${phase.climaxTurns} of ${CLIMAX_TURN_LIMIT} before the ending is required). ` +
          'Declare campaign_ending when the story completes.',
      );
    } else if (phase.finalBeat) {
      lines.push('The story is in its climax. Drive the story to its final beats.');
    } else {
      lines.push(
        `The story is in its climax (the ${phase.clock} Clock reached its limit). ` +
          'Drive the story to its final beats.',
      );
    }
  }
  const pacing = input.pacing;
  if (!combatHold && !phase && pacing && pacing.turns >= pacingDirectiveTurn(pacing.budget)) {
    const clockRef = pacing.clockName ? `the ${pacing.clockName} Clock` : 'the story clock';
    lines.push(
      `The story is at turn ${pacing.turns} of ${pacing.budget} in this one-shot — move ` +
        `toward the climax: advance ${clockRef} and bring in the final beat.`,
    );
  }
  if (lines.length === 0) return null;
  return (
    '<story_clock>\n' +
    'Engine story clock state (server truth — never from your own count). The game UI ' +
    'shows the tracker line from these values (#1062), so do NOT render a tracker line ' +
    'in your prose. When the story ticks a clock, report it in tracker_changes. ' +
    'If one reply moves a clock by more than one segment — two tracker_changes ' +
    'entries for the same clock, or one entry with a delta larger than one — ' +
    'say how many segments in your prose (e.g. "the Sunset Clock ticks forward ' +
    'two segments"): the UI shows only the final value (#1161), so an unnumbered ' +
    '"ticks forward" leaves the reader unable to follow a jump.\n' +
    lines.join('\n') +
    '\n</story_clock>'
  );
}

/**
 * The stored trackers as the player sees them: every defined clock renders
 * from turn one (a defined-but-untouched clock shows its start value, so a
 * second clock never vanishes from the line once the first one moves), and
 * a stored row whose rule was edited away still renders — it is engine
 * state the DM already played against. Shared by the directive load and
 * the #1062 envelope read so the two can never disagree about the line.
 */
export function mergeStoredTrackers(
  definitions: ClockDefinition[],
  stored: Array<{ name: string; value: number; limit: number }>,
): Array<{ name: string; value: number; limit: number }> {
  const storedByKey = new Map(stored.map((tracker) => [normalizeClockName(tracker.name), tracker]));
  const trackers = definitions.map((definition) => {
    const row = storedByKey.get(normalizeClockName(definition.name));
    return row ?? { name: definition.name, value: 0, limit: definition.limit };
  });
  for (const tracker of stored) {
    if (!definitions.some((d) => normalizeClockName(d.name) === normalizeClockName(tracker.name))) {
      trackers.push(tracker);
    }
  }
  return trackers;
}

interface TrackerState {
  definitions: ClockDefinition[];
  trackers: Array<{ name: string; value: number; limit: number }>;
  phase: TrackerPhaseState | null;
  campaignLength: string | null;
  starterCampaignId: string | null;
  /**
   * The session's last client-written scene description (free text).
   * It is NOT the flagged turn's scene: nothing in the /generate path
   * updates this column during a DM turn, so it lags at least a turn
   * and is commonly null. It rides along as the only server-side
   * "where is the party" field, labelled honestly — a real per-turn
   * location would need a server-written scene first (see Friction).
   */
  currentSceneDescription: string | null;
  /**
   * #1083: player messages in the session (the pacing budget's turn unit),
   * counted only when the caller asks — the directive load needs it, the
   * envelope read does not, and non-one-shots never pay for the COUNT.
   */
  playerTurns: number;
}

/** The session's clock definitions, stored trackers and phase — owner-scoped. */
async function loadTrackerState(
  sessionId: string,
  userId: string,
  options?: { countTurns?: boolean },
): Promise<TrackerState | null> {
  const { db } = await import('../../../../db/client');
  const { and, eq } = await import('drizzle-orm');
  const { campaigns, campaignRules, dialogueHistory, gameSessions, sessionTrackers } =
    await import('../../../../db/schema/index');
  const [session] = await db
    .select({
      starterCampaignId: gameSessions.starterCampaignId,
      sessionState: gameSessions.sessionState,
      campaignLength: campaigns.campaignLength,
      currentSceneDescription: gameSessions.currentSceneDescription,
    })
    .from(gameSessions)
    .innerJoin(campaigns, eq(campaigns.id, gameSessions.campaignId))
    .where(and(eq(gameSessions.id, sessionId), eq(campaigns.userId, userId)))
    .limit(1);
  if (!session) return null;

  let definitions: ClockDefinition[] = [];
  if (session.starterCampaignId) {
    const rows = await db
      .select({
        condition: campaignRules.condition,
        metadata: campaignRules.metadata,
        effect: campaignRules.effect,
      })
      .from(campaignRules)
      .where(
        and(
          eq(campaignRules.campaignId, session.starterCampaignId),
          eq(campaignRules.ruleType, 'causality'),
        ),
      );
    definitions = parseClockDefinitions(rows);
  }
  const trackers = await db
    .select({
      name: sessionTrackers.name,
      value: sessionTrackers.value,
      limit: sessionTrackers.limit,
    })
    .from(sessionTrackers)
    .where(eq(sessionTrackers.sessionId, sessionId));
  const stored = (session.sessionState as { tracker?: TrackerPhaseState } | null)?.tracker;
  // #1083: the pacing budget counts player messages, not requests — the
  // same unit the climax count uses, and retry-stable (a Retry replays
  // the saved player message, it inserts no new one). gameSessions'
  // turnCount is NOT the unit: it counts inserted messages of every
  // speaker type.
  // #1091: count typed player turns only (exclude dice-roll answers).
  let playerTurns = 0;
  if (options?.countTurns && session.campaignLength === 'one-shot') {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(dialogueHistory)
      .where(
        and(
          eq(dialogueHistory.sessionId, sessionId),
          eq(dialogueHistory.speakerType, 'player'),
          sql`coalesce(${dialogueHistory.context}->>'intent', '') <> 'dice_roll'`,
        ),
      );
    playerTurns = count;
  }
  return {
    definitions,
    trackers,
    phase: stored?.phase === 'climax' ? stored : null,
    campaignLength: session.campaignLength,
    starterCampaignId: session.starterCampaignId,
    currentSceneDescription: session.currentSceneDescription,
    playerTurns,
  };
}

/**
 * The pre-generation read: the <story_clock> directive for this turn, or
 * null. Fails open like the other directive resolvers in /generate — a
 * tracker read must never cost the player their turn. `trackers` is the
 * merged list the directive text renders (definitions at 0 where untouched,
 * plus orphan stored rows); the route reuses it for the #1062 envelope on
 * turns the tracker step does not run, so no second read is needed.
 */
export async function loadStoryTrackerDirective(input: {
  sessionId: string;
  userId: string;
}): Promise<{
  text: string | null;
  phase: TrackerPhaseState | null;
  endingAtLimit: boolean;
  /** The session campaign's length; the route's ending enforcement is one-shot-only. */
  campaignLength: string | null;
  /** The merged tracker list the directive renders, or null when unread. */
  trackers: Array<{ name: string; value: number; limit: number }> | null;
  /** #1083 pacing state (one-shots only), or null when unbounded/unread. */
  pacing: { turns: number; budget: number } | null;
}> {
  try {
    const state = await loadTrackerState(input.sessionId, input.userId, { countTurns: true });
    if (!state)
      return {
        text: null,
        phase: null,
        endingAtLimit: false,
        campaignLength: null,
        trackers: null,
        pacing: null,
      };
    const trackers = mergeStoredTrackers(state.definitions, state.trackers);
    const storedByKey = new Map(
      state.trackers.map((tracker) => [normalizeClockName(tracker.name), tracker]),
    );
    // An `at_limit: 'ending'` clock already at its limit means a forced
    // ending was owed and not delivered (the fire is level-triggered in
    // the applier): the route runs the tracker step on this turn too, so
    // the ending is re-asserted until the session completes.
    const endingAtLimit = state.definitions.some((definition) => {
      if (definition.atLimit !== 'ending') return false;
      const stored = storedByKey.get(normalizeClockName(definition.name));
      return stored !== undefined && stored.value >= definition.limit;
    });
    const budget = pacingBudgetFor(state.campaignLength);
    const pacing = budget !== null ? { turns: state.playerTurns, budget } : null;
    let inCombat = false;
    if (state.campaignLength === 'one-shot') {
      try {
        const { CombatEncounterService } = await import('../combat/combat-encounter-service.js');
        const encounter = await CombatEncounterService.getActiveEncounter(
          input.sessionId,
          input.userId,
        );
        inCombat = !!encounter;
      } catch {
        inCombat = false;
      }
    }
    const text = trackerDirectiveText({
      trackers,
      phase: state.phase,
      campaignLength: state.campaignLength,
      pacing: pacing ? { ...pacing, clockName: state.definitions[0]?.name ?? null } : null,
      inCombat,
    });
    // #1170: one grep-able line per pacing event, with the typed-turn
    // number, so the budget's course can be counted from prod logs. The
    // directive line fires on every turn the pacing line renders (turns
    // 45-59); the first line's turn is the directive turn. Combat-held
    // turns do not log: the DM was not told on those turns. The condition
    // mirrors the pacing branch in trackerDirectiveText exactly.
    if (
      pacing &&
      !state.phase &&
      !inCombat &&
      pacing.turns >= pacingDirectiveTurn(pacing.budget)
    ) {
      logger.info({ msg: `DM_PACING directive turn=${pacing.turns}`, sessionId: input.sessionId });
    }
    return {
      text,
      phase: state.phase,
      endingAtLimit,
      campaignLength: state.campaignLength,
      trackers,
      pacing,
    };
  } catch (error) {
    logger.warn({ msg: 'DM_STORY_TRACKER_DIRECTIVE_FAILED', sessionId: input.sessionId, error });
    return {
      text: null,
      phase: null,
      endingAtLimit: false,
      campaignLength: null,
      trackers: null,
      pacing: null,
    };
  }
}

/**
 * #1062: the stored trackers for the reply envelope, read AFTER the
 * tracker step applied this turn — the post-apply values, never the
 * directive-load values (those lag one turn on exactly the turns that
 * move the clock). The route calls this only on turns the tracker step
 * ran, so /generate gains no unconditional tracker read. Null when the
 * session is unknown or the read fails: the envelope then carries no
 * field and the client keeps its last line (or none) — a failed read
 * never costs the player their turn or invents state.
 */
export async function loadStoredStoryTrackers(input: {
  sessionId: string;
  userId: string;
}): Promise<Array<{ name: string; value: number; limit: number }> | null> {
  try {
    const state = await loadTrackerState(input.sessionId, input.userId);
    if (!state) return null;
    return mergeStoredTrackers(state.definitions, state.trackers);
  } catch (error) {
    logger.warn({ msg: 'DM_STORY_TRACKER_ENVELOPE_FAILED', sessionId: input.sessionId, error });
    return null;
  }
}

/** The `session_state` key the tracker phase + once-per-message marker live at. */
export const TRACKER_STATE_KEY = 'tracker';

/**
 * Client `session_state` writes replace the blob; the tracker state is
 * engine-owned, so the live row's value wins — the same single-UPDATE
 * preservation as the Action Surge mark (#975) and the pending combat
 * entry (#913), whose SQL shape this mirrors. The validity test mirrors
 * the stored shapes field for field: an object whose `lastMessageId` is
 * a string (the marker alone pre-climax, the phase object in climax). A
 * stored valid value replaces the incoming key; without one, the
 * incoming key is stripped — a client can neither erase the phase and
 * the safety-net count nor forge them, and a wiped marker can no longer
 * let a Retry apply a turn's changes twice.
 */
export function trackerPreservingState(merged: SQL): SQL {
  const stored = sql`${gameSessions.sessionState} -> ${TRACKER_STATE_KEY}`;
  const validStored = sql`jsonb_typeof(${stored}) = 'object'
    AND jsonb_typeof(${stored} -> 'lastMessageId') = 'string'`;
  return sql`CASE WHEN ${validStored}
    THEN (${merged} - ${TRACKER_STATE_KEY}) || jsonb_build_object(${TRACKER_STATE_KEY}::text, ${stored})
    ELSE ${merged} - ${TRACKER_STATE_KEY} END`;
}

export type StoryTrackerOutcome =
  | 'applied'
  | 'already_applied'
  | 'no_changes'
  | 'invalid_changes'
  | 'no_character'
  | 'no_player_message'
  | 'roll_pending'
  | 'unknown_clock'
  | 'session_completed';

export interface StoryTrackerResult {
  outcome: StoryTrackerOutcome;
  /** Changes that landed on a stored tracker this call. */
  appliedChanges: number;
  /**
   * #1160: the reply's final-beat flag armed the ending-required state on
   * this call; the route keeps `final_beat_reached` on the envelope only
   * when it landed.
   */
  finalBeatArmed?: boolean;
  /**
   * #1084: the stored summary of an ending this call forced through
   * `applyStoryEnding` (an `at_limit: 'ending'` clock at its limit).
   * Present only when the force applied (now or earlier). The route
   * mirrors it onto the reply envelope exactly as it does a declared
   * or safety-net ending — without it the session completes but the
   * client's completion latch never fires, because the latch keys on
   * the envelope's `campaign_ending` field (Hark S-001).
   */
  forcedEndingSummary?: string;
}

/**
 * Applies one reply's `tracker_changes` (and counts the turn, in climax):
 * the post-generation step. Runs in one transaction on the locked session
 * row; the phase state and the once-per-message marker ride `session_state`
 * in the same write. A limit crossing with `at_limit: 'ending'` forces the
 * ending afterwards through `applyStoryEnding` — level-triggered, so a
 * stored ending clock at its limit re-asserts the ending on every step
 * until the session completes, and a lost fire cannot strand the session.
 */
export async function applyStoryTrackers(input: {
  userId: string;
  sessionId: string;
  changes: unknown;
  /** The reply asks for a roll: clock movement belongs to the result turn. */
  rollRequested?: boolean;
  /**
   * The turn is not a story-effects turn (combat, a combat opening): the
   * changes wait for a later turn like every other story field, but the
   * call still counts the turn toward the climax safety net and still
   * re-asserts an owed ending — a climax spent fighting is still a
   * climax, and the net must not stall behind a long fight.
   */
  changesDeferred?: boolean;
  /**
   * The reply flags the campaign's final beat (`final_beat_reached`):
   * arm the ending-required state for the next turn, whatever the clocks
   * say — Hark N23-003's run resolved its climax in prose with the Clock
   * at 1/6, so no limit ever armed the net. One-shots only, like every
   * ending force here; the flag itself is state, not a clock change, so
   * it arms even on a deferred (combat) turn.
   */
  finalBeatReached?: boolean;
}): Promise<StoryTrackerResult> {
  const { userId, sessionId } = input;
  let characterId: string | null = null;
  const done = (outcome: StoryTrackerOutcome, appliedChanges = 0): StoryTrackerResult => {
    logger.info({ msg: 'DM_STORY_TRACKER', sessionId, characterId, outcome, appliedChanges });
    return { outcome, appliedChanges };
  };

  const hasChanges = Array.isArray(input.changes) && input.changes.length > 0;
  // #1160: the tool path's normalizer (validateToolReplyText /
  // stripOptionalNulls) drops optional nulls, so a model entry like
  // {"name":"Sunset","delta":null,"set":null} becomes {"name":"Sunset"}:
  // it passes the full JSON schema (only name is required) but fails
  // validTrackerChanges (exactly one of delta/set). An invalid list still
  // lands no changes, but it must not cancel the climax turn count, the
  // final-beat arm, the owed-ending scan or the pacing budget.
  const changesInvalid = hasChanges && !validTrackerChanges(input.changes);
  const changes: TrackerChange[] =
    hasChanges && !changesInvalid && !input.changesDeferred
      ? (input.changes as TrackerChange[])
      : [];

  const { ownedSessionCharacter } = await import('./dm-feature-gate.js');
  const character = await ownedSessionCharacter(sessionId, userId);
  if (!character) return done('no_character');
  characterId = character.id;
  if (input.rollRequested) return done('roll_pending');

  const { db } = await import('../../../../db/client');
  const { and, desc, eq, sql } = await import('drizzle-orm');
  const { dialogueHistory, gameSessions, sessionTrackers } =
    await import('../../../../db/schema/index');

  // The player message this turn answers (Retry replays the same row).
  const [message] = await db
    .select({ id: dialogueHistory.id })
    .from(dialogueHistory)
    .where(and(eq(dialogueHistory.sessionId, sessionId), eq(dialogueHistory.speakerType, 'player')))
    .orderBy(desc(dialogueHistory.createdAt), desc(dialogueHistory.sequenceNumber))
    .limit(1);
  if (!message) return done('no_player_message');

  const state = await loadTrackerState(sessionId, userId);
  if (!state) return done('no_character');
  const definitionByKey = new Map(
    state.definitions.map((definition) => [normalizeClockName(definition.name), definition]),
  );
  // The final-beat trigger arms the ending only where an ending can be
  // forced — a one-shot. On any other campaign the flag is noted once
  // here rather than re-asserted silently every turn.
  const armFinalBeat = input.finalBeatReached === true && state.campaignLength === 'one-shot';
  if (input.finalBeatReached === true && !armFinalBeat) {
    logger.info({
      msg: 'DM_STORY_TRACKER_FINAL_BEAT_NOT_ARMED',
      sessionId,
      campaignLength: state.campaignLength,
    });
  }

  // Set inside the transaction when this call arms the final-beat state;
  // read after commit for the #1068 audit log below. A rollback throws
  // out of the transaction, so the log never fires for an uncommitted arm.
  let armedFinalBeatThisCall = false;
  // #1170: the same commit-gated pattern for the budget's own event
  // lines. pacedClimaxTurn / pacedEndingRequiredTurn are the typed-turn
  // counts at the trip turns, captured inside the transaction.
  let pacedClimaxThisCall = false;
  let pacedClimaxTurn: number | null = null;
  let pacedEndingRequiredThisCall = false;
  let pacedEndingRequiredTurn: number | null = null;
  const { result, forceEndingClock, forceIsNew } = await db.transaction(async (tx) => {
    const finish = (
      outcome: StoryTrackerOutcome,
      appliedChanges = 0,
      force: ClockDefinition | null = null,
      isNew = false,
    ): {
      result: StoryTrackerResult;
      forceEndingClock: ClockDefinition | null;
      forceIsNew: boolean;
    } => ({
      result: done(outcome, appliedChanges),
      forceEndingClock: force,
      forceIsNew: isNew,
    });
    const [session] = await tx
      .select({ status: gameSessions.status, sessionState: gameSessions.sessionState })
      .from(gameSessions)
      .where(eq(gameSessions.id, sessionId))
      .for('update')
      .limit(1);
    if (!session) return finish('no_character');
    if (session.status === 'completed') return finish('session_completed');

    const stored = (session.sessionState as { tracker?: TrackerPhaseState } | null)?.tracker;
    const phase: TrackerPhaseState | null = stored?.phase === 'climax' ? { ...stored } : null;
    if (stored?.lastMessageId === message.id) return finish('already_applied');

    // Level-triggered ending: a stored `at_limit: 'ending'` clock sitting
    // at its limit owes the ending on every tracker step until the session
    // completes. The crossing fire below can be lost (the completion runs
    // after this transaction commits, and can fail or be interrupted);
    // without this scan the session would sit above its limit forever,
    // because no later change ever "crosses" again.
    let owedEnding: ClockDefinition | null = null;
    const endingDefinitions = state.definitions.filter((d) => d.atLimit === 'ending');
    if (endingDefinitions.length > 0) {
      const rows = await tx
        .select({ name: sessionTrackers.name, value: sessionTrackers.value })
        .from(sessionTrackers)
        .where(eq(sessionTrackers.sessionId, sessionId));
      for (const row of rows) {
        const def = endingDefinitions.find(
          (d) => normalizeClockName(d.name) === normalizeClockName(row.name),
        );
        if (def && row.value >= def.limit) {
          owedEnding = def;
          break;
        }
      }
    }
    // #1083: the one-shot pacing budget. Counted in this transaction,
    // after the FOR UPDATE lock on the session row serializes competing
    // turns: the crossing turn is the budget-th
    // player message's turn, and a Retry replays the same message, so
    // the count cannot double-fire. This check runs even with no changes
    // and no final beat — a DM that never moves a clock sends no changes,
    // which is exactly the drift the budget exists to catch.
    // #1091: count typed player turns only (exclude dice-roll answers).
    // #1170: the count serves the budget trip AND the pacing log lines,
    // so it runs on every one-shot turn without a phase, plus on turns
    // of a budget-forced climax (where the ending-required trip needs
    // its own turn number). Clock-limit and final-beat climaxes never
    // pay for it.
    let playerTurns: number | null = null;
    let pacingTrip = false;
    if (state.campaignLength === 'one-shot' && (!phase || phase.budgetForced)) {
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(dialogueHistory)
        .where(
          and(
            eq(dialogueHistory.sessionId, sessionId),
            eq(dialogueHistory.speakerType, 'player'),
            sql`coalesce(${dialogueHistory.context}->>'intent', '') <> 'dice_roll'`,
          ),
        );
      playerTurns = count;
      const budget = pacingBudgetFor(state.campaignLength);
      pacingTrip = !phase && budget !== null && playerTurns >= budget;
    }
    if (!phase && changes.length === 0 && !armFinalBeat && !pacingTrip) {
      return finish(changesInvalid ? 'invalid_changes' : 'no_changes', 0, owedEnding);
    }

    const nextPhase: TrackerPhaseState | null = phase
      ? { ...phase, lastMessageId: message.id }
      : null;
    // A new player turn in the climax counts toward the safety net.
    if (nextPhase) {
      nextPhase.climaxTurns += 1;
      if (nextPhase.climaxTurns >= CLIMAX_TURN_LIMIT) nextPhase.endingRequired = true;
    }
    // #1170: the ending-required trip on a budget-forced phase captures
    // its typed-turn number for the post-commit log line below. Only the
    // false -> true transition logs: later turns keep endingRequired
    // true, and their turns are not new events. A finalBeat arming on a
    // budget phase also trips this log: the ending became required on
    // that turn via the trigger, not the 6-turn net.
    if (
      nextPhase !== null &&
      nextPhase.budgetForced === true &&
      nextPhase.endingRequired === true &&
      phase?.endingRequired !== true &&
      playerTurns !== null
    ) {
      pacedEndingRequiredThisCall = true;
      pacedEndingRequiredTurn = playerTurns;
    }

    let appliedChanges = 0;
    let unknownClock = false;
    let climaxClock: ClockDefinition | null = null;
    let forceClock: ClockDefinition | null = owedEnding;
    let forceIsNew = false;
    for (const change of changes) {
      const definition = definitionByKey.get(normalizeClockName(change.name));
      if (!definition) {
        unknownClock = true;
        continue;
      }
      const [existing] = await tx
        .select({ value: sessionTrackers.value })
        .from(sessionTrackers)
        .where(
          and(eq(sessionTrackers.sessionId, sessionId), eq(sessionTrackers.name, definition.name)),
        )
        .limit(1);
      const current = existing?.value ?? 0;
      // Model-supplied values are unbounded; the stored value never is —
      // a clock holds between zero and its limit, so a wild set or delta
      // lands on the nearest edge instead of corrupting the rendered line
      // and the crossing math.
      const rawValue = change.set !== undefined ? change.set : current + (change.delta ?? 0);
      const value = Math.min(Math.max(rawValue, 0), definition.limit);
      await tx
        .insert(sessionTrackers)
        .values({ sessionId, name: definition.name, value, limit: definition.limit })
        .onConflictDoUpdate({
          target: [sessionTrackers.sessionId, sessionTrackers.name],
          set: { value, limit: definition.limit, updatedAt: new Date() },
        });
      appliedChanges += 1;
      const crossed = value >= definition.limit && current < definition.limit;
      if (crossed && definition.atLimit === 'ending') {
        forceClock = definition;
        forceIsNew = true;
      }
      if (crossed && definition.atLimit === 'climax') climaxClock = definition;
    }

    let phaseToStore = nextPhase;
    if (climaxClock && !phaseToStore) {
      phaseToStore = {
        phase: 'climax',
        clock: climaxClock.name,
        climaxTurns: 0,
        endingRequired: false,
        lastMessageId: message.id,
      };
    }
    if (armFinalBeat) {
      // The final beat arms the same ending-required state the climax
      // safety net trips — with no clock at its limit, the phase is the
      // trigger's own (the first defined clock names it, when the
      // campaign has one; Hark's run had the Clock at 1/6).
      armedFinalBeatThisCall = true;
      if (!phaseToStore) {
        phaseToStore = {
          phase: 'climax',
          clock: state.definitions[0]?.name ?? 'Final beat',
          climaxTurns: 0,
          endingRequired: true,
          finalBeat: true,
          lastMessageId: message.id,
        };
      } else {
        phaseToStore.endingRequired = true;
        phaseToStore.finalBeat = true;
      }
    }
    // The stored tracker key carries the phase once the climax begins, and
    // the once-per-message marker alone before that.
    if (pacingTrip && !phaseToStore) {
      // The budget forces the climax the #1053 way: the phase enters
      // with count 0, the following turns count to the 6-turn net, and
      // the ending is required there — the DM's clock never had to move.
      // A clock crossing on this same turn already set the phase above
      // and wins: the clock did reach its limit, so its wording stands.
      // The label names the first defined clock for the directive line;
      // budgetForced keeps the wording honest about what forced it.
      // This MUST sit before the store below: the phase is written there.
      phaseToStore = {
        phase: 'climax',
        clock: state.definitions[0]?.name ?? 'Final beat',
        climaxTurns: 0,
        endingRequired: false,
        budgetForced: true,
        lastMessageId: message.id,
      };
      // #1170: the trip turn's typed-turn number, for the post-commit log
      // line below. playerTurns is non-null here: the trip ran the COUNT.
      pacedClimaxThisCall = true;
      pacedClimaxTurn = playerTurns;
    }
    if (phaseToStore || changes.length > 0) {
      const trackerJson = phaseToStore ?? { lastMessageId: message.id };
      await tx
        .update(gameSessions)
        .set({
          sessionState: sql`jsonb_set(COALESCE(${gameSessions.sessionState}, '{}'::jsonb), '{tracker}', ${JSON.stringify(trackerJson)}::jsonb, true)`,
          updatedAt: new Date(),
        })
        .where(eq(gameSessions.id, sessionId));
    }
    if (appliedChanges > 0) return finish('applied', appliedChanges, forceClock, forceIsNew);
    if (armFinalBeat || pacingTrip)
      return finish('applied', appliedChanges, forceClock, forceIsNew);
    if (unknownClock) return finish('unknown_clock');
    return finish(changesInvalid ? 'invalid_changes' : 'no_changes', 0, forceClock, forceIsNew);
  });

  // #1170: the budget's own event lines, one per event with the typed-turn
  // number, so Hetzner can count the budget's course from prod logs. The
  // climax line gates on outcome like the audit line below; the
  // ending-required line gates on the flag alone — the trip turn stores
  // the phase but reports 'no_changes', so an outcome gate would miss it.
  // Both sit post-commit: a rolled-back transaction logs nothing.
  if (pacedClimaxThisCall && result.outcome === 'applied' && pacedClimaxTurn !== null) {
    logger.info({ msg: `DM_PACING climax turn=${pacedClimaxTurn}`, sessionId });
  }
  if (pacedEndingRequiredThisCall && pacedEndingRequiredTurn !== null) {
    logger.info({
      msg: `DM_PACING ending_required turn=${pacedEndingRequiredTurn}`,
      sessionId,
    });
  }

  if (armedFinalBeatThisCall && result.outcome === 'applied') {
    result.finalBeatArmed = true;
    // #1068: the flag is the DM's own report, and no machine-readable
    // final-location marker exists in campaign_rules to check it against
    // (condition/effect are free text; metadata carries only
    // limit/at_limit), so an automated mismatch comparison cannot be
    // built on current data — inventing a fuzzy text match would log
    // noise and could misjudge a legitimate flag. What the server can
    // do is make every armed flag auditable: the post-turn clock
    // snapshot (definitions merged like the directive, so a defined-
    // but-untouched clock reads 0 instead of vanishing), the player
    // message this turn answers, and the starter campaign — the join
    // keys that let a reviewer find the flagged turn. The scene is the
    // last client-written one, not the flagged turn's (see the
    // TrackerState comment); it rides along labelled as such.
    // Fail-open like the other audit logs here: a failed read must
    // never cost the turn the flag armed on.
    // Covered by final-beat-audit-log.test.ts (fires once on an arm,
    // never on a rollback or an already_applied Retry) and by the
    // stdout-capture test in story-ending.real-db.test.ts (fires once
    // on a real arm turn, nothing new on a Retry replay).
    try {
      const rows = await db
        .select({
          name: sessionTrackers.name,
          value: sessionTrackers.value,
          limit: sessionTrackers.limit,
        })
        .from(sessionTrackers)
        .where(eq(sessionTrackers.sessionId, sessionId));
      const storedByKey = new Map(rows.map((row) => [normalizeClockName(row.name), row]));
      const clocks = state.definitions.map(
        (definition) =>
          storedByKey.get(normalizeClockName(definition.name)) ?? {
            name: definition.name,
            value: 0,
            limit: definition.limit,
          },
      );
      for (const row of rows) {
        if (
          !state.definitions.some(
            (d) => normalizeClockName(d.name) === normalizeClockName(row.name),
          )
        ) {
          clocks.push(row);
        }
      }
      logger.info({
        msg: 'DM_STORY_TRACKER_FINAL_BEAT_FLAGGED',
        sessionId,
        playerMessageId: message.id,
        starterCampaignId: state.starterCampaignId,
        campaignLength: state.campaignLength,
        clocks,
        lastClientScene: state.currentSceneDescription,
      });
    } catch (error) {
      logger.warn({ msg: 'DM_STORY_TRACKER_FINAL_BEAT_AUDIT_FAILED', sessionId, error });
    }
  }

  if (forceEndingClock) {
    const clock: ClockDefinition = forceEndingClock;
    if (state.campaignLength !== 'one-shot') {
      // The ending path completes one-shots only; on any other campaign
      // the clock sits at its limit and the DM ends the story by
      // declaration. Logged loudly rather than silently dropped, so a
      // bible that marks a long campaign's clock `at_limit: 'ending'` is
      // visible in the server log instead of dead-ending in the dark —
      // but only on the crossing turn: the owed-ending scan above is
      // level-triggered, and re-logging it every turn buried the signal
      // (strategist follow-up, PR #1053).
      if (forceIsNew) {
        logger.warn({
          msg: 'DM_STORY_TRACKER_ENDING_NOT_FORCED',
          sessionId,
          clock: clock.name,
          campaignLength: state.campaignLength,
        });
      }
    } else {
      let inCombat = false;
      if (input.changesDeferred === true) {
        inCombat = true;
      } else {
        try {
          const { CombatEncounterService } = await import('../combat/combat-encounter-service.js');
          const encounter = await CombatEncounterService.getActiveEncounter(sessionId, userId);
          inCombat = !!encounter;
        } catch {
          inCombat = false;
        }
      }
      if (inCombat) {
        logger.info({
          msg: 'DM_STORY_TRACKER_ENDING_DEFERRED_COMBAT',
          sessionId,
          clock: clock.name,
        });
      } else {
        // The clock filled on a campaign whose rules end the story there:
        // force the ending through #1034's applier (its claim, one-shot
        // scope and completion write), with an engine summary — the DM's
        // own declaration, when it comes, finds the stored ending and
        // reports it back.
        // #1084: the forced summary is returned, not dropped — the route
        // mirrors it onto the reply envelope exactly as it does a declared
        // or safety-net ending, so the client's completion latch fires on
        // the engine-ended turn instead of only on reload.
        try {
          const { applyStoryEnding } = await import('./story-ending.js');
          const forced = await applyStoryEnding({
            userId,
            sessionId,
            ending: {
              summary: `The ${clock.name} Clock reached ${clock.limit} of ${clock.limit} — the adventure ends.`,
            },
          });
          if (
            (forced.outcome === 'applied' || forced.outcome === 'already_applied') &&
            forced.summary
          ) {
            return { ...result, forcedEndingSummary: forced.summary };
          }
        } catch (error) {
          logger.warn({ msg: 'DM_STORY_TRACKER_FORCE_ENDING_FAILED', sessionId, error });
        }
      }
    }
  }
  return result;
}

/**
 * The corrective prompt for the safety net's one more generate call,
 * shaped like the combat-transition enforcement's: an instruction block
 * naming the breach (the ending was required and not declared) and the
 * exact field that fixes it.
 */
export function buildEndingRequiredCorrectivePrompt(input: {
  clock: string;
  finalBeat?: boolean;
  /** #1083: the climax was forced by the turn budget, not a clock limit. */
  budgetForced?: boolean;
}): string {
  const reason =
    input.finalBeat === true
      ? 'The story has reached its final beat (the campaign’s final location or beat ' +
        'has played) and your previous reply did not declare the ending'
      : input.budgetForced === true
        ? 'The one-shot’s turn budget is reached, the climax has run its course, and ' +
          'your previous reply did not declare the ending'
        : `The ${input.clock} Clock reached its limit, the climax has run its course, and ` +
          'your previous reply did not declare the ending';
  return (
    '<corrective_instruction>\n' +
    `${reason} — the ending is required: this reply MUST set campaign_ending to ` +
    '{"summary": "<one or two sentences: how the story ended>"} and narrate the ' +
    'ending in text. Do not request a roll, and do not advance the story past ' +
    'the ending.\n' +
    '</corrective_instruction>'
  );
}

/** The engine-written ending, used when even the corrective reply declares none. */
export function engineWrittenEndingSummary(input: {
  clock: string;
  finalBeat?: boolean;
  /** #1083: the climax was forced by the turn budget, not a clock limit. */
  budgetForced?: boolean;
}): string {
  return input.finalBeat === true
    ? 'The story reached its final beat — the adventure ends.'
    : input.budgetForced === true
      ? 'The one-shot’s turn budget is reached and the climax ran its course — the adventure ends.'
      : `The ${input.clock} Clock reached its limit and the climax ran its course — the adventure ends.`;
}

export type EndingEnforcementOutcome = 'declared' | 'engine_forced' | 'not_applied';

/**
 * The safety net as a real request (strategist FIX, PR #1053): the turn's
 * prompt already required the ending (the climax count tripped, or the
 * final beat was flagged) and the reply still declared none. One more
 * generate call with the ending required — the route supplies it through
 * the same construction the combat-transition enforcement uses (the
 * corrective prompt, the turn's history plus its prompt and reply, the
 * same model and schema). Only the corrective reply's `campaign_ending`
 * is harvested, through `applyStoryEnding`: the turn's own reply stands
 * (its narration is valid and its story effects already applied), so
 * replacing the reply the way a contract breach is replaced would desync
 * them. If the corrective reply also fails — no declaration, an error,
 * an unparseable body — the ending is forced with the engine-written
 * summary. Either way the route mirrors the stored summary onto the
 * turn's envelope, exactly as a first-reply declaration does.
 */
export async function enforceRequiredEnding(input: {
  userId: string;
  sessionId: string;
  /** Display name of the clock whose climax armed the net (or the final beat's label). */
  clock: string;
  /** The final-beat trigger armed the net, not the climax turn count. */
  finalBeat?: boolean;
  /** #1083: the pacing budget forced the climax, not a clock limit. */
  budgetForced?: boolean;
  /** #1170: typed player turns at the enforcement turn; logged on the engine-ending event. */
  turns: number;
  /** One more generate with the ending required; the route owns the call shape. */
  regenerate: (correctivePrompt: string) => Promise<{ text: string; error?: string }>;
}): Promise<{ outcome: EndingEnforcementOutcome; summary?: string }> {
  const { userId, sessionId } = input;
  const done = (
    outcome: EndingEnforcementOutcome,
    summary?: string,
  ): { outcome: EndingEnforcementOutcome; summary?: string } => {
    logger.info({
      msg: 'DM_STORY_TRACKER_ENDING_ENFORCEMENT',
      sessionId,
      clock: input.clock,
      finalBeat: input.finalBeat === true,
      budgetForced: input.budgetForced === true,
      outcome,
    });
    return summary !== undefined ? { outcome, summary } : { outcome };
  };

  const { applyStoryEnding, validCampaignEnding } = await import('./story-ending.js');
  const { parseLlmEnvelope } = await import('./dm-response-schema.js');

  // Rung 1: one more generate, the ending required.
  try {
    const retry = await input.regenerate(buildEndingRequiredCorrectivePrompt(input));
    if (!retry.error) {
      const parsed = parseLlmEnvelope(retry.text);
      if (validCampaignEnding(parsed?.campaign_ending)) {
        const rollRequests = parsed?.roll_requests;
        const declared = await applyStoryEnding({
          userId,
          sessionId,
          ending: parsed.campaign_ending,
          rollRequested: Array.isArray(rollRequests) && rollRequests.length > 0,
        });
        if (declared.outcome === 'applied' || declared.outcome === 'already_applied') {
          return done('declared', declared.summary);
        }
      }
    }
  } catch (error) {
    logger.warn({ msg: 'DM_STORY_TRACKER_ENDING_RETRY_FAILED', sessionId, error });
  }

  // Rung 2: the engine-written ending. No roll deferral — deferring is
  // what the two failed declarations already did; the net exists so the
  // session cannot run on.
  try {
    const summary = engineWrittenEndingSummary(input);
    const forced = await applyStoryEnding({ userId, sessionId, ending: { summary } });
    if (forced.outcome === 'applied' || forced.outcome === 'already_applied') {
      // #1170: the budget's engine-ending event, with its typed-turn number.
      // Rung 1's declared ending logs no pacing line: the DM declared it,
      // so the ending is visible without a log line.
      if (input.budgetForced === true) {
        logger.info({ msg: `DM_PACING engine_ending turn=${input.turns}`, sessionId });
      }
      return done('engine_forced', forced.summary ?? summary);
    }
  } catch (error) {
    logger.warn({ msg: 'DM_STORY_TRACKER_ENDING_FORCE_FAILED', sessionId, error });
  }
  return done('not_applied');
}
