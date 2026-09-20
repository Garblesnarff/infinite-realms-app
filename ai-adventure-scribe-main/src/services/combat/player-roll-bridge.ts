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
  /** Spell attacks reuse this popup but must not claim a weapon AC line. */
  kind?: 'weapon' | 'spell-attack';
}

/** What the entry gate asks for before it seats the encounter. */
export interface PlayerInitiativeRollSpec {
  actorLabel: string;
  initiativeModifier: number;
}

export type PlayerRollSpec = PlayerAttackRollSpec | PlayerInitiativeRollSpec;

/** `null` means nobody rolled: the engine should roll this attack itself. */
export type PlayerRollOutcome = { d20: number | null };

export interface PlayerRollHostHandle {
  /** The queue id for the popup, used to commit a player-initiated roll before it settles. */
  rollId: string;
  /** Dismisses the visible queue entry. */
  dismiss: () => void;
}

export interface PlayerRollHost {
  /**
   * Opens the dice popup for `spec`. Must call `settle` exactly once, with the natural d20 the
   * player kept, or `null` if they cancelled. The returned handle lets the bridge identify and
   * dismiss a popup the player has already walked away from.
   */
  present: (
    spec: PlayerRollSpec,
    settle: (outcome: PlayerRollOutcome) => void,
  ) => PlayerRollHostHandle;
}

let host: PlayerRollHost | null = null;
let pending: {
  settle: (outcome: PlayerRollOutcome) => void;
  dismiss: () => void;
  rollId?: string;
  timeoutId?: ReturnType<typeof setTimeout>;
} | null = null;

/** Keep the ask-first popup short enough to be a turn prompt, but long enough to be usable. */
export const PLAYER_INITIATIVE_ROLL_TIMEOUT_MS = 30_000;

/** Registered by the provider that owns the dice queue. Passing `null` clears it on unmount. */
export function setPlayerRollHost(next: PlayerRollHost | null): void {
  host = next;
}

/** Whether a combat roll is currently waiting on the player's die. */
export function hasPendingPlayerRoll(): boolean {
  return pending !== null;
}

/**
 * Commits a player-initiated initiative roll while its animation is still running.
 *
 * The popup takes 3.5 seconds to produce its result. The timeout must therefore stop when the
 * player clicks Roll, not when the animation eventually settles the queue entry.
 */
export function markPlayerRollCommitted(rollId: string): boolean {
  if (!pending || pending.rollId !== rollId || pending.timeoutId === undefined) return false;
  clearTimeout(pending.timeoutId);
  pending.timeoutId = undefined;
  return true;
}

/**
 * Settles the outstanding roll, dismissing its popup.
 *
 * Called by the popup when the player rolls or cancels, and by the turn pipeline when the
 * player does something else instead — sending a message is an answer too, and the answer is
 * "not this die". The pending roll then resolves engine-rolled rather than sitting behind a
 * modal the player has visibly moved on from.
 */
export function settlePendingPlayerRoll(outcome: PlayerRollOutcome): boolean {
  if (!pending) return false;
  const settled = pending;
  pending = null;
  if (settled.timeoutId !== undefined) clearTimeout(settled.timeoutId);
  settled.dismiss();
  settled.settle(outcome);
  return true;
}

function isInitiativeSpec(spec: PlayerRollSpec): spec is PlayerInitiativeRollSpec {
  return 'initiativeModifier' in spec;
}

function requestPlayerRoll(
  spec: PlayerRollSpec,
  timeoutMs: number | undefined,
): Promise<PlayerRollOutcome> {
  if (!host) {
    logger.warn(
      `[PlayerRoll] no dice host mounted; the engine will roll this ${isInitiativeSpec(spec) ? 'initiative' : 'attack'}`,
    );
    return Promise.resolve({ d20: null });
  }

  // A roll already waiting means a previous request never settled. Settle it engine-rolled
  // rather than stacking popups, then open this one.
  if (pending) {
    logger.warn('[PlayerRoll] superseded by a new roll; the engine rolls the previous one');
    settlePendingPlayerRoll({ d20: null });
  }

  const rollLabel = isInitiativeSpec(spec) ? 'initiative' : `attack ${spec.weaponName}`;
  return new Promise<PlayerRollOutcome>((resolve) => {
    let settled = false;
    let dismissPopup = (): void => {};
    const settle = (outcome: PlayerRollOutcome): void => {
      if (settled) return;
      settled = true;
      logger.info(`[PlayerRoll] settled d20=${outcome.d20 ?? 'auto'} ${rollLabel}`);
      resolve(outcome);
    };

    // Install the slot before calling the host. Test hosts and simple React adapters may settle
    // synchronously; assigning it afterwards would leave a ghost pending roll behind.
    pending = { settle, dismiss: () => dismissPopup() };
    const activeHost = host;
    const hostHandle = activeHost.present(spec, (outcome) => {
      if (pending?.settle === settle) {
        // The queue handler has already completed the visible roll. Clear the bridge slot and
        // timer, but do not dismiss/cancel the queue entry after it was marked completed.
        const current = pending;
        pending = null;
        if (current.timeoutId !== undefined) clearTimeout(current.timeoutId);
        settle(outcome);
      } else {
        settle(outcome);
      }
    });
    dismissPopup = hostHandle.dismiss;
    if (pending?.settle === settle) pending.rollId = hostHandle.rollId;

    if (settled) {
      // A synchronous host settlement happened before the real dismiss function was returned.
      hostHandle.dismiss();
    } else if (timeoutMs !== undefined) {
      const timeoutId = setTimeout(() => {
        logger.info(`[PlayerRoll] initiative prompt timed out after ${timeoutMs}ms; auto-rolling`);
        settlePendingPlayerRoll({ d20: null });
      }, timeoutMs);
      if (pending?.settle === settle) pending.timeoutId = timeoutId;
      else clearTimeout(timeoutId);
    }
  });
}

/**
 * Asks the player for one attack die and waits for it.
 *
 * Resolves `{ d20: null }` rather than rejecting when no host is mounted: headless callers and
 * tests must be able to resolve combat without a popup, and an engine roll is the correct
 * behaviour in exactly that case.
 */
export function requestPlayerAttackRoll(spec: PlayerAttackRollSpec): Promise<PlayerRollOutcome> {
  return requestPlayerRoll(spec, undefined);
}

/**
 * Asks for the player's initiative before `/enter` seats the encounter.
 *
 * A missing roll is deliberate: it tells the server to roll the player's initiative and the
 * seating transcript marks that seat `(auto-rolled)`. The bounded timer makes that fallback
 * deterministic when the player closes the popup or leaves the tab open.
 */
export function requestPlayerInitiativeRoll(
  spec: PlayerInitiativeRollSpec,
): Promise<PlayerRollOutcome> {
  return requestPlayerRoll(spec, PLAYER_INITIATIVE_ROLL_TIMEOUT_MS);
}
