import { inventedExtraStrikeClaims } from '../../../shared/narration-extra-strike';
import {
  spliceContradictingSentences,
  type OutcomeClaim,
} from '../../../shared/narration-harm';

import type { ChatMessage } from '@/services/ai-service';
import type { PlayerInputOrigin } from '@/services/combat/combat-action-origin';
import type { PersistedRollOutcome } from '@/types/session-state';

import {
  contradictsEngineOutcome,
  fabricatedOutcomeClaimSpans,
  fabricatedOutcomeClaims,
  type EngineOutcome,
} from '@/hooks/ai/silent-player-turn';
import logger from '@/lib/logger';
import { AIService } from '@/services/ai-service';
import {
  createPlayerMessageFromOption,
  parseMessageOptions,
  type ActionOption,
} from '@/utils/parseMessageOptions';

/**
 * The one check every DM reply passes when the turn produced no engine event (#2373).
 *
 * #2349 told the DM that a free-text non-action had no mechanical effect, and logged when the
 * reply narrated one anyway. Run M9, round 3: the player typed "I try to talk it down", the engine
 * printed nothing, and the DM wrote "you narrowly avoid a strike from the entity, though a glancing
 * blow still leaves you feeling rattled and wounded" while HP stayed 4/7. An instruction the model
 * follows most of the time is not a rule, so this rejects the reply, asks once more with the
 * violation named, and on a repeat says nothing happened instead of shipping the claim.
 *
 * Both branches call it: the in-combat silent turn (`combat-resolution-step.ts`, after its
 * resolution-only narration) and the out-of-combat narrative turn (`use-ai-response.ts`, on the
 * first-pass reply). What differs is only how a reply is regenerated.
 */

/** Said in place of a narration that claimed harm twice. States the outcome, not the attempt. */
export const NEUTRAL_NO_EFFECT_LINE =
  '*(Nothing comes of that — the moment passes without effect.)*';

export const NARRATION_REJECTED_REASON = 'harm_claim_without_engine_event';

/** #266: the reply contradicted the engine's authoritative verdict for the turn. */
export const NARRATION_OUTCOME_REJECTED_REASON = 'outcome_contradicts_engine';
export const EXTRA_STRIKE_REJECTED_REASON = 'invented_extra_strike';

/** What the DM is told about the reply it just wrote. */
export function narrationViolationNote(claims: string[]): string {
  return (
    'Your previous reply for this turn was rejected. The engine resolved nothing for it: no roll, ' +
    `no attack, no damage, no condition. It claimed ${claims.map((claim) => `"${claim}"`).join(', ')}. ` +
    'Nothing hit, wounded, damaged or afflicted the player, and no creature attacked. Write the ' +
    'reply again without any strike, hit, blow, damage, wound, HP change, condition or creature ' +
    'attack. Do not mention this correction.'
  );
}

/** What the DM is told when its reply contradicted the engine's verdict (#266). */
export function engineOutcomeViolationNote(outcome: EngineOutcome, claims: string[]): string {
  return (
    'Your previous reply for this turn was rejected. The engine already resolved the roll: it ' +
    `${outcome.success ? 'SUCCEEDED' : 'FAILED'}. It claimed ${claims.map((claim) => `"${claim}"`).join(', ')}, ` +
    'which contradicts the engine result. Narrate the turn following the engine result — ' +
    (outcome.success
      ? 'the attempt came off; do not describe it failing, missing, or falling short.'
      : 'the attempt failed; do not describe it succeeding.') +
    ' Do not mention this correction.'
  );
}

/** What the DM is told when it invented a second strike against the player. */
export function extraStrikeViolationNote(engineHits: number, claims: string[]): string {
  return `Your previous reply for this turn was rejected. The engine resolved exactly ${engineHits} hit(s) on the player this turn. It claimed ${claims
    .map((claim) => `"${claim}"`)
    .join(', ')}. No second strike landed. Rewrite without it. Do not mention this correction.`;
}

