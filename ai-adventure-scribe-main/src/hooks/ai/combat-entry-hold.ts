import { looksLikeCombatIntent } from '../../../shared/combat-intent-prefilter';

import type { AIResponse } from '@/services/ai/shared/types';

import logger from '@/lib/logger';
import {
  requestCombatEntryAnswer,
  requestCombatEntryConfirmation,
} from '@/services/combat/combat-entry-confirmation-bridge';
import { buildCombatEntryPlayer } from '@/services/combat/structured-combat-payload';
import { userDataApi } from '@/services/user-data-api';

export type PendingCombatEntry = NonNullable<AIResponse['combat_entry_pending']>;

/** Ask the player whether to strike, naming the declared target when there is one. */
export function confirmCombatEntry(
  pendingEntry: PendingCombatEntry,
  player: { name: string; initiativeModifier: number },
): Promise<boolean> {
  const combatantLabels = pendingEntry.combatants.map((combatant) => combatant.name);
  const declaredTarget = pendingEntry.declaredAttack?.actorName?.trim();
  const declaredTargets = declaredTarget ? [declaredTarget] : [];
  const normalizeLabel = (value: string): string =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const otherCombatants = declaredTargets.length
    ? combatantLabels.filter((label: string) => {
        const normalizedLabel = normalizeLabel(label);
        return !declaredTargets.some((target) => {
          const normalizedTarget = normalizeLabel(target);
          const escapedTarget = normalizedTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const numberedDuplicate = new RegExp(`^${escapedTarget}\\s*\\d+$`);
          return normalizedLabel === normalizedTarget || numberedDuplicate.test(normalizedLabel);
        });
      })
    : [];
  return requestCombatEntryConfirmation({
    actorLabel: player.name,
    combatantLabels,
    ...(declaredTargets.length ? { declaredTargets, otherCombatants } : {}),
    initiativeRoll: null,
    initiativeModifier: player.initiativeModifier,
  });
}

/** What the server made of a message that might declare an attack. */
export type DeclaredAttackCheck =
  | { kind: 'pending'; pending: PendingCombatEntry }
  | { kind: 'choice'; spellName: string; candidates: string[] };

/** The last DM message, sent so the server can tell which creatures "him" can mean. */
const RECENT_NARRATION_CHARS = 4_000;

export function recentNarrationFrom(
  messages: ReadonlyArray<{ sender?: string; text?: string }>,
): string | undefined {
  const lastDm = [...messages].reverse().find((message) => message.sender === 'dm' && message.text);
  return lastDm?.text?.slice(-RECENT_NARRATION_CHARS);
}

/**
 * Ask the server whether a message declares an attack, before the DM is called (#2341).
 *
 * Returns `null` when nothing is declared, and also when the check itself fails, in which case
 * the turn falls back to the old flow (the DM answers, then the server detects entry). That
 * fallback is the bug this exists to prevent, so it is logged on one greppable line.
 */
