import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  askTargetSave,
  beginSheetCast,
  beginSheetCastCommit,
  cancelSheetCast,
  dismissSheetCast,
  finishSheetCast,
  getSheetCastSnapshot,
  reopenSheetCast,
  resetSheetCastProgress,
  sheetCastCancelled,
  sheetCastSignal,
  withSheetCastRoll,
} from '../sheet-cast-progress';
import { cancelPendingSpellTargetSave, setSpellTargetSaveHost } from '../spell-target-save-bridge';

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const SPEC = {
  actorLabel: 'The Scholar',
  targetLabel: 'Captain Sarah Reeves',
  spellName: 'Acid Splash',
  saveAbility: 'DEX',
};

describe('sheet cast progress (#2418)', () => {
  beforeEach(() => {
    resetSheetCastProgress();
    setSpellTargetSaveHost(null);
  });

  it('starts in the DM phase, cancellable, with a live signal', () => {
    beginSheetCast('Acid Splash');

    expect(getSheetCastSnapshot().cast).toMatchObject({
      spellName: 'Acid Splash',
      phase: 'dm',
      cancellable: true,
    });
    expect(sheetCastSignal()?.aborted).toBe(false);
  });

  it('cancel aborts the signal the DM call carries and clears the cast', () => {
    beginSheetCast('Acid Splash');
    const signal = sheetCastSignal()!;

    expect(cancelSheetCast()).toBe(true);

    expect(signal.aborted).toBe(true);
    expect(sheetCastCancelled()).toBe(true);
    expect(getSheetCastSnapshot().cast).toBeNull();
    expect(beginSheetCastCommit()).toBe(false);
  });

  it('a commit takes the cast past cancelling: the slot is spent', () => {
    beginSheetCast('Acid Splash');

    expect(beginSheetCastCommit('Captain Sarah Reeves')).toBe(true);
    expect(beginSheetCastCommit('Captain Sarah Reeves')).toBe(true);

    expect(getSheetCastSnapshot().cast).toMatchObject({
      phase: 'resolving',
      cancellable: false,
      targetName: 'Captain Sarah Reeves',
    });
    expect(cancelSheetCast()).toBe(false);
    expect(sheetCastSignal()?.aborted).toBe(false);
  });

  it('reopening after a refused area call makes the cast cancellable again', () => {
    beginSheetCast('Acid Splash');
    beginSheetCastCommit();
    expect(cancelSheetCast()).toBe(false);

    reopenSheetCast();

    expect(getSheetCastSnapshot().cast).toMatchObject({ phase: 'dm', cancellable: true });
    expect(cancelSheetCast()).toBe(true);
  });

  it('finishing frees the next cast: a cancelled one does not poison it', () => {
    beginSheetCast('Acid Splash');
    cancelSheetCast();
    finishSheetCast();

    beginSheetCast('Chill Touch');

    expect(sheetCastCancelled()).toBe(false);
    expect(beginSheetCastCommit()).toBe(true);
  });

  it('cancelling the save card of a typed cast aborts nothing and leaves a later cast alone', async () => {
    setSpellTargetSaveHost({ present: () => () => {} });
    const asked = askTargetSave(SPEC, true);

    expect(cancelSheetCast()).toBe(true);
    await expect(asked).resolves.toBe('cancel');

    expect(sheetCastCancelled()).toBe(false);
    beginSheetCast('Chill Touch');
    expect(beginSheetCastCommit()).toBe(true);
  });

  it('shows no card for a cast the player already cancelled', async () => {
    const present = vi.fn(() => () => {});
    setSpellTargetSaveHost({ present });
    beginSheetCast('Acid Splash');
    cancelSheetCast();

    await expect(askTargetSave(SPEC, true)).resolves.toBe('cancel');

    expect(present).not.toHaveBeenCalled();
  });

  it('refuses a second cast while one is in flight, so it never aborts or clears the first', () => {
    expect(beginSheetCast('Acid Splash')).toBe(true);
    const signal = sheetCastSignal()!;

    expect(beginSheetCast('Chill Touch')).toBe(false);

    expect(signal.aborted).toBe(false);
    expect(getSheetCastSnapshot().cast?.spellName).toBe('Acid Splash');
  });

  it('keeps the signal readable after a cancel, for a turn that was queued behind another', () => {
    beginSheetCast('Acid Splash');
    cancelSheetCast();

    expect(sheetCastSignal()?.aborted).toBe(true);
  });

  it('a typed cast’s card leaves a queued sheet cast’s dock alone, and cancelling it aborts nothing', async () => {
    beginSheetCast('Acid Splash');
    setSpellTargetSaveHost({ present: () => () => {} });
    const asked = askTargetSave(SPEC, false);

    expect(getSheetCastSnapshot().cast?.phase).toBe('dm');
    cancelPendingSpellTargetSave();
    await expect(asked).resolves.toBe('cancel');
    expect(sheetCastCancelled()).toBe(false);
  });

  it('the player’s die moves the dock to the roll phase and back, only for a sheet cast', async () => {
    beginSheetCast('Chill Touch');
    let phaseDuring: string | undefined;
    await withSheetCastRoll(true, async () => {
      phaseDuring = getSheetCastSnapshot().cast?.phase;
    });
    expect(phaseDuring).toBe('roll');
    expect(getSheetCastSnapshot().cast?.phase).toBe('dm');

    await withSheetCastRoll(false, async () => {
      phaseDuring = getSheetCastSnapshot().cast?.phase;
    });
    expect(phaseDuring).toBe('dm');
  });

  it('clears a finished cast that has no result, and a dismissed one', () => {
    beginSheetCast('Light');
    finishSheetCast();
    expect(getSheetCastSnapshot().cast).toBeNull();

    beginSheetCast('Acid Splash');
    dismissSheetCast();
    expect(getSheetCastSnapshot().cast).toBeNull();
  });
});