interface GatedNarration {
  text?: string | null;
  narrationSegments?: unknown;
  options?: unknown;
  handout_actions?: unknown;
  map_actions?: unknown;
  scene_spec?: unknown;
  heldSideEffects?: () => Promise<void>;
}

/**
 * Runs the memory, world-update and voice work `AIService.chatWithDM` parked for this reply
 * (`holdSideEffects`). A no-op for a reply that parked nothing, and once-only for one that did.
 */
export function releaseHeldSideEffects(reply: GatedNarration | null | undefined): void {
  void reply?.heldSideEffects?.();
}

export type NarrationGateOutcome = 'clean' | 'regenerated' | 'replaced';

export interface NarrationGateParams<T extends GatedNarration> {
  /** The DM reply for a turn with no engine event. */
  narration: T;
  sessionId?: string;
  branch: 'combat' | 'narrative';
  /** Outside combat the player's own spell or blow may be narrated; see `fabricatedOutcomeClaims`. */
  playerMayHaveActed?: boolean;
  /**
   * #1048: the turn answered one of the previous DM reply's listed options. The checks
   * run exactly as on any other turn; only the terminal step differs — a reply that
   * still violates after the retry is not swapped for the no-effect line, because the
   * story is advancing on the DM's own invitation. The sentences carrying the repeated
   * claim are dropped instead (the extra-strike gate's tail), and the rest of the
   * reply, options included, survives.
   */
  pickedListedOption?: boolean;
  encounterId?: string;
  /**
   * #266: the engine's authoritative verdict for the turn (a roll it decided). When present the
   * harm check is skipped — the engine did resolve something, so harm claims may be legitimate —
   * and the reply must not contradict the verdict instead.
   */
  engineOutcome?: EngineOutcome | null;
  /** Asks the DM again with the violation named; resolves the new reply. */
  regenerate: (violation: string) => Promise<T>;
}

