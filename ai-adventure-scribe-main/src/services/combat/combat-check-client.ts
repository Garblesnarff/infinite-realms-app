/**
 * The client half of the mid-combat check (#2420): recognise the player's sentence, ask for their
 * die in the ordinary roll dialog, and post the typed intent the engine resolves.
 *
 * Three steps in one place because splitting them is how the same check gets resolved twice: the
 * detector decides, the popup supplies the player's die, and the POST claims the action. A
 * dismissed popup withdraws the check rather than posting a check with an engine-rolled die the
 * player never asked for.
 */

import {
  CombatIntentRefusedError,
  executeAuthoritativeCombatIntent,
} from './combat-action-executor';
import { requestPlayerCheckRoll } from './player-roll-bridge';
import { standingHostiles } from './sheet-cast-save-hold';
import { detectCombatCheck } from '../../../shared/combat-check-intent';

import type { ClientCombatIntent } from './combat-action-executor';
import type { CombatCheckIntentKind } from '../../../shared/combat-check-intent';

import logger from '@/lib/logger';

/** The popup label for each check, and the ability whose modifier the sheet adds. */
const CHECK_LABELS: Record<CombatCheckIntentKind, string> = {
  shove: 'Shove',
  grapple: 'Grapple',
  escape: 'Escape',
  hide: 'Hide',
  parley: 'Persuasion',
};

/** The ability score each check reads, matching `CHECK_DEFINITIONS` in combat-check-rules. */
const CHECK_ABILITIES: Record<CombatCheckIntentKind, 'str' | 'dex' | 'cha'> = {
  shove: 'str',
  grapple: 'str',
  // The engine takes the better of Athletics and Acrobatics; the popup shows the better score.
  escape: 'str',
  hide: 'dex',
  parley: 'cha',
};

/**
 * The modifier the popup shows for a check: d20 plus this ability's modifier.
 *
 * Display only — the engine recomputes the check from the persisted sheet when it resolves, so a
 * stale number in this popup can never change an outcome. It exists so the die is not a bare
 * number, exactly as the attack popup shows its bonus.
 */
export function skillCheckModifierFor(
  participant: { abilityScores?: Record<string, unknown> } | null | undefined,
  kind: CombatCheckIntentKind,
): number {
  const ability = CHECK_ABILITIES[kind];
  const scoreOf = (key: string): number | undefined => {
    const raw = participant?.abilityScores?.[key];
    return typeof raw === 'number' ? raw : (raw as { score?: number } | undefined)?.score;
  };
  const score =
    kind === 'escape'
      ? Math.max(scoreOf('str') ?? 0, scoreOf('dex') ?? 0) || undefined
      : scoreOf(ability);
  return typeof score === 'number' ? Math.floor((score - 10) / 2) : 0;
}

/** What the caller needs to resolve a check against real numbers. */
export interface CombatCheckClientContext {
  encounterId: string;
  actorId: string;
  /** The actor's name, for the popup's wording. */
  actorLabel: string;
  /**
   * The whole roster. The player is in it and is not a target: a "it" in the sentence names the
   * one hostile only when the player is left out of the count (`standingHostiles`).
   */
  participants: ReadonlyArray<{ id: string; name?: string; participantType?: string }>;
  /** The player's sheet modifier for the check's ability, which the popup displays. */
  checkModifier: number;
  /** Which way a shove lands, chosen by the player in the confirm. */
  shoveOutcome?: 'prone' | 'push';
  origin?: 'typed' | 'action_bar';
}

export interface CombatCheckClientOutcome {
  /** False when the sentence named no check the engine owns, so the turn continues as today. */
  declared: boolean;
  /** Set when the check resolved; absent when it was declined or there was nothing to do. */
  result?: unknown;
  /** The reason the check was not run, when it was recognised but not resolved. */
  reason?: 'dismissed' | 'no_target' | 'unrecognised_check' | 'refused';
  /** The engine's own words for a refusal, shown to the player as the reason. */
  message?: string;
}

