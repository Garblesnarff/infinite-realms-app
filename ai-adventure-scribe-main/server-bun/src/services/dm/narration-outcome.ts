/**
 * #266: a failed skill check narrated as a success (Hark GP-041: Stealth 7 vs DC 14 narrated as
 * "practiced stillness"), and the reverse (an engine hit narrated as a miss).
 *
 * The engine's verdict for the turn is authoritative. `contradictsEngineOutcome`
 * (shared/narration-harm.ts) detects explicit verdict language with the player as the subject;
 * this module feeds it the latest roll outcome from the session state and repairs a
 * contradiction by replacing only the contradicting sentences with the engine's truth, plainly
 * stated. A failed check may still have a consequence — noise, a cost, damage — so only
 * explicit success/failure claims contradict; everything else passes through untouched.
 *
 * Fails open: a check that cannot run logs and lets the reply through rather than costing the
 * player their turn.
 */

import { and, desc, eq } from 'drizzle-orm';

import { dialogueHistory, gameSessions } from '../../../../db/schema/index';
import {
  actionKeywords,
  contradictsEngineOutcome,
  sentenceSpan,
  spliceContradictingSentences,
  type OutcomeClaim,
} from '../../../../shared/narration-harm.js';
import { logger } from '../../lib/logger.js';

export interface RollOutcome {
  success: boolean;
  total?: number;
  dc?: number;
  ac?: number;
  requestType?: string;
  description?: string;
  timestamp?: string;
}

/** A roll outcome older than this cannot be the current turn's; the gate stays silent. */
const OUTCOME_MAX_AGE_MS = 15 * 60 * 1000;

/**
 * The newest persisted roll result with an authoritative outcome, mirroring the client's
 * `SessionStateService.getLatestRollOutcome` (same combatLog `roll_result` shape the DM prompt
 * carries as `lastRollOutcome`). Null when there is none, it is malformed, its timestamp is
 * missing or too old, or it predates the latest DM message (a previous turn's roll must not
 * repair this turn's narration). Text-parsed roll mentions (`{ total, raw }`, no success
 * flag) are skipped over — a typed roll has no verdict of its own and must not shadow the
 * real roll below it.
 */
export async function latestRollOutcome(sessionId: string): Promise<RollOutcome | null> {
  // Lazy db import: the module must stay importable without DATABASE_URL so the pure
  // repairNarration unit tests run under vitest (db/client.ts throws at load without it).
  const { db } = await import('../../../../db/client');
  const [row] = await db
    .select({ state: gameSessions.sessionState })
    .from(gameSessions)
    .where(eq(gameSessions.id, sessionId))
    .limit(1);
  const log = (row?.state as { combatLog?: unknown } | null)?.combatLog;
  if (!Array.isArray(log)) return null;
  // The latest DM message marks the start of the current exchange; a roll older than it
  // belongs to a previous turn. Read its server-side created_at: the timestamp column
  // is client-supplied display data, and a skewed client clock must not exile this
  // turn's roll (#266 follow-up; AGENTS.md §4).
  const [latestDm] = await db
    .select({ createdAt: dialogueHistory.createdAt })
    .from(dialogueHistory)
    .where(
      and(eq(dialogueHistory.sessionId, sessionId), eq(dialogueHistory.speakerType, 'dm')),
    )
    .orderBy(desc(dialogueHistory.createdAt))
    .limit(1);
  const exchangeStart = latestDm?.createdAt?.getTime() ?? 0;
  for (let index = log.length - 1; index >= 0; index -= 1) {
    const entry = (log[index] as { entry?: unknown } | null)?.entry;
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as { kind?: unknown; payload?: unknown };
    if (candidate.kind !== 'roll_result' || !candidate.payload) continue;
    if (typeof candidate.payload !== 'object') return null;
    const payload = candidate.payload as Record<string, unknown>;
    if (typeof payload.success !== 'boolean' || typeof payload.total !== 'number') {
      // Text-parsed roll mentions are logged as roll_result too, with no authoritative
      // outcome of their own ({ total, raw } and no success flag): they are the one
      // skippable shape — a typed "I rolled 17" must not shadow the real roll below
      // it (#266 round 2; mirrors the client's getLatestRollOutcome). Any other
      // outcome-less entry is a real roll that simply has no verdict (an untargeted
      // check, a damage roll): stop there instead of surfacing an older roll from an
      // earlier turn as the latest outcome.
      if (typeof payload.raw === 'string') continue;
      return null;
    }
    const timestamp = (log[index] as { timestamp?: unknown })?.timestamp;
    // A missing or malformed timestamp cannot be placed in this turn: fail closed.
    if (typeof timestamp !== 'string') return null;
    const rollTime = new Date(timestamp).getTime();
    if (Number.isNaN(rollTime)) return null;
    if (Date.now() - rollTime > OUTCOME_MAX_AGE_MS) return null;
    if (rollTime <= exchangeStart) return null;
    return {
      success: payload.success,
      total: payload.total,
      dc: typeof payload.dc === 'number' ? payload.dc : undefined,
      ac: typeof payload.ac === 'number' ? payload.ac : undefined,
      requestType: typeof payload.requestType === 'string' ? payload.requestType : undefined,
      description: typeof payload.description === 'string' ? payload.description : undefined,
      timestamp,
    };
  }
  return null;
}