export async function enforceNarrationGate<T extends GatedNarration>(
  params: NarrationGateParams<T>,
): Promise<{ narration: T; outcome: NarrationGateOutcome }> {
  const {
    narration,
    sessionId,
    branch,
    playerMayHaveActed,
    pickedListedOption,
    encounterId,
    regenerate,
    engineOutcome,
  } = params;
  const options = { playerMayHaveActed };
  const logRejection = (attempt: 1 | 2, claims: string[], reason: string): void =>
    logger.warn('DM_NARRATION_REJECTED', {
      reason,
      sessionId,
      requestId: AIService.lastRequestId(),
      branch,
      attempt,
      claims,
      ...(encounterId ? { encounterId } : {}),
    });

  // #266: with an engine verdict the check is contradiction, not fabrication — a hit deals
  // damage legitimately, so the harm patterns must not run here.
  const contradictions = engineOutcome
    ? contradictsEngineOutcome(narration.text, engineOutcome)
    : [];
  const claims = engineOutcome ? [] : fabricatedOutcomeClaims(narration.text, options);
  const violations: string[] = engineOutcome ? contradictions.map((c) => c.match) : claims;
  const reason = engineOutcome ? NARRATION_OUTCOME_REJECTED_REASON : NARRATION_REJECTED_REASON;
  const violationNote = engineOutcome
    ? engineOutcomeViolationNote(
        engineOutcome,
        contradictions.map((c) => c.match),
      )
    : narrationViolationNote(claims);
  if (!violations.length) {
    releaseHeldSideEffects(narration);
    return { narration, outcome: 'clean' };
  }
  logRejection(1, violations, reason);

  let retry: T | undefined;
  let repeated: string[] = [];
  let repeatedClaims: OutcomeClaim[] = [];
  try {
    retry = await regenerate(violationNote);
    if (engineOutcome) {
      repeatedClaims = contradictsEngineOutcome(retry.text, engineOutcome);
      repeated = repeatedClaims.map((c) => c.match);
    } else {
      repeated = fabricatedOutcomeClaims(retry.text, options);
    }
    if (!repeated.length) {
      releaseHeldSideEffects(retry);
      return { narration: retry, outcome: 'regenerated' };
    }
    logRejection(2, repeated, reason);
  } catch {
    logRejection(2, violations, 'regeneration_failed');
  }

  if (pickedListedOption) {
    // #1048: the turn answered the DM's own listed option, so the narration is not
    // swapped for the no-effect line — only the sentences carrying the repeated claim
    // are dropped, and the reply's options stay. The spans carry the flagged
    // occurrences' own indices (`fabricatedOutcomeClaimSpans` /
    // `contradictsEngineOutcome`): a phrase repeated in two sentences, or used first
    // in a negated / figurative sense, must drop the sentence the detector flagged,
    // not the first place the phrase happens to appear. A regeneration that failed
    // leaves the first reply as the splice source on the harm arm; on the
    // engine-outcome arm its contradictions were never re-read, so nothing is
    // spliceable and the replacement below stands. A splice that would leave no
    // narration at all also falls through — an empty reply is worse than the line.
    const source = retry ?? narration;
    const spans = engineOutcome
      ? repeatedClaims
      : fabricatedOutcomeClaimSpans(source.text ?? '', options);
    const splicedText = spans.length
      ? spliceContradictingSentences(source.text ?? '', spans, '')
      : '';
    if (splicedText) {
      // The kept narration is an edit of a reply the gate rejected, so — exactly as
      // on the replaced arm — its parked side effects do not run and its segment map
      // does not survive: the held closure extracts memory and world state from the
      // reply's raw text (ai-service), which still carries the dropped claims
      // verbatim, and the segments are a parallel copy of the same unedited text.
      // A rejected reply leaves nothing in memory (#2373); the player still reads
      // the narration, minus the claiming sentences.
      const stripped: T = {
        ...source,
        text: splicedText,
        narrationSegments: undefined,
        heldSideEffects: undefined,
      };
      return { narration: stripped, outcome: 'regenerated' };
    }
  }
  // Neither reply is kept: nothing they parked runs, and nothing they carried survives.
  return {
    narration: {
      ...narration,
      text: NEUTRAL_NO_EFFECT_LINE,
      narrationSegments: undefined,
      options: undefined,
      handout_actions: [],
      map_actions: [],
      scene_spec: null,
      heldSideEffects: undefined,
    },
    outcome: 'replaced',
  };
}

export interface ExtraStrikeGateParams<T extends GatedNarration> {
  narration: T;
  engineHits: number;
  sessionId?: string;
  encounterId?: string;
  regenerate: (violation: string) => Promise<T>;
}

export async function gateInventedExtraStrike<T extends GatedNarration>(
  params: ExtraStrikeGateParams<T>,
): Promise<T> {
  const { narration, engineHits, sessionId, encounterId, regenerate } = params;
  const claims = inventedExtraStrikeClaims(narration.text, engineHits).map((c) => c.match);
  if (!claims.length) {
    releaseHeldSideEffects(narration);
    return narration;
  }
  logger.warn('DM_NARRATION_REJECTED', {
    reason: EXTRA_STRIKE_REJECTED_REASON,
    sessionId,
    requestId: AIService.lastRequestId(),
    branch: 'combat',
    attempt: 1,
    claims,
    ...(encounterId ? { encounterId } : {}),
  });

  const retry = await regenerate(extraStrikeViolationNote(engineHits, claims));
  const retryClaims = inventedExtraStrikeClaims(retry.text, engineHits);
  if (!retryClaims.length) {
    releaseHeldSideEffects(retry);
    return retry;
  }
  logger.warn('DM_NARRATION_REJECTED', {
    reason: EXTRA_STRIKE_REJECTED_REASON,
    sessionId,
    requestId: AIService.lastRequestId(),
    branch: 'combat',
    attempt: 2,
    claims: retryClaims.map((c) => c.match),
    ...(encounterId ? { encounterId } : {}),
  });
  // A repeat: drop only the sentences that land the invented strike.
  const stripped: T = {
    ...retry,
    text: spliceContradictingSentences(retry.text ?? '', retryClaims, ''),
  };
  releaseHeldSideEffects(stripped);
  return stripped;
}

