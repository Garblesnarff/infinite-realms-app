import logger from '@/lib/logger';

/** The entry facts shown before the server seats a detected encounter. */
export interface CombatEntryConfirmationSpec {
  actorLabel: string;
  combatantLabels: string[];
  initiativeRoll: number | null;
  initiativeModifier: number;
}

export interface CombatEntryConfirmationHost {
  present: (spec: CombatEntryConfirmationSpec, settle: (confirmed: boolean) => void) => () => void;
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
let pending: {
  settle: (confirmed: boolean) => void;
  dismiss: () => void;
} | null = null;

/** Registered by the message list while the entry confirmation surface is mounted. */
export function setCombatEntryConfirmationHost(next: CombatEntryConfirmationHost | null): void {
  host = next;
}

/** Whether an entry confirmation is currently waiting for the player. */
export function hasPendingCombatEntryConfirmation(): boolean {
  return pending !== null;
}

/** Resolve an entry prompt and dismiss its UI. */
export function settlePendingCombatEntryConfirmation(confirmed: boolean): boolean {
  if (!pending) return false;
  const settled = pending;
  pending = null;
  settled.dismiss();
  settled.settle(confirmed);
  return true;
}

/** Wait for the player to either seat or decline a detected combat entry. */
export function requestCombatEntryConfirmation(
  spec: CombatEntryConfirmationSpec,
): Promise<boolean> {
  if (!host) {
    logger.warn('[CombatEntry] no confirmation host mounted; rejecting entry confirmation');
    return Promise.reject(new CombatEntryConfirmationUnavailableError());
  }
  const activeHost = host;

  if (pending) {
    logger.warn('[CombatEntry] superseded by a new entry confirmation; declining the previous one');
    settlePendingCombatEntryConfirmation(false);
  }

  return new Promise<boolean>((resolve) => {
    let settled = false;
    let dismissPopup = (): void => {};
    const settle = (confirmed: boolean): void => {
      if (settled) return;
      settled = true;
      logger.info(`[CombatEntry] confirmation ${confirmed ? 'accepted' : 'declined'}`);
      resolve(confirmed);
    };

    pending = { settle, dismiss: () => dismissPopup() };
    const hostDismiss = activeHost.present(spec, (confirmed) => {
      if (pending?.settle === settle) pending = null;
      settle(confirmed);
    });
    dismissPopup = hostDismiss;

    if (settled) hostDismiss();
  });
}
