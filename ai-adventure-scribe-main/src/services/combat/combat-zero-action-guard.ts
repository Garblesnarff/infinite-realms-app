import type { StructuredCombatAction } from '@/services/combat/combat-action-executor';

import logger from '@/lib/logger';
import { AIService } from '@/services/ai-service';

/**
 * The other half of the combat repair loop: the turn the DM narrated instead of declaring.
 *
 * #1701 repairs the turn the *engine* refused — the DM declared something, the engine said no,
 * and the correction is asked for. It cannot see the failure that leaves no refusal to repair:
 * the DM emitting no structured action at all, and narrating the outcome in prose instead.
 * Nothing is refused because nothing is declared, so the engine never runs, no dice are rolled,
 * no hit points move, and the player reads a miss that the rules never adjudicated.
 *
 * Production 2026-08-10 is the whole argument. At 17:29 the player typed "I attack the Sentient
 * Glaze with my claws" and the DM emitted a structured attack: the engine resolved it, the
 * intent POST is in the log, hit points changed. At 22:38 the player typed *the same sentence*
 * and the DM emitted `actions:0` — no intent POST, no roll, and a freeform-narrated miss. Same
 * input, same board, same prompt, opposite outcome. Prompt instructions already state the rule
 * ("Every attack must be declared, or it never happens"), and the model follows it about half
 * the time. An instruction obeyed on a coin flip is not a rule; it is a hope. This makes it
 * enforced, by treating silence as exactly what #1701 treats a refusal as — one corrective
 * regeneration, then surrender.
 *
 * Deliberately narrow. A false positive spends one extra generation on a turn that was already
 * fine; a false negative merely leaves today's behaviour in place. So the trigger requires an
 * unambiguous first-person or imperative attack, and stands down for questions, hypotheticals,
 * turns where the DM asked for a roll, and turns where the board itself is moving.
 */

/**
 * Verbs that, in the player's own voice during an active fight, mean "resolve this against the
 * rules". Deliberately violent and specific: "I move behind the pillar" and "I look at the
 * glaze" are combat inputs too, but neither is an action the engine must be handed, and
 * widening this list is how a guard starts firing on turns that never needed it.
 */
const ACTION_VERBS = [
  'attack',
  'strike',
  'swing',
  'slash',
  'stab',
  'shoot',
  'fire',
  'cast',
  'punch',
  'kick',
  'claw',
  'bite',
  'hurl',
  'lunge',
  'charge',
  'smite',
  'grapple',
  'shove',
  'tackle',
  'slam',
  'cleave',
  'thrust',
  'blast',
  'zap',
  'stomp',
];

const VERB_ALTERNATION = ACTION_VERBS.join('|');

/**
 * "I attack", "we strike", and the modal/adverbial padding a player actually types around them
 * — "I'll attack", "I try to attack", "I want to cast", "I quickly swing". Up to four filler
 * words, because "I am going to attack" is four.
 */
const FIRST_PERSON_ATTEMPT = new RegExp(
  `\\b(?:i|we)(?:'|’)?(?:ll|m|d|ve)?\\b(?:\\s+\\w+){0,4}?\\s+(?:${VERB_ALTERNATION})\\b`,
  'i',
);

/** A bare order — "attack the glaze", "cast fireball at it" — which players type just as often. */
const IMPERATIVE_ATTEMPT = new RegExp(`^\\s*(?:${VERB_ALTERNATION})\\b`, 'i');

/**
 * Asking about an action is not attempting one. "Can I attack from here?" wants an answer, and
 * forcing a structured attack out of the DM would take the player's turn for them.
 */
const HYPOTHETICAL = /\b(?:can|could|should|may|might|would)\s+(?:i|we)\b|\bwhat if\b|\bhow (?:do|would|can) (?:i|we)\b|\bdo (?:i|we) (?:need|have)\b/i;

/**
 * Whether the player plainly tried to act, in the only sense that matters here: the engine
 * should have been handed something.
 */
export function looksLikeCombatActionAttempt(message: string | undefined | null): boolean {
  const text = (message ?? '').trim();
  if (!text) return false;
  // A question is a question even when it contains an attack verb.
  if (text.endsWith('?')) return false;
  if (HYPOTHETICAL.test(text)) return false;
  return FIRST_PERSON_ATTEMPT.test(text) || IMPERATIVE_ATTEMPT.test(text);
}

