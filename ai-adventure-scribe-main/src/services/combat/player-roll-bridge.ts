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
 * that still works. So a timeout, a superseding action, or a missing host all resolve to `null`,
 * which callers read as "the engine rolls this one".
 *
 * An explicit Dismiss is the one exception. It resolves `null` too, so nothing waits on it, but
 * it is marked `cancelled`: the player said "not this attack", and resolving it engine-rolled
 * made an attack they refused (#2234). Callers read a cancelled outcome as "do not resolve".
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

/**
 * What the engine asks for before it resolves a mid-combat ability check (#2420).
 *
 * The SAME popup the skill checks use, reached through this bridge rather than the dice queue's
 * narrative path: the check is already mid-resolution when it is asked for, so its result must
 * come back to the engine and must not be posted to the DM as a fresh player utterance — the
 * same reason an attack die is engine-owned.
 */
export interface PlayerCheckRollSpec {
  actorLabel: string;
  /** "Shove", "Grapple", "Hide", "Persuasion", "Intimidation" — the check being made. */
  checkLabel: string;
  /** The ability modifier (and proficiency) the sheet adds to the die. */
  checkModifier: number;
  /** The target's name, when the check names one. A hide has none. */
  targetLabel?: string;
  /**
   * What the die is measured against, for the popup's wording: a target's contest skill, or a
   * DC. Shown so the die is not a bare number, exactly as the attack prompt shows the AC.
   */
  opposedByLabel?: string;
}

export type PlayerRollSpec =
  | PlayerAttackRollSpec
  | PlayerInitiativeRollSpec
  | PlayerCheckRollSpec;

/**
 * `null` means nobody rolled: the engine should roll this attack itself — unless `cancelled`,
 * which means the player dismissed the prompt and the action must not resolve at all.
 */
export type PlayerRollOutcome = { d20: number | null; cancelled?: boolean };

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
  /** Epoch ms at which the timer auto-rolls this prompt; shown to the player as a countdown. */
  deadline?: number;
  /** What the prompt asks for, for the notice when the player moves on without rolling. */
  label: string;
  /** Opens this same prompt on a replacement host after the one showing it unmounted. */
  represent: (next: PlayerRollHost) => void;
  /** The host showing this prompt unmounted and no replacement has registered yet. */
  hostGone?: boolean;
} | null = null;

/** Keep the ask-first popup short enough to be a turn prompt, but long enough to be usable. */
export const PLAYER_INITIATIVE_ROLL_TIMEOUT_MS = 30_000;

/**
 * The attack prompt is bounded for the same reason the initiative prompt is.
 *
 * An unbounded await is a combat that can wedge: if the popup is never answered — the player
 * walked away, or its queue slot was taken by another request and the prompt was never visible
 * — the resolution sits forever, the turn never finishes and the composer stays disabled. That
 * was the M3 dead-end in #2190. Timing out resolves `{ d20: null }`, which the engine reads as
 * "roll it yourself", so the turn always completes.
 */
export const PLAYER_ATTACK_ROLL_TIMEOUT_MS = 45_000;

/** Bumped each time the player explicitly dismisses a combat roll prompt. */
let dismissCount = 0;

/**
 * Runs `ask` and reports whether the player dismissed a roll prompt while it ran.
 *
 * The ask helpers fold a dismissed prompt into their "engine rolls it" result, and the spell
 * helper is owned elsewhere. Reading the dismissal here keeps the cancel decision in the one
 * place that settles prompts. Combat asks one die at a time, so a counter is exact.
 */
export async function trackPlayerRollDismissal<T>(
  ask: () => Promise<T>,
): Promise<{ value: T; dismissed: boolean }> {
  const before = dismissCount;
  const value = await ask();
  return { value, dismissed: dismissCount !== before };
}

/**
 * Registered by the provider that owns the dice queue. Passing `null` clears it outright.
 *
 * A prompt whose host unmounted (see `releasePlayerRollHost`) is re-opened on the new host, so
 * a remount of the message list does not quietly turn the player's die into an engine roll.
 */
export function setPlayerRollHost(next: PlayerRollHost | null): void {
  host = next;
  if (next && pending?.hostGone) {
    pending.hostGone = false;
    logger.info('[PlayerRoll] dice host remounted; re-opening the pending prompt');
    pending.represent(next);
  }
}

/**
 * Called when a host unmounts.
 *
 * React can tear the message list down and mount a replacement in the same commit (a list
 * refresh, a StrictMode pass). The combat-entry confirmation host already survives that (#2017);
 * this host settled its prompt engine-rolled on the spot, so an initiative prompt could vanish
 * and come back as "(auto-rolled)" with nothing ever shown (#2234). Wait one microtask for a
 * replacement host. Only a real teardown, with no host coming back, lets the engine roll.
 */
export function releasePlayerRollHost(released: PlayerRollHost): void {
  if (host !== released) return;
  host = null;
  const orphan = pending;
  if (!orphan) return;
  orphan.hostGone = true;
  queueMicrotask(() => {
    if (pending !== orphan || !orphan.hostGone) return;
    logger.info('[PlayerRoll] dice host unmounted and did not return; the engine rolls it');
    settlePendingPlayerRoll({ d20: null });
  });
}

/** Whether a combat roll is currently waiting on the player's die. */
export function hasPendingPlayerRoll(): boolean {
  return pending !== null;
}

/** What the waiting prompt asks for ("initiative", "attack Longsword"), or null. */
export function pendingPlayerRollLabel(): string | null {
  return pending?.label ?? null;
}

