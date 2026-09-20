import logger from '@/lib/logger';

/** What the target-saves card is told to show. No player die is requested. */
export interface SpellTargetSaveSpec {
  actorLabel: string;
  targetLabel: string;
  spellName: string;
  saveAbility: string;
}

export interface SpellTargetSaveHost {
  present: (spec: SpellTargetSaveSpec, settle: () => void) => () => void;
}

let host: SpellTargetSaveHost | null = null;
let pending: { settle: () => void; dismiss: () => void } | null = null;

export function setSpellTargetSaveHost(next: SpellTargetSaveHost | null): void {
  host = next;
}

export function settlePendingSpellTargetSave(): boolean {
  if (!pending) return false;
  const settled = pending;
  pending = null;
  settled.dismiss();
  settled.settle();
  return true;
}

/**
 * Shows the "target saves" card and waits for the player to continue.
 *
 * A missing host is not a failed cast: headless callers and tests must still submit the
 * spell, and the engine owns the save. The card is presentation only.
 */
export function requestSpellTargetSave(spec: SpellTargetSaveSpec): Promise<void> {
  if (!host) {
    logger.warn('[SpellSave] no target-save host mounted; submitting without the card');
    return Promise.resolve();
  }
  if (pending) {
    logger.warn('[SpellSave] superseded by a new save card');
    settlePendingSpellTargetSave();
  }
  return new Promise<void>((resolve) => {
    let settled = false;
    let dismissCard = (): void => {};
    const settle = (): void => {
      if (settled) return;
      settled = true;
      logger.info(`[SpellSave] continued ${spec.spellName} vs ${spec.targetLabel}`);
      resolve();
    };
    pending = { settle, dismiss: () => dismissCard() };
    const hostHandle = host.present(spec, () => {
      if (pending?.settle === settle) {
        pending = null;
        settle();
      } else {
        settle();
      }
    });
    dismissCard = hostHandle;
    if (settled) hostHandle();
  });
}
