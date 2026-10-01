import logger from '@/lib/logger';

/** What the target-saves card is told to show. No player die is requested. */
export interface SpellTargetSaveSpec {
  actorLabel: string;
  targetLabel: string;
  spellName: string;
  saveAbility: string;
  /** The caster's spell save DC from the engine, when it could be asked. Shown only if the player wants target numbers. */
  saveDc?: number;
}

/** What the player chose. Cancelling gives the cast up before the engine spends anything. */
export type SpellTargetSaveAnswer = 'continue' | 'cancel';

export interface SpellTargetSaveHost {
  present: (spec: SpellTargetSaveSpec, settle: () => void) => () => void;
}

let host: SpellTargetSaveHost | null = null;
let pending: { settle: (answer?: SpellTargetSaveAnswer) => void; dismiss: () => void } | null =
  null;

export function setSpellTargetSaveHost(next: SpellTargetSaveHost | null): void {
  host = next;
}

export function settlePendingSpellTargetSave(answer: SpellTargetSaveAnswer = 'continue'): boolean {
  if (!pending) return false;
  const settled = pending;
  pending = null;
  settled.dismiss();
  settled.settle(answer);
  return true;
}

export const cancelPendingSpellTargetSave = (): boolean => settlePendingSpellTargetSave('cancel');

/**
 * Shows the "target saves" card and waits for the player to continue.
 *
 * A missing host is not a failed cast: headless callers and tests must still submit the
 * spell, and the engine owns the save. The card is presentation only.
 */
export function requestSpellTargetSave(spec: SpellTargetSaveSpec): Promise<SpellTargetSaveAnswer> {
  if (!host) {
    logger.warn('[SpellSave] no target-save host mounted; submitting without the card');
    return Promise.resolve('continue');
  }
  if (pending) {
    logger.warn('[SpellSave] superseded by a new save card');
    settlePendingSpellTargetSave();
  }
  return new Promise<SpellTargetSaveAnswer>((resolve) => {
    let settled = false;
    let dismissCard = (): void => {};
    const settle = (answer: SpellTargetSaveAnswer = 'continue'): void => {
      if (settled) return;
      settled = true;
      logger.info(`[SpellSave] ${answer} ${spec.spellName} vs ${spec.targetLabel}`);
      resolve(answer);
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