/**
 * When the timer will auto-roll the prompt for `rollId`, or null when nothing will: a different
 * prompt, or one the player has already committed to (`markPlayerRollCommitted`).
 */
export function pendingPlayerRollDeadline(rollId: string): number | null {
  if (!pending || pending.rollId !== rollId || pending.timeoutId === undefined) return null;
  return pending.deadline ?? null;
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

/** Narrative rolls whose Roll button the player has pressed; the popup is still animating them. */
const committedNarrativeRolls = new Set<string>();

/**
 * A narrative roll has no bridge slot, but the next turn must not set aside a die the player has
 * already thrown (#2530). The popup takes ~3.5 s to hand its result over, and the queue entry
 * stays pending until then.
 */
export function markNarrativeRollCommitted(rollId: string): void {
  committedNarrativeRolls.add(rollId);
  if (committedNarrativeRolls.size > 50) {
    committedNarrativeRolls.delete(committedNarrativeRolls.values().next().value as string);
  }
}

export function isNarrativeRollCommitted(rollId: string): boolean {
  return committedNarrativeRolls.has(rollId);
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

function isCheckSpec(spec: PlayerRollSpec): spec is PlayerCheckRollSpec {
  return 'checkLabel' in spec;
}

/** How a prompt is named in the log, so a check reads as a check and not as a weapon. */
function rollLabelOf(spec: PlayerRollSpec): string {
  if (isInitiativeSpec(spec)) return 'initiative';
  if (isCheckSpec(spec)) return `check ${spec.checkLabel}`;
  return `attack ${spec.weaponName}`;
}

function requestPlayerRoll(
  spec: PlayerRollSpec,
  timeoutMs: number | undefined,
): Promise<PlayerRollOutcome> {
  if (!host) {
    logger.warn(
      `[PlayerRoll] no dice host mounted; the engine will roll this ${rollLabelOf(spec)}`,
    );
    return Promise.resolve({ d20: null });
  }

  // A roll already waiting means a previous request never settled. Settle it engine-rolled
  // rather than stacking popups, then open this one.
  if (pending) {
    logger.warn('[PlayerRoll] superseded by a new roll; the engine rolls the previous one');
    settlePendingPlayerRoll({ d20: null });
  }

  const rollLabel = rollLabelOf(spec);
  return new Promise<PlayerRollOutcome>((resolve) => {
    let settled = false;
    let dismissPopup = (): void => {};
    const settle = (outcome: PlayerRollOutcome): void => {
      if (settled) return;
      settled = true;
      if (outcome.cancelled) dismissCount += 1;
      logger.info(
        `[PlayerRoll] settled d20=${outcome.cancelled ? 'dismissed' : (outcome.d20 ?? 'auto')} ${rollLabel}`,
      );
      resolve(outcome);
    };

    const onHostSettle = (outcome: PlayerRollOutcome): void => {
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
    };
    const presentTo = (target: PlayerRollHost): PlayerRollHostHandle => {
      const handle = target.present(spec, onHostSettle);
      dismissPopup = handle.dismiss;
      if (pending?.settle === settle) pending.rollId = handle.rollId;
      return handle;
    };

    // Install the slot before calling the host. Test hosts and simple React adapters may settle
    // synchronously; assigning it afterwards would leave a ghost pending roll behind.
    pending = {
      settle,
      label: rollLabel,
      dismiss: () => dismissPopup(),
      // Drop the old host's queue entry, then ask the new host. The timer keeps running.
      represent: (next) => {
        dismissPopup();
        presentTo(next);
      },
    };
    const hostHandle = presentTo(host);

    if (settled) {
      // A synchronous host settlement happened before the real dismiss function was returned.
      hostHandle.dismiss();
    } else if (timeoutMs !== undefined) {
      const timeoutId = setTimeout(() => {
        logger.info(
          `[PlayerRoll] ${rollLabel} prompt timed out after ${timeoutMs}ms; auto-rolling`,
        );
        settlePendingPlayerRoll({ d20: null });
      }, timeoutMs);
      if (pending?.settle === settle) {
        pending.timeoutId = timeoutId;
        pending.deadline = Date.now() + timeoutMs;
      } else clearTimeout(timeoutId);
    }
  });
}

/**
 * Asks the player for one attack die and waits for it.
 *
 * Resolves `{ d20: null }` rather than rejecting when no host is mounted: headless callers and
 * tests must be able to resolve combat without a popup, and an engine roll is the correct
 * behaviour in exactly that case. The bounded timer gives the same guarantee for a popup that is
 * mounted but never answered.
 */
export function requestPlayerAttackRoll(spec: PlayerAttackRollSpec): Promise<PlayerRollOutcome> {
  return requestPlayerRoll(spec, PLAYER_ATTACK_ROLL_TIMEOUT_MS);
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

/**
 * Asks for the player's die on a mid-combat ability check and waits for it (#2420).
 *
 * Same popup, same seam and same bounded timer as the attack die, because it is the same
 * situation: the check is already resolving and is waiting on exactly one number. A dismissed
 * prompt resolves `{ d20: null, cancelled: true }`, which the caller reads as "do not resolve
 * this check" rather than rolling it for the player — the check's action stays unspent.
 */
export function requestPlayerCheckRoll(spec: PlayerCheckRollSpec): Promise<PlayerRollOutcome> {
  return requestPlayerRoll(spec, PLAYER_ATTACK_ROLL_TIMEOUT_MS);
}