export async function checkDeclaredAttack(params: {
  sessionId: string;
  message: string;
  characterRecord: Record<string, unknown>;
  recentNarration?: string;
  targetName?: string;
}): Promise<DeclaredAttackCheck | null> {
  const player = buildCombatEntryPlayer(params.characterRecord);
  if (!player || !params.message.trim() || !looksLikeCombatIntent(params.message)) return null;

  let requestId: string | null = null;
  try {
    const response = await userDataApi.detectDeclaredAttack(params.sessionId, {
      playerInput: params.message,
      player,
      ...(params.recentNarration ? { recentNarration: params.recentNarration } : {}),
      ...(params.targetName ? { targetName: params.targetName } : {}),
    });
    requestId = response.headers?.get?.('x-request-id') ?? null;
    if (!response.ok) {
      logger.warn('COMBAT_ENTRY_HOLD_FALLBACK', {
        sessionId: params.sessionId,
        reason: 'refused',
        status: response.status,
        requestId,
      });
      return null;
    }
    const body = (await response.json()) as {
      pending?: PendingCombatEntry | null;
      targetChoice?: { spellName: string; candidates: string[] };
    };
    if (body.pending) return { kind: 'pending', pending: body.pending };
    if (body.targetChoice?.candidates.length) {
      return { kind: 'choice', ...body.targetChoice };
    }
    return null;
  } catch (error) {
    logger.warn('COMBAT_ENTRY_HOLD_FALLBACK', {
      sessionId: params.sessionId,
      reason: 'failed',
      requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export type HeldCombatEntry =
  | {
      pending: PendingCombatEntry;
      /**
       * `unavailable`: no popup host is mounted, so nothing was asked. The handler asks again
       * and reports that the same way it always has.
       */
      decision: 'confirmed' | 'unavailable';
    }
  | { decision: 'declined'; label: string };

/**
 * #2341: when the player's message names an attack on a creature and no encounter is open, the
 * popup opens BEFORE the DM is called. Until now the DM answered first and the popup mounted
 * after its text, so the DM had already narrated a miss and moved the target with no roll.
 *
 * Returns `null` when there is nothing to hold, and the DM is called as usual.
 */
export async function holdCombatEntryBeforeDm(params: {
  sessionId: string;
  message: string;
  characterRecord: Record<string, unknown>;
  recentNarration?: string;
}): Promise<HeldCombatEntry | null> {
  const player = buildCombatEntryPlayer(params.characterRecord);
  const check = await checkDeclaredAttack(params);
  if (!player || !check) return null;

  if (check.kind === 'choice') return holdForTargetChoice(params, check, player);

  let confirmed: boolean;
  try {
    confirmed = await confirmCombatEntry(check.pending, player);
  } catch (error) {
    logger.warn('[CombatEntry] held entry could not be confirmed', error);
    return { pending: check.pending, decision: 'unavailable' };
  }
  return confirmed
    ? { pending: check.pending, decision: 'confirmed' }
    : { decision: 'declined', label: declinedAttackLabel(check.pending) };
}

/**
 * An attack spell with no creature ("I cast Fire Bolt at him"): the card asks who it is for.
 * Picking a creature is the Strike, so the server is asked once more with that creature named
 * and the result seats without a second card.
 */
async function holdForTargetChoice(
  params: Parameters<typeof holdCombatEntryBeforeDm>[0],
  check: Extract<DeclaredAttackCheck, { kind: 'choice' }>,
  player: { name: string; initiativeModifier: number },
): Promise<HeldCombatEntry | null> {
  let answer;
  try {
    answer = await requestCombatEntryAnswer({
      actorLabel: player.name,
      combatantLabels: check.candidates,
      targetChoices: check.candidates,
      spellLabel: check.spellName,
      initiativeRoll: null,
      initiativeModifier: player.initiativeModifier,
    });
  } catch (error) {
    logger.warn('COMBAT_ENTRY_HOLD_FALLBACK', {
      sessionId: params.sessionId,
      reason: 'no_popup_host',
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  if (!answer.confirmed || !answer.target) {
    return { decision: 'declined', label: `the spell ${check.spellName}` };
  }
  const picked = await checkDeclaredAttack({ ...params, targetName: answer.target });
  if (picked?.kind !== 'pending') {
    logger.warn('COMBAT_ENTRY_HOLD_FALLBACK', {
      sessionId: params.sessionId,
      reason: 'picked_target_unresolved',
      requestId: null,
    });
    return null;
  }
  return { pending: picked.pending, decision: 'confirmed' };
}

/** The turn result while the DM has not been called: only the entry handoff, no prose. */
export const heldEntryResult = (pending: PendingCombatEntry): AIResponse => ({
  text: '',
  combat_transition: 'none',
  combat_entry_pending: pending,
  roll_requests: [],
  combat_actions: [],
  map_actions: [],
  handout_actions: [],
});

/** What the player named, worded for the DM's "this did not happen" note. */
export function declinedAttackLabel(pending: PendingCombatEntry): string {
  const target = pending.declaredAttack?.actorName ?? pending.combatants[0]?.name ?? 'a creature';
  const spell = pending.declaredAttack?.spellName;
  return spell ? `the spell ${spell} against ${target}` : `an attack against ${target}`;
}
