import logger from '@/lib/logger';

/**
 * The one place a combat resolution can stop and wait for the player to roll a die.
 *
 * The engine resolves attacks from service code that has no React context, while the dice popup
 * is a queue living in `GameContext`. This is the seam between them: a provider registers a
 * host, service code awaits `requestPlayerAttackRoll`, and whatever the player does — rolls,
 * cancels, or walks away and does something else entirely — comes back as one settled promise.
 *
 * Exactly one roll may be outstanding at a time, and that is a rule rather than an
 * implementation limit: combat resolves one attack at a time, and a second popup opening over
 * the first would ask the player which of two attacks they are rolling for without telling them.
 *
 * Every path settles. A bridge that can hang is a combat that can wedge, and this product is
 * explicitly resume-anytime — players close laptops mid-popup and must come back to a session
 * that still works. So a cancel, a superseding action, or a missing host all resolve to `null`,
 * which callers read as "the engine rolls this one".
 */

/** What the popup is told to ask for. Every number here came from the engine's own proposal. */
export interface PlayerAttackRollSpec {
  /** Slug or name of the attacker, for the popup's label. */
  actorLabel: string;
  targetLabel: string;
  weaponName: string;
  /** Added to the die by the engine after it arrives; shown so the die is not a bare number. */
  attackBonus: number;
  targetAc: number;
  advantage: boolean;
  disadvantage: boolean;
}

/** `null` means nobody rolled: the engine should roll this attack itself. */
export type PlayerRollOutcome = { d20: number | null };

export interface PlayerRollHost {
  /**
   * Opens the dice popup for `spec`. Must call `settle` exactly once, with the natural d20 the
   * player kept, or `null` if they cancelled. Returning a function lets the bridge dismiss a
   * popup the player has already walked away from.
   */
  present: (spec: PlayerAttackRollSpec, settle: (outcome: PlayerRollOutcome) => void) => () => void;
}

let host: PlayerRollHost | null = null;
let pending: { settle: (outcome: PlayerRollOutcome) => void; dismiss: () => void } | null = null;

/** Registered by the provider that owns the dice queue. Passing `null` clears it on unmount. */
export function setPlayerRollHost(next: PlayerRollHost | null): void {
  host = next;
}

/** Whether a combat attack is currently waiting on the player's die. */
export function hasPendingPlayerRoll(): boolean {
  return pending !== null;
}

/**
 * Settles the outstanding roll, dismissing its popup.
 *
 * Called by the popup when the player rolls or cancels, and by the turn pipeline when the
 * player does something else instead — sending a message is an answer too, and the answer is
 * "not this die". The pending attack then resolves engine-rolled rather than sitting behind a
 * modal the player has visibly moved on from. No wall-clock timeout exists on purpose: a popup
 * left open overnight is not a failure, it is a player who came back.
 */
export function settlePendingPlayerRoll(outcome: PlayerRollOutcome): boolean {
  if (!pending) return false;
  const settled = pending;
  pending = null;
  settled.dismiss();
  settled.settle(outcome);
  return true;
}

/**
 * Asks the player for one attack die and waits for it.
 *
 * Resolves `{ d20: null }` rather than rejecting when no host is mounted: headless callers and
 * tests must be able to resolve combat without a popup, and an engine roll is the correct
 * behaviour in exactly that case.
 */
export function requestPlayerAttackRoll(spec: PlayerAttackRollSpec): Promise<PlayerRollOutcome> {
  if (!host) {
    logger.warn('[PlayerRoll] no dice host mounted; the engine will roll this attack');
    return Promise.resolve({ d20: null });
  }
  // A roll already waiting means a previous attack never settled. Settle it engine-rolled
  // rather than stacking popups, then open this one.
  if (pending) {
    logger.warn('[PlayerRoll] superseded by a new attack; the engine rolls the previous one');
    settlePendingPlayerRoll({ d20: null });
  }
  return new Promise<PlayerRollOutcome>((resolve) => {
    let settled = false;
    const settle = (outcome: PlayerRollOutcome): void => {
      if (settled) return;
      settled = true;
      logger.info(`[PlayerRoll] settled d20=${outcome.d20 ?? 'auto'} weapon=${spec.weaponName}`);
      resolve(outcome);
    };
    const dismiss = host!.present(spec, (outcome) => {
      // The host settling directly (player rolled or cancelled) clears the slot too.
      if (pending) pending = null;
      settle(outcome);
    });
    pending = { settle, dismiss };
  });
}
