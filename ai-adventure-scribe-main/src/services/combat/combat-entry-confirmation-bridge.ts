import logger from '@/lib/logger';

/** The entry facts shown before the server seats a detected encounter. */
export interface CombatEntryConfirmationSpec {
  actorLabel: string;
  combatantLabels: string[];
  /** Declared target labels take precedence over the full seated roster in the card copy. */
  declaredTargets?: string[];
  /** Roster members not named as a declared target, shown on the second line. */
  otherCombatants?: string[];
  initiativeRoll: number | null;
  initiativeModifier: number;
  /**
   * An attack spell was named with no creature ("I cast Fire Bolt at him"): the card asks who
   * it is for instead of asking to strike a declared target (#2341).
   */
  targetChoices?: string[];
  spellLabel?: string;
}

/** The player's answer: strike (at `target`, when the card asked who) or do something else. */
export interface CombatEntryAnswer {
  confirmed: boolean;
  target?: string;
}

export interface CombatEntryConfirmationHost {
  present: (
    spec: CombatEntryConfirmationSpec,
    settle: (confirmed: boolean, target?: string) => void,
  ) => () => void;
}

export const COMBAT_ENTRY_CONFIRMATION_NO_HOST_CODE = 'COMBAT_ENTRY_CONFIRMATION_HOST_UNAVAILABLE';

/** Returned distinctly so the turn pipeline can tell "no UI" from an intentional decline. */
export class CombatEntryConfirmationUnavailableError extends Error {
  readonly code = COMBAT_ENTRY_CONFIRMATION_NO_HOST_CODE;

  constructor() {
    super('Combat entry confirmation UI is unavailable');
    this.name = 'CombatEntryConfirmationUnavailableError';
  }
}

let host: CombatEntryConfirmationHost | null = null;
let hostOwnerKey: string | undefined;
let pending: {
  spec: CombatEntryConfirmationSpec;
  ownerKey: string | undefined;
  settle: (confirmed: boolean, target?: string) => void;
  dismiss: () => void;
} | null = null;

type PendingChangeListener = (isPending: boolean) => void;
const pendingChangeListeners = new Set<PendingChangeListener>();

/**
 * Subscribe to entry-confirmation pending state. #400: the card is a question the player may
 * answer by typing, so the composer stays live while it is up — unlike a dice-roll prompt,
 * which owns the single dice slot and keeps the composer blocked.
 */
export function onCombatEntryConfirmationPendingChange(
  listener: PendingChangeListener,
): () => void {
  pendingChangeListeners.add(listener);
  return () => {
    pendingChangeListeners.delete(listener);
  };
}

function notifyPendingChange(): void {
  const isPending = pending !== null;
  for (const listener of [...pendingChangeListeners]) {
    try {
      listener(isPending);
    } catch (error) {
      logger.warn('[CombatEntry] pending-change listener threw', error);
    }
  }
}

/**
 * #400: the player answered the card by typing instead of clicking. The typed message runs as
 * a new turn, and that turn must not be re-prompted with another card — the typed action is
 * the answer, and it starts combat through the engine.
 */
let typedAnswerArmed = false;

/** Arm the typed-answer flag when a typed message settles the card. */
export function markCombatEntryTypedAnswer(): void {
  typedAnswerArmed = true;
}

/** Consume the typed-answer flag; true once, for the next turn's entry hold. */
export function consumeCombatEntryTypedAnswer(): boolean {
  const armed = typedAnswerArmed;
  typedAnswerArmed = false;
  return armed;
}

/** Registered by the message list while the entry confirmation surface is mounted. */
export function setCombatEntryConfirmationHost(
  next: CombatEntryConfirmationHost | null,
  ownerKey?: string,
): void {
  host = next;
  hostOwnerKey = next ? ownerKey : undefined;

  // A confirmation request belongs to its session. Reattach it to a remounted host for the
  // same session, but decline it when a different session takes over the bridge.
  if (!next || !pending) return;
  const activePending = pending;
  if (activePending.ownerKey !== ownerKey) {
    settlePendingCombatEntryConfirmation(false);
    return;
  }

  const hostDismiss = next.present(activePending.spec, activePending.settle);
  if (pending === activePending) {
    activePending.dismiss = hostDismiss;
  } else {
    hostDismiss();
  }
}

/** Clears a host only when the caller still owns the bridge. */
export function clearCombatEntryConfirmationHost(expected: CombatEntryConfirmationHost): boolean {
  if (host !== expected) return false;
  host = null;
  hostOwnerKey = undefined;
  return true;
}

/** Whether an entry confirmation is currently waiting for the player. */
export function hasPendingCombatEntryConfirmation(): boolean {
  return pending !== null;
}

/** Resolve an entry prompt and dismiss its UI. */
export function settlePendingCombatEntryConfirmation(confirmed: boolean, target?: string): boolean {
  if (!pending) return false;
  const settled = pending;
  pending = null;
  notifyPendingChange();
  settled.dismiss();
  settled.settle(confirmed, target);
  return true;
}

/** Wait for the player to either seat or decline a detected combat entry. */
export function requestCombatEntryConfirmation(
  spec: CombatEntryConfirmationSpec,
): Promise<boolean> {
  return requestCombatEntryAnswer(spec).then((answer) => answer.confirmed);
}

/** Like `requestCombatEntryConfirmation`, and reports which creature the player picked. */
export function requestCombatEntryAnswer(
  spec: CombatEntryConfirmationSpec,
): Promise<CombatEntryAnswer> {
  if (!host) {
    logger.warn('[CombatEntry] no confirmation host mounted; rejecting entry confirmation');
    return Promise.reject(new CombatEntryConfirmationUnavailableError());
  }
  const activeHost = host;
  const activeOwnerKey = hostOwnerKey;

  if (pending) {
    logger.warn('[CombatEntry] superseded by a new entry confirmation; declining the previous one');
    settlePendingCombatEntryConfirmation(false);
  }

  return new Promise<CombatEntryAnswer>((resolve) => {
    let settled = false;
    let dismissPopup = (): void => {};
    const settle = (confirmed: boolean, target?: string): void => {
      if (settled) return;
      settled = true;
      logger.info(`[CombatEntry] confirmation ${confirmed ? 'accepted' : 'declined'}`);
      resolve({ confirmed, ...(target ? { target } : {}) });
    };

    pending = { spec, ownerKey: activeOwnerKey, settle, dismiss: () => dismissPopup() };
    notifyPendingChange();
    const hostDismiss = activeHost.present(spec, (confirmed, target) => {
      if (pending?.settle === settle) {
        pending = null;
        notifyPendingChange();
      }
      settle(confirmed, target);
    });
    dismissPopup = hostDismiss;

    if (settled) hostDismiss();
  });
}
