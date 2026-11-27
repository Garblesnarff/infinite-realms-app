import logger from '@/lib/logger';

export interface LethalActionConfirmationSpec {
  playerMessage?: string;
}

export type LethalActionConfirmationAnswer = 'confirmed' | 'declined';

export interface LethalActionConfirmationHost {
  present: (spec: LethalActionConfirmationSpec, settle: () => void) => () => void;
}

let host: LethalActionConfirmationHost | null = null;
let pending: {
  settle: (answer: LethalActionConfirmationAnswer) => void;
  dismiss: () => void;
} | null = null;

export function setLethalActionConfirmationHost(next: LethalActionConfirmationHost | null): void {
  host = next;
}

export function hasPendingLethalActionConfirmation(): boolean {
  return pending !== null;
}

export function settlePendingLethalActionConfirmation(confirmed = true): boolean {
  if (!pending) return false;
  const settled = pending;
  pending = null;
  settled.dismiss();
  settled.settle(confirmed ? 'confirmed' : 'declined');
  return true;
}

export const cancelPendingLethalActionConfirmation = (): boolean =>
  settlePendingLethalActionConfirmation(false);

/**
 * Ask "Are you sure?" through the mounted host. If no host is mounted, decline
 * so a clearly lethal line is never sent without a confirm.
 */
export function requestLethalActionConfirmation(
  spec: LethalActionConfirmationSpec = {},
): Promise<boolean> {
  const mounted = host;
  if (!mounted) {
    logger.warn('[LethalAction] no confirmation host mounted; not sending');
    return Promise.resolve(false);
  }
  if (pending) {
    settlePendingLethalActionConfirmation(false);
  }
  return new Promise<boolean>((resolve) => {
    let settled = false;
    let dismissCard = (): void => {};
    const settle = (answer: LethalActionConfirmationAnswer): void => {
      if (settled) return;
      settled = true;
      logger.info(`[LethalAction] ${answer}`);
      resolve(answer === 'confirmed');
    };
    pending = { settle, dismiss: () => dismissCard() };
    dismissCard = mounted.present(spec, () => {
      /* the host buttons call settlePending; unmount cleanup declines */
    });
    if (settled) dismissCard();
  });
}