/** What the board told the DM, in the vocabulary the DM must answer in. */
export interface BoardRoster {
  /** The verbatim `<turn_order>` block, when the tactical context carried one. */
  turnOrder: string | null;
  /** The slug of the entity holding the turn — the only legal actor. */
  currentSlug: string | null;
}

/**
 * Reads the roster back out of the tactical context the DM was just given.
 *
 * The roster is not rebuilt from `activeEncounter.participants` on purpose: those carry display
 * names, and names are not addressable. `combat_actions` must echo *slugs*, and the only place
 * the client holds slugs is the digest the server assembled — so handing the DM anything else
 * would be handing it a vocabulary the action schema cannot consume, which is the exact bug
 * #1700 fixed at the intent boundary.
 */
export function extractBoardRoster(tacticalContext: string | undefined | null): BoardRoster {
  const context = tacticalContext ?? '';
  const turnOrder = /<turn_order\b[\s\S]*?<\/turn_order>/.exec(context)?.[0] ?? null;
  // The `→ 3. sentient-glaze | Sentient Glaze | 22/30 HP | action:available | CURRENT TURN` line.
  const fromTurnOrder = turnOrder
    ? /^[^\n]*\|[^\n]*CURRENT TURN/m
        .exec(turnOrder)?.[0]
        ?.match(/^\s*→?\s*\d+\.\s*(\S+)\s*\|/)?.[1]
    : undefined;
  // The digest's own `ACTIVE <slug>` line, for a board with no turn order block behind it.
  const fromActive = /^ACTIVE\s+(\S+)\s*$/m.exec(context)?.[1];
  return { turnOrder, currentSlug: fromTurnOrder ?? fromActive ?? null };
}

/** The turn as the handler sees it, which is everything the trigger decision needs. */
export interface ZeroActionGuardInput {
  isInCombat: boolean;
  hasActiveEncounter: boolean;
  /** The DM's envelope for this turn. */
  result: {
    text?: string;
    combat_actions?: unknown[];
    combat_transition?: string;
    roll_requests?: unknown[];
  };
  playerMessage?: string;
  isDiceRollMessage?: boolean;
}

/**
 * Whether this turn owed the engine an action and did not produce one.
 *
 * Every clause here is a stand-down, and each exists because firing in that case would be worse
 * than the bug: a transition is the board itself moving and owes no action yet; a turn carrying
 * roll requests is paused on the dice UI on purpose, and forcing an action would take the
 * player's roll away from them; a submitted dice result is a continuation of a turn already
 * under way.
 */