export interface NarrativeTurn {
  isInCombat: boolean;
  isDiceRollMessage: boolean;
  /** `null` when no player message started the turn (the opening scene, a resumed turn). */
  playerInputOrigin: PlayerInputOrigin | null;
  /**
   * #1041: the player's message picked one of the options the previous DM reply listed
   * (see `playerPickedListedOption`). The story itself offered the move, so the turn is
   * the story advancing on the DM's own invitation, not a free-text non-action.
   * #1048: the pick is recorded for `enforceNarrationGate`, where it spares the reply
   * the no-effect replacement; it no longer exempts the turn from the gate's checks,
   * so the predicate below ignores it.
   */
  playerPickedListedOption?: boolean;
  result: {
    text?: string;
    roll_requests?: unknown[];
    combat_actions?: unknown[];
    combatants?: unknown[];
    combat_transition?: string;
    combat_entry_pending?: unknown;
    combat_entry?: unknown;
    /** #610: declared story damage the server applied in /generate. */
    damage?: unknown;
    /** #1020: the campaign ending the server applied in /generate. */
    campaign_ending?: unknown;
  };
}

/**
 * A turn outside combat that the engine has nothing to resolve: a player message, no dice result,
 * no roll request, no combat declaration or entry. The DM's prose is the only account of it.
 * Each clause is a turn where the engine does have something to say, or where nobody spoke.
 *
 * #610: declared story damage counts as engine-resolved — the server applied it in /generate
 * before the reply reached the client, so harm the narration describes was not fabricated
 * and the gate (and the early-render suppression) must not treat this turn as unresolved.
 *
 * #1020: a declared campaign ending counts the same way. The server completed the session
 * in /generate before the reply reached the client and nulled the field when the ending
 * did not apply, so a populated field is the engine's own ending. Without this clause the
 * ending turn — which by definition has no engine event — was exactly what the gate ate:
 * G22-008's listed landing choice was answered "(Nothing comes of that…)" and its options
 * wiped, because the ending narration claimed the story's conclusion with nothing backing it.
 *
 * #1041/#1048: a turn answering a listed option is NOT a clause here. #1041 made it
 * one, meaning to stop the gate replacing the answer with the no-effect line and
 * wiping its options (G22-008's dead end) — but the predicate feeds every check the
 * gate has, so the exemption also stood the harm and outcome checks down: on a click
 * turn a DM line narrating a wound no engine dealt passed unchecked. The pick now
 * spares only the replacement, inside `enforceNarrationGate`; this predicate holds
 * on a picked turn exactly as on a typed one, so the checks run.
 */