/** The participant a resolved intent names, if the roster has it. */
function participantIdFor(
  targetName: string | undefined,
  participants: ReadonlyArray<{ id: string; name?: string }>,
): string | undefined {
  if (!targetName) return undefined;
  const normalized = targetName.trim().toLowerCase();
  return participants.find((entry) => entry.name?.trim().toLowerCase() === normalized)?.id;
}

/**
 * Run one mid-combat check, if the player's message declared one.
 *
 * Returns `{ declared: false }` for an ordinary message so the caller proceeds exactly as it did
 * before #2420 — an unrecognised check is logged with its reason code and then falls through,
 * never silently swallowed and never fabricated into a resolved check.
 */
export async function runDeclaredCombatCheck(
  playerMessage: string,
  context: CombatCheckClientContext,
): Promise<CombatCheckClientOutcome> {
  const targets = standingHostiles(context.participants);
  const detection = detectCombatCheck(
    playerMessage,
    targets.map((participant) => ({ name: participant.name ?? '' })),
  );

  if (!detection.intent) {
    if (detection.reason && detection.reason !== 'not_a_check') {
      logger.warn('[CombatCheck] mid-combat check not resolved', {
        reason: detection.reason,
        clause: detection.clause.slice(0, 120),
        encounterId: context.encounterId,
      });
    }
    return {
      declared: false,
      ...(detection.reason === 'unrecognised_check' || detection.reason === 'no_target_actor'
        ? { reason: detection.reason }
        : {}),
    };
  }

  const { intent } = detection;
  const targetId = participantIdFor(intent.targetName, targets);
  if (intent.kind !== 'hide' && intent.kind !== 'escape' && !targetId) {
    logger.warn('[CombatCheck] mid-combat check named no target on the roster', {
      reason: 'no_target_actor',
      targetName: intent.targetName ?? null,
      encounterId: context.encounterId,
    });
    return { declared: true, reason: 'no_target' };
  }

  const targetLabel = intent.targetName;
  const checkLabel =
    intent.kind === 'parley' && intent.parleySkill === 'intimidate'
      ? 'Intimidation'
      : CHECK_LABELS[intent.kind];

  // The one roll request: the same popup the skill checks use, reached through the bridge so its
  // result returns here rather than being posted to the DM as a fresh utterance.
  const outcome = await requestPlayerCheckRoll({
    actorLabel: context.actorLabel,
    checkLabel,
    checkModifier: context.checkModifier,
    ...(targetLabel ? { targetLabel } : {}),
  });

  if (outcome.cancelled) {
    logger.info('[CombatCheck] player dismissed the check prompt; the check does not resolve', {
      encounterId: context.encounterId,
      kind: intent.kind,
    });
    return { declared: true, reason: 'dismissed' };
  }

  const checkIntent: ClientCombatIntent = {
    type: 'check',
    actorId: context.actorId,
    checkKind: intent.kind,
    ...(targetId ? { targetId } : {}),
    ...(intent.parleySkill ? { parleySkill: intent.parleySkill } : {}),
    ...(intent.kind === 'shove' && context.shoveOutcome
      ? { shoveOutcome: context.shoveOutcome }
      : {}),
    // An absent d20 means the engine rolls the whole check, which is the timeout/no-popup path.
    ...(outcome.d20 !== null ? { d20: outcome.d20 } : {}),
  };

  try {
    const result = await executeAuthoritativeCombatIntent(
      context.encounterId,
      checkIntent,
      'dm',
      undefined,
      context.origin,
    );
    return { declared: true, result };
  } catch (error) {
    // A refusal (a target too large to shove, nothing to escape) cost the player nothing; the
    // engine's reason is the answer, not an error to throw the turn away on.
    if (!(error instanceof CombatIntentRefusedError)) throw error;
    logger.info('[CombatCheck] the engine refused the check', {
      kind: intent.kind,
      reason: error.details?.reason,
      encounterId: context.encounterId,
    });
    return { declared: true, reason: 'refused', message: error.message };
  }
}