export function shouldForceCombatAction(input: ZeroActionGuardInput): boolean {
  const { isInCombat, hasActiveEncounter, result, playerMessage, isDiceRollMessage } = input;
  if (!isInCombat || !hasActiveEncounter) return false;
  if (result.combat_actions?.length) return false;
  // `processDMResponse` writes 'none' on every reply, so "no transition" is 'none' or absent (#2380).
  if (result.combat_transition && result.combat_transition !== 'none') return false;
  if (result.roll_requests?.length) return false;
  // The same exclusion `ensureActionOptions` makes, for the legacy text-block form.
  if (/```ROLL_REQUESTS_V1/.test(result.text ?? '')) return false;
  if (isDiceRollMessage) return false;
  return looksLikeCombatActionAttempt(playerMessage);
}

export interface ZeroActionRepairParams {
  /** What the player typed, so the DM can be told which attempt it dropped. */
  playerMessage: string;
  /** The DM's action-free narration, echoed back as the thing that was not enough. */
  narratedText?: string;
  roster: BoardRoster;
  aiContext: unknown;
  conversationHistory: unknown[];
  userPlan?: string;
  turnCount?: number;
}

/**
 * The correction handed to the DM. Mirrors `buildRepairPrompt`'s shape deliberately: state what
 * went wrong in the engine's terms, attach the board, then ask for the same turn done properly.
 */
export function buildZeroActionRepairPrompt(
  playerMessage: string,
  roster: BoardRoster,
  narratedText?: string,
): string {
  return [
    'YOUR LAST RESPONSE RESOLVED NOTHING. Combat is active and the player attempted an action,',
    'but you returned no entry in combat_actions, so the engine never ran: no dice were rolled,',
    'no hit points changed, and the turn did not advance. Prose describing a hit or a miss is',
    'not a resolution — only a structured action is.',
    `The player attempted: "${playerMessage.trim()}"`,
    narratedText ? `You narrated instead: "${narratedText.trim().slice(0, 400)}"` : '',
    roster.currentSlug ? `The entity whose turn it is: ${roster.currentSlug}.` : '',
    roster.turnOrder ? `The board:\n${roster.turnOrder}` : '',
    'Re-declare this turn. You MUST return at least one entry in combat_actions for the',
    'current-turn entity above, with actor_id and target_ids copied verbatim from the board.',
    'Narrate the attempt, but let the engine decide whether it lands — do not state a hit, a',
    'miss, or any damage. Do not mention this correction, the engine, or any error to the player.',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Asks the DM once for the structured action it omitted. Returns the regeneration, or `null`
 * when it fails — callers keep the DM's original narration rather than losing the turn, which
 * is exactly today's behaviour and therefore never a regression.
 */
export async function repairZeroActionCombatTurn(
  params: ZeroActionRepairParams,
): Promise<{ text: string; combat_actions?: StructuredCombatAction[] } | null> {
  const { playerMessage, narratedText, roster, aiContext, conversationHistory, userPlan, turnCount } =
    params;
  logger.warn(
    `[CombatRepair] trigger=zero_action attempt current=${roster.currentSlug ?? 'unknown'} ` +
      `input="${playerMessage.trim().slice(0, 120)}"`,
  );
  try {
    const regenerated = await AIService.chatWithDM({
      message: buildZeroActionRepairPrompt(playerMessage, roster, narratedText),
      context: aiContext as never,
      conversationHistory: conversationHistory as never,
      userPlan,
      turnCount,
    });
    const actions = (regenerated as { combat_actions?: StructuredCombatAction[] })?.combat_actions;
    logger.info(
      `[CombatRepair] trigger=zero_action outcome=regenerated actions=${actions?.length ?? 0} ` +
        `actor=${actions?.[0]?.actor_id ?? 'none'}`,
    );
    return regenerated as { text: string; combat_actions?: StructuredCombatAction[] };
  } catch (error) {
    logger.warn('[CombatRepair] trigger=zero_action outcome=regeneration_failed', error);
    return null;
  }
}

export type ZeroActionGuardStep = ZeroActionGuardInput & {
  /** Carries `gameState.tacticalContext`, the digest the DM was shown this turn. */
  aiContext: { gameState?: { tacticalContext?: string } } & Record<string, unknown>;
  conversationHistory: unknown[];
  userPlan?: string;
  turnCount?: number;
};

/**
 * The guard as one step: decide, correct once, report.
 *
 * Returns the actions the DM should have declared, or `null` — which covers both standing down
 * and failing to repair, because the caller does the same thing in either case: leave the turn
 * exactly as the DM wrote it. That is today's behaviour, so a guard that cannot help can never
 * make a turn worse than it already was.
 */
export async function enforceCombatActionOnAttempt(
  params: ZeroActionGuardStep,
): Promise<{ combat_actions: StructuredCombatAction[]; text?: string } | null> {
  if (!shouldForceCombatAction(params)) return null;
  const repaired = await repairZeroActionCombatTurn({
    playerMessage: params.playerMessage as string,
    narratedText: params.result.text,
    roster: extractBoardRoster(params.aiContext?.gameState?.tacticalContext),
    aiContext: params.aiContext,
    conversationHistory: params.conversationHistory,
    userPlan: params.userPlan,
    turnCount: params.turnCount,
  });
  if (!repaired?.combat_actions?.length) {
    // Asked once, still nothing. The narration stands rather than the turn being lost.
    logger.warn('[CombatRepair] trigger=zero_action outcome=failed still no action; narrating');
    return null;
  }
  logger.info('[CombatRepair] trigger=zero_action outcome=repaired');
  return { combat_actions: repaired.combat_actions, text: repaired.text };
}