/**
 * The engine's truth, plainly stated, for a narration that claimed the opposite. The repair
 * replaces the false claim — it does not embroider it, and it never invents a consequence.
 */
export function repairNarration(outcome: RollOutcome): string {
  const what = outcome.description ? `The ${outcome.description}` : 'The attempt';
  const target =
    typeof outcome.dc === 'number'
      ? ` vs DC ${outcome.dc}`
      : typeof outcome.ac === 'number'
        ? ` vs AC ${outcome.ac}`
        : '';
  const score = ` (${outcome.total}${target})`;
  return outcome.success ? `${what} succeeded${score}.` : `${what} failed${score}.`;
}

/** The envelope roll-request fields this gate reads (`dm-response-schema.ts`). */
export interface PendingRollRequest {
  type?: unknown;
  purpose?: unknown;
}

/** Envelope request type → the requestType vocabulary the outcome detector anchors on. */
const PENDING_REQUEST_TYPES: Record<string, string> = {
  check: 'skill_check',
  save: 'saving_throw',
  attack: 'attack',
};

/** The engine's truth for a claim about a roll that has not happened: it is undecided. */
const PENDING_ROLL_STATEMENT = 'That outcome is not decided yet — the roll still has to be made.';

/**
 * Conditional openers: a marker BEFORE the claim frames the verdict as what MIGHT
 * happen (stakes), not what did. Scoped to the text before the claim — a concessive
 * clause after it ("…even if the hinges protest") does not make an asserted verdict
 * hypothetical (self-review HIGH 1). `should` only counts sentence-initially (the
 * inverted conditional "Should you succeed…"), handled in the filter below.
 */
const CONDITIONAL_PREFIX =
  /\b(?:if|whether|unless|when|once|provided|providing|in case|as long as|even if)\b/i;
/** Verdict stems: a match without one is a miss/dismissal claim, not a success/fail claim. */
const VERDICT_CLAIM = /succeed|fail|successful|manage[sd]?\s+to/i;
/**
 * Words that name the roll's TYPE or the ability behind it, never the action itself.
 * They must not anchor a claim: every check would match "skill", every save "saving",
 * and a recap about a different action routinely uses them as ordinary words ("You
 * succeed in saving the child…" before a saving throw is requested) — self-review
 * BLOCKER 2. Keywords are therefore derived from the request's purpose alone, minus
 * this set; when nothing distinctive remains, there is no vocabulary to anchor on
 * and the detector's verdict stands (the bare-purpose NT-011 shape).
 */