export function narrativeTurnHasNoEngineEvent({
  isInCombat,
  isDiceRollMessage,
  playerInputOrigin,
  result,
}: NarrativeTurn): boolean {
  return (
    !isInCombat &&
    !isDiceRollMessage &&
    playerInputOrigin !== null &&
    !result.combat_actions?.length &&
    !result.combatants?.length &&
    !result.roll_requests?.length &&
    (!result.combat_transition || result.combat_transition === 'none') &&
    !result.combat_entry_pending &&
    !result.combat_entry &&
    !isDeclaredStoryDamage(result.damage) &&
    !isDeclaredCampaignEnding(result.campaign_ending) &&
    !/```ROLL_REQUESTS_V1/.test(result.text ?? '')
  );
}

/** The envelope's `damage` field populated: the DM declared story damage this turn. */
function isDeclaredStoryDamage(damage: unknown): boolean {
  return damage !== null && damage !== undefined && typeof damage === 'object';
}

/** The envelope's `campaign_ending` field populated with a summary: the DM declared the
 *  campaign's ending this turn and the server applied it (#1020). */
function isDeclaredCampaignEnding(ending: unknown): boolean {
  if (ending === null || ending === undefined || typeof ending !== 'object') return false;
  const summary = (ending as { summary?: unknown }).summary;
  return typeof summary === 'string' && summary.trim().length > 0;
}

/** The previous DM reply, as much of it as the listed-option pick determination reads. */
export interface ListedOptionSource {
  text?: string | null;
  context?: { actionOptions?: unknown } | null;
}

/**
 * #1041: whether the player's message picked one of the options the DM's previous reply
 * listed. A click sends `createPlayerMessageFromOption(option)` and nothing else — no
 * option id, no send context (DynamicOptionsSection → MessageList.handleOptionSelect) —
 * so the pick is recognized by its text: the click's own product, or the option's text
 * typed verbatim. The offered options resolve the way MessageRenderer resolves them:
 * parsed from the reply's text, or from its saved `actionOptions` when the text carries
 * none. Comparison ignores case, whitespace runs and a trailing full stop — the shapes a
 * retype differs by, never the words chosen.
 */
export function playerPickedListedOption(
  playerText: string | null | undefined,
  previousDm: ListedOptionSource | null | undefined,
): boolean {
  if (!playerText || !previousDm) return false;
  const picked = normalizePickedOptionText(playerText);
  if (!picked) return false;
  return offeredOptionsOf(previousDm).some(
    (option) =>
      normalizePickedOptionText(createPlayerMessageFromOption(option)) === picked ||
      normalizePickedOptionText(option.text) === picked,
  );
}

/** The options a DM reply offered, resolved as `MessageRenderer` resolves them. */
function offeredOptionsOf(dm: ListedOptionSource): ActionOption[] {
  const inline = parseMessageOptions(dm.text ?? '');
  if (inline.hasOptions) return inline.options;
  const saved = dm.context?.actionOptions;
  if (Array.isArray(saved)) {
    const restored = parseMessageOptions(
      saved.filter((choice): choice is string => typeof choice === 'string').join('\n'),
    );
    if (restored.hasOptions) return restored.options;
  }
  return [];
}

function normalizePickedOptionText(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.!]+$/, '')
    .toLowerCase();
}

export interface RollOutcomeGateParams<T extends GatedNarration> {
  narration: T;
  sessionId: string;
  /** Only a dice-roll turn carries the engine's verdict. */
  isDiceRollMessage: boolean;
  conversationHistory: ChatMessage[];
  /** The player character's name, for subject-anchored claims. */
  characterName?: string;
  /** Reads the authoritative outcome; the real `SessionStateService.getLatestRollOutcome`. */
  getOutcome: (sessionId: string) => Promise<PersistedRollOutcome | null>;
  /**
   * The #2609 staleness bound; the real `isRollOutcomeStale`. Injectable (rather than
   * imported) so this module's `ai-service` import surface stays at `AIService` — server
   * tests mock that module narrowly and a new named import breaks them.
   */
  isStale: (outcome: PersistedRollOutcome, history: ChatMessage[]) => boolean;
  /** Runs the gate once a contradiction is found. */
  runGate: (engineOutcome: EngineOutcome, narration: T) => Promise<T>;
}

/**
 * The #266 wiring, extracted so tests can drive it: on a roll-result turn, load the engine's
 * authoritative verdict and — when it is fresh per the #2609 staleness bound and the reply
 * contradicts it — run the gate. Anything else returns the narration untouched.
 */
export async function gateRollOutcomeContradiction<T extends GatedNarration>(
  params: RollOutcomeGateParams<T>,
): Promise<T> {
  if (!params.isDiceRollMessage) return params.narration;
  const outcome = await params.getOutcome(params.sessionId).catch(() => null);
  if (!outcome || params.isStale(outcome, params.conversationHistory)) return params.narration;
  const engineOutcome: EngineOutcome = {
    success: outcome.success,
    characterName: params.characterName,
    // The roll's own words for the attempted action: soft verdict language ("you manage
    // to") only contradicts when its sentence names the action (#266).
    description: outcome.description,
    requestType: outcome.requestType,
  };
  if (!contradictsEngineOutcome(params.narration.text, engineOutcome).length) {
    return params.narration;
  }
  return params.runGate(engineOutcome, params.narration);
}