const GENERIC_KEYWORDS = new Set([
  'skill',
  'saving',
  'throw',
  'throws',
  'attack',
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Word-boundary keyword match with light inflection (open→opening, climb→climbed).
 * A monosyllabic keyword ending in a single vowel + consonant also matches its
 * doubled-consonant inflections (slip→slipping/slipped, grab→grabbing): the
 * consonant doubles before -ed/-ing, so the plain stem never matches them
 * (#266 round 2).
 */
function sentenceNamesKeyword(sentence: string, keyword: string): boolean {
  const stem = keyword.endsWith('e') ? keyword.slice(0, -1) : keyword;
  const stems = [keyword, stem];
  const monosyllabic = (keyword.match(/[aeiou]+/gi) ?? []).length === 1;
  if (monosyllabic && /[^aeiou][aeiou][bcdfgklmnprstz]$/i.test(keyword)) {
    stems.push(`${keyword}${keyword.slice(-1)}`);
  }
  const alternation = [...new Set(stems)].map(escapeRegExp).join('|');
  return new RegExp(`\\b(?:${alternation})(?:s|es|ed|ing)?\\b`, 'i').test(sentence);
}

/**
 * sentenceSpan splits on every '.', including abbreviation periods ("St. Cuthbert"),
 * which would hide a sentence-initial conditional from the filter. Extend the start
 * backwards over abbreviation fragments so the conditional check sees the whole
 * sentence (self-review MEDIUM 3). The splicer keeps its own span; an excluded claim
 * is never spliced, so the fragmenting splice this avoids never happens.
 */
const ABBREVIATION = /^(?:[a-z]|st|mr|mrs|ms|dr|sr|jr|vs|etc)$/i;
function expandedSentenceStart(text: string, start: number): number {
  let expanded = start;
  for (;;) {
    const before = text.slice(0, expanded).trimEnd();
    if (!before.endsWith('.')) return expanded;
    const word = /([A-Za-z]+)\.$/.exec(before)?.[1] ?? '';
    if (!ABBREVIATION.test(word)) return expanded;
    expanded = sentenceSpan(text, before.length - word.length - 1).start;
  }
}

/**
 * One side of a ';' carrying BOTH verdicts as alternatives ("you succeed and slip
 * through, or you fail and stumble"): the later verdict is introduced by "or",
 * where an asserted contrast joins them with "but" instead ("…past the guard,
 * but you fail to notice the dog"). The verdicts may come in either order.
 */
function branchHasAlternatingPair(branch: string): boolean {
  const success = /succeed|successful/i.exec(branch);
  const failure = /\bfail/i.exec(branch);
  if (!success || !failure) return false;
  const [first, second] =
    success.index < failure.index ? [success, failure] : [failure, success];
  const between = branch.slice(first.index + first[0].length, second.index);
  return /\bor\s*(?:you\s*)?$/i.test(between);
}

/**
 * Whether a detector claim in a REQUESTING reply is really a verdict on the pending roll
 * (#959 forward-fix). The detector keys on verdict language alone, which is right for a
 * decided outcome — any "you succeed" contradicts a failed roll — but a requesting reply
 * legitimately contains verdict language that is NOT a claim on the pending roll:
 *
 * - A recap of an ALREADY-DECIDED roll ("You succeed in climbing the shaft unheard. …
 *   roll a Thieves' Tools check."): the pending request cannot own a verdict about a
 *   different action, so EVERY claim — hard verdicts included, not just the soft ones
 *   the detector already anchors — must name the pending action's keywords in its own
 *   sentence. A verdict sentence tied to no pending keyword is left alone.
 * - Stakes framing ("If you succeed, you pry the gate open; if you fail, the alarm
 *   rings."): conditional verdict language sets up the roll, it does not pre-narrate
 *   it. A sentence carrying a conditional marker, or a conditional modal before the
 *   claim, is hypothetical and never a claim.
 * - A miss/dismissal the sentence does not anchor on the player ("an arrow misses the
 *   goblin") cannot be told apart from an NPC's attack, so it needs a player anchor —
 *   "you"/"your" or the character's name — in the sentence.
 */
function isClaimOnPendingRoll(
  text: string,
  claim: OutcomeClaim,
  keywords: string[],
  characterName?: string,
): boolean {
  const span = sentenceSpan(text, claim.index);
  const start = expandedSentenceStart(text, span.start);
  const sentence = text.slice(start, span.end);
  const beforeClaim = sentence.slice(0, claim.index - start);
  // Hypothetical framings are stakes-setting, not claims (self-review BLOCKER 1):
  // - a question ("Will you succeed in opening the gate…?") asserts nothing;
  // - a conditional opener before the claim (if/when/once/provided/as long as…, or
  //   sentence-initial "Should you succeed…") frames the verdict as what might happen;
  // - a conditional modal governing the claim ("you could succeed…") — the modal must
  //   sit in the last few words before the claim, so an unrelated "can"/"may" in an
  //   earlier clause cannot shield an asserted verdict (self-review HIGH 1);
  // - paired stakes in a branch structure (';'-separated branches or a branch
  //   marker) lay out both outcomes hypothetically ("You succeed, you pry the gate
  //   open; you fail, the alarm bell rings."); a success+failure CONTRAST in one
  //   clause asserts both and stays a claim (strategist FIX, round 1).
  if (sentence.trimEnd().endsWith('?')) return false;
  if (CONDITIONAL_PREFIX.test(beforeClaim)) return false;
  if (/^\s*should\b/i.test(sentence)) return false;
  const tailWords = beforeClaim.trim().split(/\s+/).slice(-3).join(' ');
  if (/\b(?:would|could|might|can|may)\b/i.test(tailWords)) return false;
  if (VERDICT_CLAIM.test(claim.match) && /succeed|successful/i.test(sentence) && /\bfail/i.test(sentence)) {
    // Paired stakes only in a BRANCH structure: a branch marker scoping the claim,
    // or a ';'-separated pair carrying a verdict on each side. A mere contrast in
    // one clause ("You succeed in slipping past the guard, but you fail to notice
    // the dog.") asserts both outcomes — it is a claim, not stakes (strategist FIX).
    // The marker scan runs from the sentence start through the end of the claim's
    // clause (#266 round 2): a marker in a LATER clause ("…, even if the hinges
    // protest") frames nothing about the claim and cannot exempt an asserted
    // contrast. Markers before the claim keep their reach — for if/whether/etc.
    // the conditional-prefix rule above already scans all of beforeClaim, and
    // either/otherwise opening an alternation the claim belongs to ("Either you
    // succeed…, or you fail…") scope it from the same span.
    const claimStart = claim.index - start;
    const afterClaim = claimStart + claim.match.length;
    const clauseBreak = sentence.slice(afterClaim).search(/[,;:]/);
    const clauseEnd = clauseBreak === -1 ? sentence.length : afterClaim + clauseBreak;
    const branches = sentence.split(';');
    const semicolonPair =
      branches.length > 1 &&
      (branches.some(
        (branch, i) =>
          /succeed|successful/i.test(branch) &&
          branches.some((other, j) => j !== i && /\bfail/i.test(other)),
      ) ||
        // Both verdicts in ONE side, as alternatives: a preamble clause before
        // the ';' ("The guard turns away; you succeed…, or you fail…") puts the
        // pair in a single branch — it is still a pair (self-review BLOCKER 1).
        branches.some(branchHasAlternatingPair));
    if (
      /\b(?:if|whether|otherwise|either)\b/i.test(sentence.slice(0, clauseEnd)) ||
      semicolonPair
    ) {
      return false;
    }
  }
  if (!VERDICT_CLAIM.test(claim.match)) {
    // Miss/dismiss claims: the detector already anchors these on the player/target;
    // what this pass adds is a player anchor in the claim's own CLAUSE — a "you" in
    // an unrelated subordinate clause ("While you watch…, an arrow misses the
    // goblin") must not make a third party's miss the player's (self-review
    // MEDIUM 2). No keyword gate: a genuine miss rarely repeats the attack's
    // vocabulary ("Your strike misses entirely") — self-review MEDIUM 1.
    const clauseStart =
      Math.max(
        sentence.lastIndexOf(',', claim.index - start),
        sentence.lastIndexOf(';', claim.index - start),
        sentence.lastIndexOf(':', claim.index - start),
      ) + 1;
    const afterClaim = claim.index - start + claim.match.length;
    const clauseBreak = sentence.slice(afterClaim).search(/[;,]/);
    const clause = sentence.slice(
      clauseStart,
      clauseBreak === -1 ? undefined : afterClaim + clauseBreak,
    );
    const name = characterName?.trim();
    const anchoredOnPlayer =
      /\byou\b|\byour\b/i.test(clause) ||
      (!!name && new RegExp(`\\b${escapeRegExp(name)}\\b`, 'i').test(clause));
    if (!anchoredOnPlayer) return false;
    return true;
  }
  if (
    keywords.length > 0 &&
    !keywords.some((keyword) => sentenceNamesKeyword(sentence, keyword))
  ) {
    return false;
  }
  return true;
}

/**
 * #266, the NT-011/NT-020 ordering: the reply that REQUESTS a roll sometimes narrates that
 * roll's outcome in the same breath — success detail posted before the dice exist, so when
 * the roll then fails, the success narration already stands and no gate ever corrects it
 * (the outcome repair above needs a persisted outcome, and the client gate only runs on
 * dice-roll turns; the requesting turn is neither). The engine fact that owns the check is
 * the request itself: while a request is pending, a verdict claim about its action is
 * premature in BOTH directions, so the same outcome-anchored detector runs with each
 * synthetic verdict, and any sentence it flags under either one is replaced with the
 * pending truth — subject to the scoping in isClaimOnPendingRoll, because a requesting
 * reply also carries decided-roll recaps and conditional stakes framing that are not
 * claims on the pending roll at all (#959 shipped this pass unscoped and spliced both;
 * this is the forward-fix). Damage and initiative requests carry no pass/fail verdict and
 * are skipped. Pure: returns the repaired text, or null when nothing claimed a pending
 * outcome. Never throws.
 */
export function repairPrematureRollClaims(
  text: string,
  rollRequests: unknown,
  characterName?: string,
): string | null {
  if (!text || !Array.isArray(rollRequests)) return null;
  let repaired = text;
  for (const request of rollRequests.slice(0, 10)) {
    const type = (request as PendingRollRequest | null)?.type;
    // hasOwn: a prototype key ('toString', 'constructor') is not a request type.
    const requestType =
      typeof type === 'string' && Object.hasOwn(PENDING_REQUEST_TYPES, type)
        ? PENDING_REQUEST_TYPES[type]
        : undefined;
    if (!requestType) continue;
    const purpose = (request as PendingRollRequest | null)?.purpose;
    const description =
      typeof purpose === 'string' && purpose.trim() ? purpose.trim() : undefined;
    // Anchor vocabulary comes from the purpose alone, minus generic type/ability
    // words (GENERIC_KEYWORDS): the requestType's own words match everything.
    const keywords = actionKeywords({ success: false, description }).filter(
      (keyword) => !GENERIC_KEYWORDS.has(keyword),
    );
    for (const success of [false, true]) {
      const claims = contradictsEngineOutcome(repaired, {
        success,
        characterName,
        description,
        requestType,
      }).filter((claim) => isClaimOnPendingRoll(repaired, claim, keywords, characterName));
      if (!claims.length) continue;
      logger.warn({
        msg: 'DM_NARRATION_PREMATURE_CLAIM_REPAIRED',
        requestType,
        claims,
      });
      repaired = spliceContradictingSentences(repaired, claims, PENDING_ROLL_STATEMENT);
    }
  }
  // Several flagged sentences (both synthetic verdicts, or several requests) each
  // splice to the same pending statement; state it once, not back to back
  // (self-review LOW 1).
  const doubled = `${PENDING_ROLL_STATEMENT} ${PENDING_ROLL_STATEMENT}`;
  while (repaired.includes(doubled)) {
    repaired = repaired.replace(doubled, PENDING_ROLL_STATEMENT);
  }
  return repaired === text ? null : repaired;
}

/**
 * Checks a DM reply's narration against the engine's latest roll outcome. Returns the reply
 * with only the contradicting sentences replaced by the engine's truth, else null. The rest
 * of the narration is the DM's legitimate prose and stays. Never throws.
 */
export async function repairNarrationContradiction(input: {
  sessionId: string;
  text: string;
  characterName?: string;
}): Promise<string | null> {
  const { sessionId, text, characterName } = input;
  try {
    const outcome = await latestRollOutcome(sessionId);
    if (!outcome) return null;
    const claims = contradictsEngineOutcome(text, {
      success: outcome.success,
      characterName,
      description: outcome.description,
      requestType: outcome.requestType,
    });
    if (!claims.length) return null;
    logger.warn({
      msg: 'DM_NARRATION_OUTCOME_REPAIRED',
      sessionId,
      claims,
      engineSuccess: outcome.success,
    });
    return spliceContradictingSentences(text, claims, repairNarration(outcome));
  } catch (error) {
    logger.warn({
      msg: 'DM_NARRATION_OUTCOME_CHECK_FAILED',
      sessionId,
      error: error instanceof Error ? error.message : error,
    });
    return null;
  }
}
